"""编排器 —— 群聊多 Agent 协作的逐消息状态机。

生命周期：每条用户消息触发一次 handle_message() 调用：
  读取 Plan.phase → 路由到对应阶段处理函数 → 调用适配器 → 发布到 EventBus → 返回
  下一条用户消息触发下一步。

四阶段模型：clarify（澄清）→ comparison（对比）→ confirmed（确认）→ executing（执行）→ done（完成）
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.core.event_bus import event_bus
from app.core.middleware import MiddlewareChain, MiddlewareContext
from app.core.prompts import (
    CODER_TASK_PROMPT,
    CRITIC_SYSTEM_PROMPT,
    PLANNER_APPROACHES_PROMPT,
    PLANNER_DECOMPOSE_PROMPT,
    REVIEWER_PROMPT_PREFIX,
)
from app.core.tracer import tracer
from app.models.agent import Agent
from app.models.message import Message
from app.models.plan import Plan
from app.models.session import SessionAgent
from app.models.task import Task, TaskDependency
from app.services.adapters import create_adapter
from app.services.adapters.base import AgentContext, AgentRole, BaseAdapter

logger = logging.getLogger(__name__)


def _utcnow():
    return datetime.now(timezone.utc)


class Orchestrator:
    """群聊多 Agent 编排器 —— 逐消息状态机。

    不在后台持续运行，而是由每条用户消息驱动一次 handle_message() 调用。
    """

    MAX_CLARIFY_ROUNDS = 2  # 最多澄清轮数
    MAX_TASK_RETRIES = 1    # 自动重试次数
    _locks: dict[str, asyncio.Lock] = {}  # 按 session 串行化，防止竞态
    _stop_events: dict[str, asyncio.Event] = {}  # 按 session 停止信号

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.middleware = MiddlewareChain()
        self._pending_events: list[dict] = []  # 收集事件，commit 后批量发布

    # ── Session 控制 ─────────────────────────────────────────

    @classmethod
    def stop_session(cls, session_id: str) -> None:
        """停止 session 中所有正在执行的任务。"""
        event = cls._stop_events.setdefault(session_id, asyncio.Event())
        event.set()

    @classmethod
    def resume_session(cls, session_id: str) -> None:
        """清除停止信号，允许继续执行。"""
        event = cls._stop_events.get(session_id)
        if event:
            event.clear()

    @classmethod
    def is_session_stopped(cls, session_id: str) -> bool:
        """检查 session 是否已被停止。"""
        event = cls._stop_events.get(session_id)
        return event is not None and event.is_set()

    def _check_stop(self) -> bool:
        """检查当前 session 是否被停止，若是则发送停止消息并返回 True。"""
        if self.is_session_stopped(self.session_id):
            return True
        return False

    # ── 公开入口 ──────────────────────────────────────────────

    async def handle_message(self, user_message: str, mentions: Optional[list[str]] = None) -> None:
        """处理一条用户消息。由 ws_routes.py 通过 create_task 调用。"""
        # 按 session 加锁，防止并发消息导致 Plan 状态竞态
        lock = Orchestrator._locks.setdefault(self.session_id, asyncio.Lock())
        async with lock:
            await self._handle_message_locked(user_message, mentions or [])

    async def _handle_message_locked(self, user_message: str, mentions: list[str]) -> None:
        """在 session 锁保护下处理消息。"""
        self._mentions = mentions  # 存储供 _get_agent_for_role 使用
        try:
            async with async_session() as db:
                plan = await self._get_or_create_active_plan(db)
                if not plan:
                    await self._publish_error("无法获取或创建 Plan")
                    return

                plan.updated_at = _utcnow()
                phase = plan.phase

                if phase == "clarify":
                    await self._phase_clarify(db, plan, user_message)
                elif phase == "comparison":
                    await self._phase_comparison(db, plan, user_message)
                elif phase == "confirmed":
                    await self._phase_confirmed(db, plan, user_message)
                elif phase == "executing":
                    await self._phase_executing(db, plan, user_message)
                elif phase == "done":
                    # 清理中间件 per-session 状态
                    self.middleware.reset_session(self.session_id)
                    # 如果用户发送了新的需求，重新启动工作流
                    if len(user_message.strip()) > 5:
                        plan.phase = "clarify"
                        plan.task_dag = {}
                        plan.approaches = None
                        await self._send_system_message(db, "检测到新需求，重新开始工作流。")
                        await self._phase_clarify(db, plan, user_message)
                    else:
                        await self._send_system_message(
                            db, "所有任务已完成。请发送新的需求，或创建新的会话。"
                        )
                else:
                    logger.warning("未知的 Plan 阶段: %s", phase)

                await db.commit()
            # 事务提交成功后，批量发布收集的事件
            await self._flush_pending_events()
        except Exception as e:
            logger.exception("Orchestrator.handle_message 失败: %s", e)
            await self._publish_error(f"编排器出错：{e}")

    # ── 阶段：clarify（需求澄清）───────────────────────────────

    async def _phase_clarify(self, db: AsyncSession, plan: Plan, user_message: str) -> None:
        """Critic 角色：质疑需求，最多 2 轮。"""
        task_dag = plan.task_dag or {}
        clarify_round = task_dag.get("clarify_round", 0)

        if clarify_round >= self.MAX_CLARIFY_ROUNDS:
            # 已够轮数，直接进入方案对比阶段（澄清消息不传给 comparison）
            plan.phase = "comparison"
            await self._send_system_message(db, "需求澄清已完成。正在生成方案选项…")
            await self._phase_comparison(db, plan, "")
            return

        # 获取 Critic Agent（用第一个 session agent）
        agent, adapter = await self._get_agent_for_role(db, "critic")
        if not agent or not adapter:
            await self._send_system_message(db, "会话中没有可用的 Agent，请先添加 Agent。")
            return

        # 构建上下文
        history = await self._get_conversation_history(db)
        context = AgentContext(
            session_id=self.session_id,
            agent_role=AgentRole.PLANNER,
            conversation_history=history,
            config={"system_prompt": CRITIC_SYSTEM_PROMPT},
        )

        # 调用 Critic
        response = await adapter.send_message(context, user_message)
        content = response.content

        # 持久化 Critic 回复
        msg = Message(
            session_id=self.session_id,
            agent_id=agent.id,
            role="agent",
            content=content,
            message_type="system",
        )
        db.add(msg)
        await db.flush()

        # 收集到 _pending_events，事务 commit 后统一发布
        self._pending_events.append({
            "type": "chat.message",
            "session_id": self.session_id,
            "payload": {
                "id": msg.id,
                "agent_id": agent.id,
                "role": "agent",
                "content": content,
                "message_type": "system",
                "created_at": _utcnow().isoformat(),
            },
        })

        # 更新轮次
        clarify_round += 1
        plan.task_dag = task_dag | {"clarify_round": clarify_round}

        # 检查是否该进入下一阶段
        if clarify_round >= self.MAX_CLARIFY_ROUNDS or self._critic_has_signaled_done(content):
            plan.phase = "comparison"
            plan.task_dag = {}  # 清理临时数据
            await self._phase_comparison(db, plan, "")  # 澄清消息不传给方案对比

    def _critic_has_signaled_done(self, content: str) -> bool:
        """检查 Critic 是否发出了完成信号。"""
        signals = ["不再需要澄清", "可以往下推进", "需求已经明确", "可以开始了", "准备好了"]
        lower = content.lower()
        return any(s.lower() in lower for s in signals)

    # ── 阶段：comparison（方案对比）────────────────────────────

    async def _phase_comparison(self, db: AsyncSession, plan: Plan, user_message: str) -> None:
        """生成方案选项或解析用户选择。"""
        # 如果已有方案，说明用户在选方案
        if plan.approaches:
            selected = await self._parse_approach_selection(user_message, plan.approaches)
            if selected:
                plan.selected_approach = selected.get("name", "")
                plan.phase = "confirmed"
                await self._send_system_message(
                    db, f"已选择方案：{selected.get('name', '')}。正在生成任务计划…"
                )
                await self._phase_confirmed(db, plan, user_message)
                return
            else:
                names = ", ".join(a.get("name", "") for a in plan.approaches)
                await self._send_system_message(
                    db, f"请选择一个方案（输入名称或序号）：{names}"
                )
                return

        # 生成方案
        agent, adapter = await self._get_agent_for_role(db, "planner")
        if not agent or not adapter:
            await self._send_system_message(db, "没有可用的 Planner Agent。")
            return

        history = await self._get_conversation_history(db)
        context = AgentContext(
            session_id=self.session_id,
            agent_role=AgentRole.PLANNER,
            conversation_history=history,
            config={"system_prompt": PLANNER_APPROACHES_PROMPT},
        )

        response = await adapter.send_message(context, user_message)
        content = response.content

        # 提取 JSON
        approaches = self._extract_json_array(content)
        if not approaches or not isinstance(approaches, list) or len(approaches) == 0:
            # 兜底：把整段回复包装为单个方案
            approaches = [{
                "name": "推荐方案",
                "summary": content[:200],
                "pros": [],
                "cons": [],
                "recommended": True,
            }]

        plan.approaches = approaches

        # 构建方案展示消息
        lines = ["**方案对比：**\n"]
        for i, a in enumerate(approaches, 1):
            badge = " ⭐推荐" if a.get("recommended") else ""
            lines.append(f"**{i}. {a.get('name', '')}**{badge}")
            lines.append(f"> {a.get('summary', '')}")
            if a.get("pros"):
                lines.append(f"优点：{'，'.join(a['pros'])}")
            if a.get("cons"):
                lines.append(f"缺点：{'，'.join(a['cons'])}")
            lines.append("")

        lines.append("请输入方案名称或序号来选择。")

        msg_text = "\n".join(lines)
        msg = Message(
            session_id=self.session_id,
            role="system",
            content=msg_text,
            message_type="system",
        )
        db.add(msg)
        await db.flush()

        self._pending_events.append({
            "type": "plan.comparison",
            "session_id": self.session_id,
            "payload": {"approaches": approaches, "message_id": msg.id},
        })

    # ── 阶段：confirmed（计划确认）─────────────────────────────

    async def _phase_confirmed(self, db: AsyncSession, plan: Plan, user_message: str) -> None:
        """计划确认阶段：首次进入时分解任务并展示 DAG，后续消息处理确认/编辑。"""
        # 已有任务 DAG → 这是用户对计划的反馈
        existing_dag = plan.task_dag or []
        if existing_dag:
            lower = user_message.strip().lower()
            if lower in ("确认", "confirm", "ok", "好的", "可以", "执行", "开始", "go", "yes", "是"):
                await self._do_confirm_plan(db, plan)
            elif lower.startswith("删除") or lower.startswith("delete"):
                # 删除任务： "删除 task-2" / "delete task-2"
                task_id = user_message.strip().split()[-1] if " " in user_message.strip() else ""
                await self._do_delete_dag_task(db, plan, task_id)
            else:
                await self._send_system_message(
                    db, "请输入「确认」开始执行任务，或「删除 <任务ID>」移除不需要的任务。"
                )
            return

        # 首次进入：分解任务
        agent, adapter = await self._get_agent_for_role(db, "planner")
        if not agent or not adapter:
            await self._send_system_message(db, "没有可用的 Planner Agent。")
            return

        decompose_input = (
            f"已选方案：{plan.selected_approach}\n"
            f"方案详情：{json.dumps(plan.approaches, ensure_ascii=False)}\n\n"
            "请将上述方案分解为原子任务，标注依赖关系和所需角色。"
        )

        history = await self._get_conversation_history(db)
        context = AgentContext(
            session_id=self.session_id,
            agent_role=AgentRole.PLANNER,
            conversation_history=history,
            config={"system_prompt": PLANNER_DECOMPOSE_PROMPT},
        )

        response = await adapter.send_message(context, decompose_input)
        content = response.content

        task_dag = self._extract_json_array(content)
        if not task_dag or not isinstance(task_dag, list) or len(task_dag) == 0:
            task_dag = [{
                "id": "task-1",
                "title": plan.selected_approach or "实现需求",
                "description": content[:500],
                "dependencies": [],
                "agent_role": "coder",
            }]

        # 分配 agent_id
        for td in task_dag:
            td["assigned_agent_id"] = await self._resolve_agent_id(db, td.get("agent_role", "coder"))

        plan.task_dag = task_dag

        # 创建 Task 和 TaskDependency 数据库记录
        id_map: dict[str, str] = {}
        for td in task_dag:
            task = Task(
                plan_id=plan.id,
                title=td["title"],
                description=td.get("description", ""),
                assigned_agent_id=td.get("assigned_agent_id"),
                status="pending",
            )
            db.add(task)
            await db.flush()
            id_map[td["id"]] = task.id
            td["_db_id"] = task.id  # 存回 dag，方便后续查找

        for td in task_dag:
            for dep_id in td.get("dependencies", []):
                dep_db_id = id_map.get(dep_id)
                if dep_db_id:
                    dep = TaskDependency(
                        task_id=id_map[td["id"]], depends_on_task_id=dep_db_id
                    )
                    db.add(dep)

        await db.flush()

        # 发送 plan.confirmed 事件（带结构化任务列表，供前端 DAG 编辑器使用）
        dag_for_frontend = []
        for td in task_dag:
            dag_for_frontend.append({
                "id": td["id"],
                "title": td["title"],
                "description": td.get("description", "")[:200],
                "dependencies": td.get("dependencies", []),
                "agent_role": td.get("agent_role", "coder"),
                "db_id": td.get("_db_id", ""),
            })

        msg = Message(
            session_id=self.session_id,
            role="system",
            content="**任务计划已生成，请确认后执行：**\n" + "\n".join(
                f"- {t['id']}: {t['title']}" for t in dag_for_frontend
            ),
            message_type="system",
        )
        db.add(msg)
        await db.flush()

        self._pending_events.append({
            "type": "plan.confirmed",
            "session_id": self.session_id,
            "payload": {
                "message_id": msg.id,
                "tasks": dag_for_frontend,
                "hint": "请勾选/删除任务后点击「确认执行」，或输入「确认」/「删除 <任务ID>」",
            },
        })

    async def _do_confirm_plan(self, db: AsyncSession, plan: Plan) -> None:
        """用户确认计划，进入执行阶段。"""
        plan.phase = "executing"
        await self._send_system_message(db, "计划已确认，开始执行任务…")
        await self._execute_ready_tasks_from_db(db, plan)

    async def _do_delete_dag_task(self, db: AsyncSession, plan: Plan, dag_task_id: str) -> None:
        """从 DAG 中删除指定任务及其数据库记录。"""
        task_dag = plan.task_dag or []
        target = next((t for t in task_dag if t.get("id") == dag_task_id), None)
        if not target:
            await self._send_system_message(db, f"未找到任务 {dag_task_id}。可删除的任务：{', '.join(t.get('id','') for t in task_dag)}")
            return

        # 删除数据库 Task 记录
        db_task_id = target.get("_db_id", "")
        if db_task_id:
            db_task = await db.get(Task, db_task_id)
            if db_task:
                await db.delete(db_task)

        # 从 DAG 中移除并更新依赖
        new_dag = [t for t in task_dag if t.get("id") != dag_task_id]
        for t in new_dag:
            t["dependencies"] = [d for d in t.get("dependencies", []) if d != dag_task_id]

        plan.task_dag = new_dag
        await self._send_system_message(
            db, f"已移除任务「{target.get('title', dag_task_id)}」。"
            + (f" 剩余 {len(new_dag)} 个任务。" if new_dag else " 所有任务已清空。")
        )

    async def confirm_plan(self) -> None:
        """外部入口：通过 WS plan.action 确认计划。"""
        lock = Orchestrator._locks.setdefault(self.session_id, asyncio.Lock())
        async with lock:
            async with async_session() as db:
                plan = await self._get_or_create_active_plan(db)
                if not plan or plan.phase != "confirmed":
                    return
                await self._do_confirm_plan(db, plan)
                await db.commit()
            await self._flush_pending_events()

    async def delete_dag_task(self, dag_task_id: str) -> None:
        """外部入口：通过 WS plan.action 删除任务。"""
        lock = Orchestrator._locks.setdefault(self.session_id, asyncio.Lock())
        async with lock:
            async with async_session() as db:
                plan = await self._get_or_create_active_plan(db)
                if not plan or plan.phase != "confirmed":
                    return
                await self._do_delete_dag_task(db, plan, dag_task_id)
                await db.commit()
            await self._flush_pending_events()

    # ── 阶段：executing（迭代执行）─────────────────────────────

    async def _phase_executing(self, db: AsyncSession, plan: Plan, user_message: str) -> None:
        """执行阶段处理用户输入（重试等）。"""
        lower = user_message.strip().lower()
        if lower in ["重试", "retry", "再试一次", "try again"]:
            # 找到失败/争议的任务重试
            result = await db.execute(
                select(Task).where(
                    Task.plan_id == plan.id,
                    Task.status.in_(["dispute", "retry", "blocked"]),
                ).order_by(Task.priority.desc())
            )
            failed = list(result.scalars().all())
            if failed:
                task = failed[0]
                task.status = "pending"
                task.retry_count = 0
                task.error_message = None
                await db.flush()
                await self._send_system_message(db, f"正在重试任务：{task.title}…")
                # 重新执行（需要重建 id_map）
                await self._execute_ready_tasks_from_db(db, plan)
            else:
                await self._send_system_message(db, "没有失败的任务需要重试。")

        else:
            await self._send_system_message(
                db, "正在执行任务中。输入「重试」可重试失败的任务。"
            )

    # ── 任务执行 ──────────────────────────────────────────────

    async def _execute_ready_tasks_from_db(self, db: AsyncSession, plan: Plan) -> None:
        """从数据库重建 id_map 并执行就绪任务。"""
        task_dag = plan.task_dag or []
        result = await db.execute(select(Task).where(Task.plan_id == plan.id))
        all_tasks = {t.title: t.id for t in result.scalars().all()}

        id_map: dict[str, str] = {}
        for td in task_dag:
            db_id = all_tasks.get(td["title"])
            if db_id:
                id_map[td["id"]] = db_id

        await self._execute_ready_tasks(db, plan, id_map)

    async def _execute_ready_tasks(
        self, db: AsyncSession, plan: Plan, id_map: dict[str, str]
    ) -> None:
        """找到所有依赖已满足的 pending 任务，并行执行。最多 3 并发（SubagentLimiter 信号量控制）。"""
        task_dag = plan.task_dag or []

        result = await db.execute(select(Task.id, Task.status).where(Task.plan_id == plan.id))
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
        if self._check_stop():
            await self._send_system_message(db, "任务执行已停止。")
            return

        logger.info("并行执行 %d 个就绪任务", len(ready))

        async def run_one(task_id: str) -> None:
            """在独立的 DB session 中执行一个任务。"""
            async with async_session() as task_db:
                task = await task_db.get(Task, task_id)
                task_plan = await task_db.get(Plan, plan.id)
                if task and task_plan and task.status == "pending":
                    await self._execute_single_task(task_db, task_plan, task)
                await task_db.commit()
            await self._flush_pending_events()

        await asyncio.gather(*[run_one(tid) for _, tid in ready])

        # 用主 session 检查是否全部完成，继续下一批
        if not self._check_stop() and not await self._check_all_done(db, plan):
            await self._execute_ready_tasks_from_db(db, plan)

    async def _execute_single_task(self, db: AsyncSession, plan: Plan, task: Task) -> None:
        """执行单个任务：中间件 → Agent → 标记 done。MVP 跳过 Review。"""

        # 获取对话历史供中间件使用
        conversation_history = await self._get_conversation_history(db)

        # 运行中间件链（ContextSummarizer → LoopDetector → SubagentLimiter）
        mw_ctx = MiddlewareContext(
            session_id=self.session_id,
            task_id=task.id,
            conversation_history=conversation_history,
            task_payload={"title": task.title, "description": task.description},
        )
        mw_ctx = await self.middleware.run(mw_ctx)
        if mw_ctx.blocked:
            task.status = "blocked"
            task.error_message = mw_ctx.block_reason
            await self._send_system_message(db, f"任务「{task.title}」被阻止：{mw_ctx.block_reason}")
            return

        # 获取并发许可
        await self.middleware.subagent_limiter.acquire(self.session_id)
        adapter = None
        try:
            # 获取 Agent
            agent, adapter = await self._get_agent_adapter(db, task.assigned_agent_id)
            if not agent or not adapter:
                task.status = "blocked"
                task.error_message = "找不到合适的 Agent"
                await self._send_system_message(db, f"任务「{task.title}」没有可用的 Agent。")
                return

            # 开始执行
            task.status = "in_progress"
            task.started_at = _utcnow()
            await db.flush()
            await self._publish_task_update(task, "in_progress")

            # 构建上下文并调用 Agent（使用中间件处理后的历史）
            context = AgentContext(
                session_id=self.session_id,
                agent_role=AgentRole.CODER,
                conversation_history=mw_ctx.conversation_history,
                current_task={"id": task.id, "title": task.title, "description": task.description},
                config={"system_prompt": CODER_TASK_PROMPT},
            )

            try:
                async with tracer.span(
                    session_id=self.session_id,
                    operation_name=f"adapter.execute_task",
                    service_name=adapter.adapter_type,
                    tags={"task_id": task.id, "task_title": task.title},
                ) as span:
                    response = await adapter.execute_task(context, {
                        "id": task.id,
                        "title": task.title,
                        "description": task.description,
                    })
                    span["tags"]["tokens_used"] = response.metadata.get("tokens_used", 0)
                task.result = response.content
                task.status = "done"
                task.completed_at = _utcnow()
                await db.flush()

                # 提取代码块 → Artifact
                artifacts = await self._extract_artifacts(db, task, response.content)
                await self._publish_task_update(task, "done")

                # Reviewer 审查
                reviewed = await self._review_task_output(db, task, response.content)
                if not reviewed:
                    # 审查不通过 → 回退重试（已在 _review_task_output 中更新状态）
                    await self._execute_single_task(db, plan, task)
                    return

                # 发送结果摘要 + Diff 卡片
                preview = response.content[:300] + ("…" if len(response.content) > 300 else "")
                lines = [f"✅ 任务「{task.title}」完成。"]
                if artifacts:
                    lines.append(f"\n生成了 {len(artifacts)} 个文件：")
                    lines.extend(f"  • `{a['file_path']}`" for a in artifacts)
                else:
                    lines.append(f"\n{preview}")
                await self._send_system_message(db, "\n".join(lines))

            except Exception as e:
                logger.exception("任务执行失败: %s", e)
                task.error_message = str(e)

                if task.retry_count < (task.max_retries or self.MAX_TASK_RETRIES):
                    task.status = "retry"
                    task.retry_count += 1
                    await self._send_system_message(
                        db, f"任务「{task.title}」失败（第 {task.retry_count} 次尝试）：{e}。正在重试…"
                    )
                    await self._execute_single_task(db, plan, task)
                    return
                else:
                    task.status = "dispute"
                    await self._send_system_message(
                        db,
                        f"❌ 任务「{task.title}」在 {self.MAX_TASK_RETRIES + 1} 次尝试后仍失败：{e}。\n"
                        "输入「重试」重新执行，或检查 Agent 配置。"
                    )
                    return
        finally:
            if adapter:
                try:
                    await adapter.stop()
                except Exception:
                    logger.exception("关闭适配器失败: %s", adapter.adapter_type)
            self.middleware.subagent_limiter.release(self.session_id)

    # ── 辅助方法 ──────────────────────────────────────────────

    async def _get_or_create_active_plan(self, db: AsyncSession) -> Optional[Plan]:
        """获取活跃 Plan，不存在则创建新的 clarify 阶段 Plan。"""
        result = await db.execute(
            select(Plan).where(
                Plan.session_id == self.session_id,
                Plan.status == "active",
            )
        )
        plan = result.scalar_one_or_none()
        if not plan:
            plan = Plan(
                session_id=self.session_id,
                phase="clarify",
                status="active",
            )
            db.add(plan)
            await db.flush()
        return plan

    async def _get_session_agent_ids(self, db: AsyncSession) -> list[str]:
        result = await db.execute(
            select(SessionAgent).where(SessionAgent.session_id == self.session_id)
        )
        return [b.agent_id for b in result.scalars().all()]

    # 角色关键词 → 标准角色名映射
    ROLE_KEYWORDS = {
        "critic": "critic", "planner": "planner", "coder": "coder",
        "reviewer": "reviewer", "architect": "planner",
        "审核": "reviewer", "审查": "reviewer", "规划": "planner",
        "编程": "coder", "写代码": "coder", "评论": "critic",
    }

    async def _get_agent_for_role(
        self, db: AsyncSession, role: str
    ) -> tuple[Optional[Agent], Optional[BaseAdapter]]:
        """根据角色选择合适的 Agent。

        优先使用 @mention 指定的 Agent：
        - 如果 mention 名字匹配某个 role 关键词 → 用 mention 名字解析到的 agent
        - 否则回退到索引策略
        """
        agent_ids = await self._get_session_agent_ids(db)
        if not agent_ids:
            return None, None

        # 先尝试从 @mentions 中解析角色
        mentions = getattr(self, "_mentions", []) or []
        target_role_keywords = {role}  # e.g. {"coder"}
        # 添加映射到此角色的其他关键词
        for kw, r in self.ROLE_KEYWORDS.items():
            if r == role:
                target_role_keywords.add(kw)

        # 查找 mention 中匹配当前角色的关键词
        mention_to_role: dict[str, str] = {}
        for m in mentions:
            ml = m.lower()
            for kw, r in self.ROLE_KEYWORDS.items():
                if kw in ml:
                    mention_to_role[m] = r
                    break

        # 如果当前角色被某个 mention 指定了，找到对应的 agent
        for m_name, m_role in mention_to_role.items():
            if m_role == role:
                # 按名字匹配 session agent
                for aid in agent_ids:
                    agent = await db.get(Agent, aid)
                    if agent and (agent.name == m_name or agent.name.lower() in m_name.lower()):
                        return await self._get_agent_adapter(db, aid)
                # 如果名字没匹配到，但角色匹配了，尝试索引
                break

        # 对于没有通过 @mention 匹配到的 mention，尝试直接按名字匹配 agent
        for m in mentions:
            for aid in agent_ids:
                agent = await db.get(Agent, aid)
                if agent and agent.name == m:
                    # 此 mention 按名字匹配到 agent，检查是否适合当前角色
                    if role in ("critic", "planner"):
                        return await self._get_agent_adapter(db, aid)

        # 回退：索引策略
        index_map = {
            "critic": 0,
            "planner": 0,
            "coder": min(1, len(agent_ids) - 1),
            "reviewer": min(2, len(agent_ids) - 1),
        }
        idx = index_map.get(role, 0)
        return await self._get_agent_adapter(db, agent_ids[idx])

    async def _get_agent_adapter(
        self, db: AsyncSession, agent_id: Optional[str]
    ) -> tuple[Optional[Agent], Optional[BaseAdapter]]:
        if not agent_id:
            return None, None
        agent = await db.get(Agent, agent_id)
        if not agent:
            return None, None
        adapter = create_adapter(agent.adapter_type)
        await adapter.initialize({
            "api_key": None,  # 使用 settings 环境变量兜底
            "model": None,    # 使用适配器默认模型
            "system_prompt": agent.system_prompt or None,
        })
        return agent, adapter

    async def _resolve_agent_id(self, db: AsyncSession, role: str) -> Optional[str]:
        """把 agent_role 字符串解析为实际的 agent_id。"""
        agent, _ = await self._get_agent_for_role(db, role)
        return agent.id if agent else None

    async def _get_conversation_history(self, db: AsyncSession) -> list[dict]:
        """获取最近 30 条消息作为对话历史。"""
        result = await db.execute(
            select(Message)
            .where(Message.session_id == self.session_id)
            .order_by(Message.created_at.desc())
            .limit(30)
        )
        msgs = list(reversed(result.scalars().all()))
        return [
            {"role": "assistant" if m.role == "agent" else m.role, "content": m.content}
            for m in msgs
        ]

    async def _send_system_message(self, db: AsyncSession, content: str) -> Message:
        """持久化系统消息。事件在事务 commit 后统一发布。"""
        msg = Message(
            session_id=self.session_id,
            role="system",
            content=content,
            message_type="system",
        )
        db.add(msg)
        await db.flush()
        self._pending_events.append({
            "type": "chat.message",
            "session_id": self.session_id,
            "payload": {
                "id": msg.id,
                "role": "system",
                "content": content,
                "message_type": "system",
                "created_at": _utcnow().isoformat(),
            },
        })
        return msg

    async def _publish_task_update(self, task: Task, status: str) -> None:
        """收集任务状态变更事件，事务 commit 后统一发布。"""
        self._pending_events.append({
            "type": "task.update",
            "session_id": self.session_id,
            "payload": {
                "task_id": task.id,
                "title": task.title,
                "status": status,
                "result": task.result,
                "error": task.error_message,
            },
        })

    async def _publish_error(self, message: str) -> None:
        """发布错误消息到 EventBus（立即发布，不走 pending 队列）。"""
        await event_bus.publish(self.session_id, {
            "type": "chat.message",
            "session_id": self.session_id,
            "payload": {
                "id": "",
                "role": "system",
                "content": f"[编排器错误] {message}",
                "message_type": "system",
                "created_at": _utcnow().isoformat(),
            },
        })

    async def _flush_pending_events(self) -> None:
        """在事务提交后批量发布收集的事件。"""
        try:
            for event in self._pending_events:
                await event_bus.publish(self.session_id, event)
        finally:
            self._pending_events.clear()

    async def _check_all_done(self, db: AsyncSession, plan: Plan) -> bool:
        """检查所有任务是否完成。全部完成则标记 plan 为 done。"""
        result = await db.execute(select(Task).where(Task.plan_id == plan.id))
        all_tasks = list(result.scalars().all())
        if all_tasks and all(t.status == "done" for t in all_tasks):
            plan.phase = "done"
            plan.status = "completed"
            await self._send_system_message(db, "🎉 所有任务已完成！")
            return True
        return False

    def _extract_json_array(self, text: str) -> Optional[list]:
        """从 LLM 输出中提取 JSON 数组（处理 markdown 代码块和嵌套对象）。"""
        # 先去掉 markdown 代码块标记
        cleaned = re.sub(r'```(?:json)?\s*|\s*```', '', text)
        # 找最外层的 JSON 数组
        start = cleaned.find('[')
        if start >= 0:
            # 从 start 开始，逐字符追踪括号深度，找到匹配的 ]
            depth = 0
            end = start
            for i in range(start, len(cleaned)):
                c = cleaned[i]
                if c == '[':
                    depth += 1
                elif c == ']':
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            if end > start:
                try:
                    result = json.loads(cleaned[start:end])
                    if isinstance(result, list):
                        return result
                except json.JSONDecodeError:
                    pass
        # 尝试整段解析
        try:
            result = json.loads(cleaned)
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass
        return None

    def _extract_json(self, text: str) -> Optional[dict]:
        """从 LLM 输出中提取 JSON 对象（处理嵌套大括号）。"""
        cleaned = re.sub(r'```(?:json)?\s*|\s*```', '', text)
        start = cleaned.find('{')
        if start >= 0:
            depth = 0
            end = start
            for i in range(start, len(cleaned)):
                c = cleaned[i]
                if c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            if end > start:
                try:
                    result = json.loads(cleaned[start:end])
                    if isinstance(result, dict):
                        return result
                except json.JSONDecodeError:
                    pass
        try:
            result = json.loads(cleaned)
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass
        return None

    async def _extract_artifacts(
        self, db: AsyncSession, task: Task, content: str
    ) -> list[dict]:
        """从 Agent 输出中提取代码块，创建 Artifact 记录并发布事件。"""
        from app.models.artifact import Artifact
        from app.services.adapters.base import AgentResponse

        artifacts: list[dict] = []

        # 匹配 markdown 代码块：```language\n code \n```
        code_blocks = re.finditer(
            r'`{3}(\w*)\s*\n(.*?)`{3}', content, re.DOTALL
        )
        for match in code_blocks:
            language = match.group(1) or "text"
            code = match.group(2).strip()
            if len(code) < 10:
                continue

            # 尝试从注释或上下文中提取文件路径
            file_path = self._guess_file_path(content, code, language)

            artifact = Artifact(
                task_id=task.id,
                session_id=self.session_id,
                file_path=file_path,
                original_content="",
                modified_content=code,
                language=language,
                artifact_type="code",
            )
            db.add(artifact)
            await db.flush()

            art_data = {
                "id": artifact.id,
                "file_path": artifact.file_path,
                "language": artifact.language,
                "modified_content": code,
            }
            artifacts.append(art_data)

            self._pending_events.append({
                "type": "artifact.created",
                "session_id": self.session_id,
                "payload": {
                    "artifact_id": artifact.id,
                    "task_id": task.id,
                    "file_path": file_path,
                    "language": language,
                    "content_preview": code[:200],
                },
            })

        # 如果没有代码块，将整个输出作为一个文档制品
        if not artifacts and len(content) > 50:
            artifact = Artifact(
                task_id=task.id,
                session_id=self.session_id,
                file_path=f"output/task-{task.title[:30]}.md",
                original_content="",
                modified_content=content,
                language="markdown",
                artifact_type="code",
            )
            db.add(artifact)
            await db.flush()
            art_data = {
                "id": artifact.id,
                "file_path": artifact.file_path,
                "language": "markdown",
                "modified_content": content,
            }
            artifacts.append(art_data)

            self._pending_events.append({
                "type": "artifact.created",
                "session_id": self.session_id,
                "payload": {
                    "artifact_id": artifact.id,
                    "task_id": task.id,
                    "file_path": artifact.file_path,
                    "language": "markdown",
                    "content_preview": content[:200],
                },
            })

        return artifacts

    def _guess_file_path(self, full_content: str, code: str, language: str) -> str:
        """从注释或上下文猜测文件路径，防止路径穿越。"""
        path_match = re.search(
            r'(?:File|文件|path):\s*([^\s\n]+)', full_content, re.IGNORECASE
        )
        if path_match:
            raw = path_match.group(1)
            # 清理路径穿越字符
            raw = re.sub(r'\.\.+', '', raw)
            raw = raw.lstrip('/\\~')
            return raw

        ext_map = {
            "python": "output.py", "py": "output.py",
            "typescript": "output.ts", "ts": "output.ts",
            "tsx": "component.tsx", "jsx": "component.jsx",
            "javascript": "output.js", "js": "output.js",
            "html": "index.html", "css": "styles.css",
            "json": "config.json", "yaml": "config.yaml",
            "sql": "query.sql", "rust": "main.rs",
            "go": "main.go", "java": "Main.java",
        }
        return ext_map.get(language.lower(), f"output.{language or 'txt'}")

    async def _review_task_output(
        self, db: AsyncSession, task: Task, output: str
    ) -> bool:
        """调用 Reviewer Agent 审查任务输出。返回 True 表示通过。"""
        reviewer_agent, reviewer_adapter = await self._get_agent_for_role(db, "reviewer")
        if not reviewer_agent or not reviewer_adapter:
            return True  # 无 reviewer 则默认通过

        try:
            review_ctx = AgentContext(
                session_id=self.session_id,
                agent_role=AgentRole.REVIEWER,
                current_task={"id": task.id, "title": task.title, "description": task.description or ""},
                config={"system_prompt": REVIEWER_PROMPT_PREFIX},
            )
            review_input = (
                f"Task: {task.title}\n"
                f"Description: {task.description or 'N/A'}\n\n"
                f"Code output to review:\n\n{output[:4000]}"
            )
            review_resp = await reviewer_adapter.send_message(review_ctx, review_input)
            review_data = self._extract_json(review_resp.content)

            if review_data and not review_data.get("passed", True):
                task.status = "retry"
                task.retry_count += 1
                task.error_message = review_data.get("feedback", "")
                await db.flush()
                await self._publish_task_update(task, "retry")
                await self._send_system_message(
                    db,
                    f"🔍 Reviewer: {review_data.get('feedback', '审查未通过')}\n"
                    f"📝 建议: {review_data.get('suggested_changes', '')[:300]}"
                )
                return False
        except Exception as e:
            logger.warning("Reviewer 调用失败，跳过审查: %s", e)
        finally:
            try:
                await reviewer_adapter.stop()
            except Exception:
                pass
        return True

    async def _parse_approach_selection(
        self, user_message: str, approaches: list[dict]
    ) -> Optional[dict]:
        """将用户输入匹配到方案（按名称或序号）。"""
        lower = user_message.strip().lower()
        # 尝试名称匹配
        for a in approaches:
            name = a.get("name", "")
            if name.lower() in lower or lower in name.lower():
                return a
        # 尝试序号匹配（"1"、"选项1"、"option 1"）
        num_match = re.search(r'(\d+)', lower)
        if num_match:
            idx = int(num_match.group(1)) - 1
            if 0 <= idx < len(approaches):
                return approaches[idx]
        return None
