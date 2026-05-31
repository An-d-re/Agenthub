"""阶段：executing（迭代执行）—— 并发执行就绪任务，Reviewer 审查，自动重试。"""

import asyncio
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import async_session
from app.core.middleware import MiddlewareContext
from app.core.phases.base import BasePhaseHandler, PhaseContext, _utcnow
from app.core.prompts import CODER_TASK_PROMPT, VERIFIER_TASK_PROMPT
from app.models.plan import Plan
from app.models.task import Task
from app.models.message import Message
from app.models.artifact import Artifact
from app.core.tracer import tracer
from app.services.adapters.base import AgentContext, AgentRole

logger = logging.getLogger(__name__)


class ExecutingHandler(BasePhaseHandler):
    """执行任务 DAG：并发调度、Reviewer 审查、自动重试。"""

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

        # 检查停止信号
        orch = ctx.orchestrator
        if orch and hasattr(orch, '_check_stop') and orch._check_stop():
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "任务执行已停止。",
                pending_events=ctx.pending_events,
            )
            return

        logger.info("并行执行 %d 个就绪任务", len(ready))

        # 提交父 session 释放写锁，让 run_one 的独立 session 可以并发写入
        await ctx.db.commit()

        async def run_one(task_id: str) -> None:
            async with async_session() as task_db:
                # SELECT ... FOR UPDATE 防止并发执行同一任务
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

        # 刷新外层 session，使其看到内部提交的最新状态
        ctx.db.expire_all()

        if orch and hasattr(orch, '_check_stop') and orch._check_stop():
            return
        if not await self._check_all_done(ctx.db, ctx.plan.session_id, ctx.plan, ctx.pending_events):
            await self._execute_ready_tasks_from_db(ctx)

    async def _execute_single_task(
        self, db: AsyncSession, plan: Plan, task: Task,
        mentions: list[str], session_id: str, orch=None,
    ) -> None:
        """执行单个任务：中间件 → Agent → 审查 → 标记完成。"""
        pending: list[dict] = []

        conversation_history = await self._get_conversation_history(db, session_id)

        # 运行中间件链
        if orch and hasattr(orch, 'middleware'):
            from app.core.middleware import MiddlewareContext as MwCtx
            mw_ctx = MwCtx(
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

        # 从 DAG 中解析任务所需能力（required_capability）
        capability = self._resolve_task_capability(plan, task)
        role_name = capability  # calculate / code / verify / design / analyze / write / data

        # 优先使用 DAG 分配的 agent，回退到按角色查找
        if task.assigned_agent_id:
            agent, adapter = await self._get_agent_adapter(db, task.assigned_agent_id)
        else:
            from app.core.agent_factory import match_task_to_agent, create_temp_agent
            match = await match_task_to_agent(db, session_id, capability, set())
            if match.matched and match.agent:
                agent, adapter = await self._get_agent_adapter(db, match.agent.id)
                task.assigned_agent_id = match.agent.id
            else:
                agent, adapter = None, None
        if not agent or not adapter:
            # 兜底：自动创建临时 Agent
            from app.core.agent_factory import create_temp_agent
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
            agent_id=agent.id, agent_role=agent.role_type or role_name,
            pending_events=pending,
        )

        # 根据任务能力选择系统提示词
        task_prompt = VERIFIER_TASK_PROMPT if capability == "verify" else CODER_TASK_PROMPT

        agent_role = self._capability_to_agent_role(capability)

        from app.core.sandbox.manager import WORKSPACES_ROOT
        context = AgentContext(
            session_id=session_id,
            agent_role=agent_role,
            conversation_history=conversation_history,
            current_task={"id": task.id, "title": task.title, "description": task.description},
            config={"system_prompt": task_prompt},
            workspace_dir=str(WORKSPACES_ROOT / session_id),
        )

        # 停止检查
        stop_evt = self._get_stop_event(session_id)
        if stop_evt and stop_evt.is_set():
            task.status = "cancelled"
            task.error_message = "用户停止执行"
            await db.flush()
            await self._publish_task_update(session_id, task, "cancelled", pending)
            return

        try:
            # 信号量只包 API 调用，不包重试
            if orch and hasattr(orch, 'middleware'):
                await orch.middleware.subagent_limiter.acquire(session_id)
            try:
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
            finally:
                if orch and hasattr(orch, 'middleware'):
                    orch.middleware.subagent_limiter.release(session_id)

            task.result = response.content
            task.status = "done"
            task.completed_at = _utcnow()
            await db.flush()

            artifacts = await self._extract_artifacts(db, session_id, task, response.content, pending)

            # 处理工具调用产生的 artifacts（Agent 通过 write_file 创建的文件）
            for a in response.artifacts:
                file_path = a.get("file_path", "")
                # 跳过已在 _extract_artifacts 中通过文本解析创建的文件
                if any(art.get("file_path") == file_path for art in artifacts):
                    continue
                art = Artifact(
                    task_id=task.id, session_id=session_id,
                    file_path=file_path,
                    original_content="",
                    modified_content=a.get("content", ""),
                    language=a.get("language", ""),
                    artifact_type="code",
                )
                db.add(art)
                await db.flush()
                artifacts.append({
                    "id": art.id, "file_path": art.file_path,
                    "language": art.language,
                    "original_content": "", "modified_content": a.get("content", ""),
                })
                pending.append({
                    "type": "artifact.created",
                    "session_id": session_id,
                    "payload": {
                        "artifact_id": art.id, "task_id": task.id,
                        "file_path": file_path, "language": a.get("language", ""),
                        "original_content": "", "content_preview": a.get("content", "")[:200],
                    },
                })

            await self._publish_task_update(session_id, task, "done", pending)

            # verify 任务：Agent 输出直接展示在聊天流中
            if capability == "verify":
                preview = response.content[:500] + ("…" if len(response.content) > 500 else "")
                await self._send_system_message(
                    db, session_id,
                    preview,
                    agent_id=agent.id, agent_role="verify", pending_events=pending,
                )
            else:
                # Sandbox 执行：仅对文本提取的代码块执行（工具创建的 Agent 已自行测试）
                sandbox_results = []
                text_artifacts = [a for a in artifacts if not any(
                    ra.get("file_path") == a.get("file_path") for ra in response.artifacts
                )]
                if text_artifacts:
                    sandbox_results = await self._run_in_sandbox(session_id, text_artifacts, pending)

                task.status = "reviewing"
                await db.flush()
                await self._publish_task_update(session_id, task, "reviewing", pending)
                await self._send_system_message(
                    db, session_id,
                    f"🔍 正在审查任务「{task.title}」…",
                    agent_id=agent.id, agent_role="reviewer",
                    pending_events=pending,
                )

                reviewed = await self._review_task_output(
                    db, session_id, task, response.content, pending, mentions,
                )
                if not reviewed:
                    await db.flush()
                    if task.status != "dispute":
                        await self._execute_single_task(db, plan, task, mentions, session_id)
                    return

                # Agent 输出直接展示在聊天流中（作为 agent 消息，非 system）
                preview = response.content[:500] + ("…" if len(response.content) > 500 else "")
                await self._send_system_message(
                    db, session_id, preview,
                    agent_id=agent.id, agent_role=capability, pending_events=pending,
                )
                if artifacts:
                    lines = [f"📁 生成了 {len(artifacts)} 个文件："]
                    lines.extend(f"  • `{a['file_path']}`" for a in artifacts)
                    await self._send_system_message(
                        db, session_id, "\n".join(lines),
                        pending_events=pending,
                    )
                if sandbox_results:
                    lines = ["🏗️ 沙箱执行结果："]
                    for sr in sandbox_results:
                        status = "✅" if sr.get("ok") else "❌"
                        lines.append(f"  {status} `{sr['file']}` — {sr.get('message', sr.get('error', ''))[:150]}")
                    await self._send_system_message(
                        db, session_id, "\n".join(lines),
                        pending_events=pending,
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
            # 发布独立 session 的事件
            for evt in pending:
                try:
                    from app.core.event_bus import event_bus
                    await event_bus.publish(session_id, evt)
                except Exception:
                    logger.warning("Failed to publish pending event", exc_info=True)

    def _resolve_task_capability(self, plan: Plan, task: Task) -> str:
        """从 DAG 中解析任务所需能力，回退到 'code'。"""
        task_dag = plan.task_dag or []
        db_id = str(task.id)
        for td in task_dag:
            if td.get("_db_id") == db_id or td.get("id") == task.title:
                return td.get("required_capability", "code")
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

    async def _run_in_sandbox(
        self, session_id: str, artifacts: list[dict], pending: list[dict],
    ) -> list[dict]:
        """对可执行代码制品在沙箱中运行。"""
        executable_langs = {"python", "py", "javascript", "js", "typescript", "ts"}
        results = []
        for a in artifacts:
            lang = a.get("language", "")
            if lang not in executable_langs:
                continue
            code = a.get("modified_content") or a.get("content", "")
            if len(code) < 20:
                continue
            try:
                from app.core.sandbox.manager import SandboxManager
                sm = SandboxManager(session_id)
                result = await sm.auto_fix_loop(
                    code, lang, a.get("file_path", ""),
                )
                results.append({
                    "file": a.get("file_path", ""),
                    "ok": result.get("ok", False),
                    "message": result.get("output", {}).get("stdout", "")[:200] if result.get("ok") else "",
                    "error": result.get("error", "")[:200] if not result.get("ok") else "",
                })
            except Exception as e:
                logger.warning("Sandbox 执行失败: %s", e)
                results.append({
                    "file": a.get("file_path", ""),
                    "ok": False,
                    "error": str(e)[:200],
                })
        return results
