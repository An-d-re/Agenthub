"""阶段：executing（迭代执行）—— 并发执行就绪任务。"""

import asyncio
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import async_session
from app.core.middleware import MiddlewareContext
from app.core.phases.base import BasePhaseHandler, PhaseContext, _utcnow
from app.models.plan import Plan
from app.models.task import Task
from app.models.message import Message
from app.core.tracer import tracer
from app.services.adapters.base import AgentContext, AgentRole

logger = logging.getLogger(__name__)


class ExecutingHandler(BasePhaseHandler):
    """执行任务 DAG：并发调度、结果展示。"""

    async def execute(self, ctx: PhaseContext) -> str | None:
        lower = ctx.user_message.strip().lower()
        if lower in ["重试", "retry", "再试一次", "try again"]:
            await self._retry_failed(ctx)
            return None

        await self._send_system_message(
            ctx.db, ctx.plan.session_id,
            "正在执行任务中。输入「重试」可重试失败的任务。",
            pending_events=ctx.pending_events,
        )
        return None

    async def execute_tasks(self, ctx: PhaseContext) -> None:
        """执行所有就绪任务（从 confirmed 阶段调用）。"""
        await self._execute_ready_tasks_from_db(ctx)

    async def _retry_failed(self, ctx: PhaseContext) -> None:
        result = await ctx.db.execute(
            select(Task).where(
                Task.plan_id == ctx.plan.id,
                Task.status.in_(["dispute", "retrying", "blocked"]),
            ).order_by(Task.priority.desc())
        )
        failed = list(result.scalars().all())
        if failed:
            task = failed[0]
            task.status = "pending"
            task.retry_count = 0
            task.error_message = None
            await ctx.db.flush()
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, f"正在重试任务：{task.title}…",
                pending_events=ctx.pending_events,
            )
            await self._execute_ready_tasks_from_db(ctx)
        else:
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "没有失败的任务需要重试。",
                pending_events=ctx.pending_events,
            )

    # ── 任务调度 ──────────────────────────────────────────────

    async def _execute_ready_tasks_from_db(self, ctx: PhaseContext) -> None:
        task_dag = ctx.plan.task_dag or []
        result = await ctx.db.execute(select(Task).where(Task.plan_id == ctx.plan.id))
        all_tasks = {t.title: t.id for t in result.scalars().all()}

        id_map: dict[str, str] = {}
        for td in task_dag:
            db_id = all_tasks.get(td["title"])
            if db_id:
                id_map[td["id"]] = db_id

        await self._execute_ready_tasks(ctx, id_map)

    async def _execute_ready_tasks(self, ctx: PhaseContext, id_map: dict[str, str]) -> None:
        task_dag = ctx.plan.task_dag or []
        result = await ctx.db.execute(
            select(Task.id, Task.status).where(Task.plan_id == ctx.plan.id)
        )
        statuses = {str(row[0]): row[1] for row in result.all()}

        ready: list[tuple[dict, str]] = []
        for td in task_dag:
            task_id = id_map.get(td["id"])
            if not task_id or statuses.get(task_id) != "pending":
                continue

            deps_met = True
            for dep_dag_id in td.get("dependencies", []):
                dep_db_id = id_map.get(dep_dag_id)
                if dep_db_id and statuses.get(dep_db_id) != "done":
                    deps_met = False
                    break

            if deps_met:
                ready.append((td, task_id))

        if not ready:
            return

        orch = ctx.orchestrator
        if orch and hasattr(orch, '_check_stop') and orch._check_stop():
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "任务执行已停止。",
                pending_events=ctx.pending_events,
            )
            return

        logger.info("并行执行 %d 个就绪任务", len(ready))

        # 提交父 session 释放写锁
        await ctx.db.commit()

        async def run_one(task_id: str) -> None:
            async with async_session() as task_db:
                result = await task_db.execute(
                    select(Task).where(Task.id == task_id).with_for_update()
                )
                task = result.scalar_one_or_none()
                if not task or task.status != "pending":
                    return
                task.status = "running"
                await task_db.flush()

                task_plan = await task_db.get(Plan, ctx.plan.id)
                if task_plan:
                    await self._execute_single_task(
                        task_db, task_plan, task, ctx.mentions, ctx.plan.session_id, orch,
                    )
                await task_db.commit()

        await asyncio.gather(*[run_one(tid) for _, tid in ready])

        ctx.db.expire_all()

        if orch and hasattr(orch, '_check_stop') and orch._check_stop():
            return
        if not await self._check_all_done(ctx.db, ctx.plan.session_id, ctx.plan, ctx.pending_events):
            await self._execute_ready_tasks_from_db(ctx)

    async def _execute_single_task(
        self, db: AsyncSession, plan: Plan, task: Task,
        mentions: list[str], session_id: str, orch=None,
    ) -> None:
        """执行单个任务：中间件 → 选 Agent → adapter.execute_task() → 发结果 → 标记 done。"""
        pending: list[dict] = []

        conversation_history = await self._get_conversation_history(db, session_id)

        # 运行中间件链
        if orch and hasattr(orch, 'middleware'):
            mw_ctx = MiddlewareContext(
                session_id=session_id, task_id=task.id,
                conversation_history=conversation_history,
                task_payload={"title": task.title, "description": task.description},
            )
            mw_ctx = await orch.middleware.run(mw_ctx)
            if mw_ctx.blocked:
                task.status = "blocked"
                task.error_message = mw_ctx.block_reason
                msg = Message(
                    session_id=session_id, role="system",
                    content=f"任务「{task.title}」被阻止：{mw_ctx.block_reason}",
                    message_type="system",
                )
                db.add(msg)
                await db.flush()
                return
            conversation_history = mw_ctx.conversation_history

        # 选择 Agent：优先 DAG 分配，回退到自动创建
        if task.assigned_agent_id:
            agent, adapter = await self._get_agent_adapter(db, task.assigned_agent_id)
            logger.info(
                "_execute_single_task: task=%s title=%s assigned_agent_id=%s agent_name=%s",
                task.id, task.title, task.assigned_agent_id, agent.name if agent else "NOT_FOUND",
            )
        else:
            capability = self._resolve_task_capability(plan, task)
            from app.core.agent_factory import match_task_to_agent, create_temp_agent
            match = await match_task_to_agent(db, session_id, capability, set())
            if match.matched and match.agent:
                agent, adapter = await self._get_agent_adapter(db, match.agent.id)
                task.assigned_agent_id = match.agent.id
            else:
                agent, adapter = None, None

        if not agent or not adapter:
            from app.core.agent_factory import create_temp_agent
            capability = self._resolve_task_capability(plan, task)
            agent = await create_temp_agent(
                db, session_id, task, capability, "deepseek",
            )
            task.assigned_agent_id = agent.id
            _, adapter = await self._get_agent_adapter(db, agent.id)
            pending.append({
                "type": "agent.created",
                "session_id": session_id,
                "payload": {
                    "id": agent.id, "name": agent.name,
                    "role_type": agent.role_type,
                    "adapter_type": agent.adapter_type,
                    "capability_tags": agent.capability_tags,
                    "is_deletable": agent.is_deletable,
                },
            })
        if not agent or not adapter:
            task.status = "blocked"
            task.error_message = "找不到合适的 Agent 且无法创建"
            return

        task.status = "running"
        task.started_at = _utcnow()
        await db.flush()
        await self._publish_task_update(session_id, task, "running", pending)

        await self._send_system_message(
            db, session_id,
            f"⏳ 正在执行任务「{task.title}」…",
            agent_id=agent.id,
            pending_events=pending, publish_now=True,
        )

        capability = self._resolve_task_capability(plan, task)
        agent_role = self._capability_to_agent_role(capability)

        # 需要沙箱工具的能力类型（ReAct + 工具调用循环）
        SANDBOX_CAPABILITIES = {"code", "data"}

        context = AgentContext(
            session_id=session_id,
            agent_role=agent_role,
            conversation_history=conversation_history,
            current_task={"id": task.id, "title": task.title, "description": task.description},
            config={"system_prompt": agent.system_prompt or ""},
        )

        # 沙箱任务需要 workspace_dir
        if capability in SANDBOX_CAPABILITIES:
            from app.core.sandbox.manager import SandboxManager
            sm = SandboxManager(session_id)
            context.workspace_dir = sm.workspace_path

        # 停止检查
        stop_evt = self._get_stop_event(session_id)
        if stop_evt and stop_evt.is_set():
            task.status = "cancelled"
            task.error_message = "用户停止执行"
            await db.flush()
            await self._publish_task_update(session_id, task, "cancelled", pending)
            return

        try:
            if orch and hasattr(orch, 'middleware'):
                await orch.middleware.subagent_limiter.acquire(session_id)
            try:
                if capability in SANDBOX_CAPABILITIES:
                    async with tracer.span(
                        session_id=session_id,
                        operation_name="adapter.execute_task",
                        service_name=adapter.adapter_type,
                        tags={"task_id": task.id, "task_title": task.title},
                    ) as span:
                        response = await adapter.execute_task(context, {
                            "id": task.id, "title": task.title, "description": task.description,
                        })
                        span["tags"]["tokens_used"] = response.metadata.get("tokens_used", 0)
                else:
                    task_prompt = (
                        f"任务：{task.title}\n"
                        f"描述：{task.description}\n\n"
                        "请完成上述任务，给出完整的过程和结论。"
                    )
                    response = await adapter.send_message(context, task_prompt)
            finally:
                if orch and hasattr(orch, 'middleware'):
                    orch.middleware.subagent_limiter.release(session_id)

            task.result = response.content
            task.status = "done"
            task.completed_at = _utcnow()
            await db.flush()

            await self._publish_task_update(session_id, task, "done", pending)

            # 将 Agent 完整输出展示在聊天流中
            await self._send_system_message(
                db, session_id, response.content,
                agent_id=agent.id, agent_role=capability, pending_events=pending,
            )

        except Exception as e:
            logger.exception("任务执行失败: %s", e)
            task.error_message = str(e)

            if task.retry_count < (task.max_retries or self.MAX_TASK_RETRIES):
                task.status = "retrying"
                task.retry_count += 1
                await self._send_system_message(
                    db, session_id,
                    f"任务「{task.title}」失败（第 {task.retry_count} 次尝试）：{e}。正在重试…",
                    pending_events=pending,
                )
                await self._execute_single_task(db, plan, task, mentions, session_id)
                return
            else:
                task.status = "dispute"
                await self._send_system_message(
                    db, session_id,
                    f"❌ 任务「{task.title}」在 {self.MAX_TASK_RETRIES + 1} 次尝试后仍失败：{e}。\n"
                    "输入「重试」重新执行，或检查 Agent 配置。",
                    pending_events=pending,
                )
                return
        finally:
            if adapter:
                try:
                    await adapter.stop()
                except Exception:
                    logger.warning("Failed to stop adapter", exc_info=True)
            for evt in pending:
                try:
                    from app.core.event_bus import event_bus
                    await event_bus.publish(session_id, evt)
                except Exception:
                    logger.warning("Failed to publish pending event", exc_info=True)

    def _resolve_task_capability(self, plan: Plan, task: Task) -> str:
        """从 DAG 中解析任务所需能力，匹配失败时回退到 'code'。"""
        task_dag = plan.task_dag or []
        for td in task_dag:
            if td.get("_db_id") == str(task.id) or td.get("title") == task.title:
                capability = td.get("required_capability", "code")
                logger.info(
                    "_resolve_task_capability: MATCHED task=%s title=%s → capability=%s",
                    task.id, task.title, capability,
                )
                return capability
        logger.warning(
            "_resolve_task_capability: NO MATCH for task=%s title=%s, dag_titles=%s",
            task.id, task.title, [(td.get("id"), td.get("title")) for td in task_dag],
        )
        return "code"

    def _capability_to_agent_role(self, capability: str) -> AgentRole:
        """能力类型 → AgentRole（用于 tracer 和日志）。"""
        mapping = {
            "calculate": AgentRole.CODER,
            "code": AgentRole.CODER,
            "verify": AgentRole.REVIEWER,
            "design": AgentRole.PLANNER,
            "analyze": AgentRole.CODER,
            "write": AgentRole.CODER,
            "data": AgentRole.CODER,
        }
        return mapping.get(capability, AgentRole.CODER)
