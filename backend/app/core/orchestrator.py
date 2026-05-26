"""编排器 —— 群聊多 Agent 协作的逐消息状态机。

生命周期：每条用户消息触发一次 handle_message() 调用：
  读取 Plan.phase → 路由到对应 PhaseHandler → 调用适配器 → 发布到 EventBus → 返回
  下一条用户消息触发下一步。

四阶段模型：clarify（澄清）→ comparison（对比）→ confirmed（确认）→ executing（执行）→ done（完成）

Phase 逻辑已拆分到 core/phases/ 目录，Orchestrator 只负责锁管理、中间件、事件发布和路由。
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from app.core.database import async_session
from app.core.event_bus import event_bus
from app.core.middleware import MiddlewareChain
from app.core.phases.base import PhaseContext
from app.core.phases.registry import PHASE_REGISTRY
from app.models.agent import Agent
from app.models.message import Message
from app.models.plan import Plan
from app.models.session import SessionAgent
from app.models.task import Task, TaskDependency
from app.services.adapters import create_adapter
from app.services.adapters.base import BaseAdapter

logger = logging.getLogger(__name__)


def _utcnow():
    return datetime.now(timezone.utc)


class Orchestrator:
    """群聊多 Agent 编排器 —— 薄路由层。

    锁管理、中间件、事件发布保留在此。Phase 逻辑在 core/phases/ 中。
    """

    _locks: dict[str, asyncio.Lock] = {}
    _stop_events: dict[str, asyncio.Event] = {}

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.middleware = MiddlewareChain()
        self._pending_events: list[dict] = []

    # ── Session 控制 ─────────────────────────────────────────

    @classmethod
    def stop_session(cls, session_id: str) -> None:
        event = cls._stop_events.setdefault(session_id, asyncio.Event())
        event.set()

    @classmethod
    def resume_session(cls, session_id: str) -> None:
        event = cls._stop_events.get(session_id)
        if event:
            event.clear()

    @classmethod
    def is_session_stopped(cls, session_id: str) -> bool:
        event = cls._stop_events.get(session_id)
        return event is not None and event.is_set()

    def _check_stop(self) -> bool:
        return self.is_session_stopped(self.session_id)

    # ── 公开入口 ──────────────────────────────────────────────

    async def handle_message(self, user_message: str, mentions: Optional[list[str]] = None) -> None:
        lock = Orchestrator._locks.setdefault(self.session_id, asyncio.Lock())
        async with lock:
            await self._handle_message_locked(user_message, mentions or [])

    async def _handle_message_locked(self, user_message: str, mentions: list[str]) -> None:
        try:
            async with async_session() as db:
                plan = await self._get_or_create_active_plan(db)
                if not plan:
                    await self._publish_error("无法获取或创建 Plan")
                    return

                agent_ids = await self._get_session_agent_ids(db)
                if len(agent_ids) < 2 and plan.phase == "clarify":
                    msg = Message(
                        session_id=self.session_id,
                        role="system",
                        content="💡 提示：当前群聊只有 1 个 Agent，它将同时扮演 Critic/Planner/Coder/Reviewer 多重角色。建议添加更多 Agent 以获得更好的协作效果。",
                        message_type="system",
                    )
                    db.add(msg)
                    await db.flush()
                    self._pending_events.append({
                        "type": "chat.message",
                        "session_id": self.session_id,
                        "payload": {
                            "id": msg.id, "role": "system", "content": msg.content,
                            "message_type": "system", "created_at": _utcnow().isoformat(),
                        },
                    })

                plan.updated_at = _utcnow()
                phase = plan.phase
                pending: list[dict] = []
                ctx = PhaseContext(
                    db=db, plan=plan, user_message=user_message,
                    mentions=mentions, pending_events=pending, orchestrator=self,
                )

                if phase in PHASE_REGISTRY:
                    handler = PHASE_REGISTRY[phase]
                    next_phase = await handler.execute(ctx)
                    self._pending_events.extend(pending)

                    # 自动推进到下一阶段
                    if next_phase:
                        plan.phase = next_phase
                        if next_phase in PHASE_REGISTRY:
                            next_pending: list[dict] = []
                            next_ctx = PhaseContext(
                                db=db, plan=plan, user_message="",
                                mentions=mentions, pending_events=next_pending,
                                orchestrator=self,
                            )
                            next_handler = PHASE_REGISTRY[next_phase]
                            further = await next_handler.execute(next_ctx)
                            self._pending_events.extend(next_pending)

                            if further:
                                plan.phase = further
                                # 进入 executing：执行任务
                                if further == "executing":
                                    exec_pending: list[dict] = []
                                    exec_ctx = PhaseContext(
                                        db=db, plan=plan, user_message="",
                                        mentions=mentions, pending_events=exec_pending,
                                        orchestrator=self,
                                    )
                                    from app.core.phases.executing import ExecutingHandler
                                    exec_handler = ExecutingHandler()
                                    await exec_handler.execute_tasks(exec_ctx)
                                    self._pending_events.extend(exec_pending)

                elif phase == "done":
                    self.middleware.reset_session(self.session_id)
                    if len(user_message.strip()) > 5:
                        plan.phase = "clarify"
                        plan.task_dag = {}
                        plan.approaches = None
                        msg = await self._persist_system_message(
                            db, "检测到新需求，重新开始工作流。",
                        )
                        # 递归进入 clarify
                        clarify_pending: list[dict] = []
                        clarify_ctx = PhaseContext(
                            db=db, plan=plan, user_message=user_message,
                            mentions=mentions, pending_events=clarify_pending,
                            orchestrator=self,
                        )
                        next_ph = await PHASE_REGISTRY["clarify"].execute(clarify_ctx)
                        self._pending_events.extend(clarify_pending)
                        if next_ph:
                            plan.phase = next_ph
                    else:
                        msg = await self._persist_system_message(
                            db, "所有任务已完成。请发送新的需求，或创建新的会话。",
                        )
                else:
                    logger.warning("未知的 Plan 阶段: %s", phase)

                await db.commit()
            await self._flush_pending_events()
        except Exception as e:
            logger.exception("Orchestrator.handle_message 失败: %s", e)
            await self._publish_error(f"编排器出错：{e}")

    # ── 外部 API（WS plan.action 入口）────────────────────────

    async def select_approach(self, approach_name: str) -> None:
        lock = Orchestrator._locks.setdefault(self.session_id, asyncio.Lock())
        async with lock:
            async with async_session() as db:
                plan = await self._get_or_create_active_plan(db)
                if not plan or plan.phase != "comparison":
                    return
                approaches = plan.approaches or []
                selected = None
                for a in approaches:
                    if a.get("name", "") == approach_name or approach_name in a.get("name", ""):
                        selected = a
                        break
                if not selected:
                    try:
                        idx = int(approach_name.strip()) - 1
                        if 0 <= idx < len(approaches):
                            selected = approaches[idx]
                    except ValueError:
                        pass
                if not selected:
                    return
                plan.selected_approach = selected.get("name", "")
                plan.phase = "confirmed"

                msg = await self._persist_system_message(
                    db, f"已选择方案：{selected.get('name', '')}。正在生成任务计划…",
                )
                pending: list[dict] = []
                ctx = PhaseContext(
                    db=db, plan=plan, user_message="",
                    mentions=[], pending_events=pending, orchestrator=self,
                )
                next_phase = await PHASE_REGISTRY["confirmed"].execute(ctx)
                self._pending_events.extend(pending)
                if next_phase:
                    plan.phase = next_phase
                await db.commit()
            await self._flush_pending_events()

    async def confirm_plan(self) -> None:
        lock = Orchestrator._locks.setdefault(self.session_id, asyncio.Lock())
        async with lock:
            async with async_session() as db:
                plan = await self._get_or_create_active_plan(db)
                if not plan or plan.phase != "confirmed":
                    return
                pending: list[dict] = []
                ctx = PhaseContext(
                    db=db, plan=plan, user_message="确认",
                    mentions=[], pending_events=pending, orchestrator=self,
                )
                next_phase = await PHASE_REGISTRY["confirmed"].execute(ctx)
                self._pending_events.extend(pending)
                if next_phase == "executing":
                    plan.phase = "executing"
                    exec_pending: list[dict] = []
                    exec_ctx = PhaseContext(
                        db=db, plan=plan, user_message="",
                        mentions=[], pending_events=exec_pending, orchestrator=self,
                    )
                    from app.core.phases.executing import ExecutingHandler
                    await ExecutingHandler().execute_tasks(exec_ctx)
                    self._pending_events.extend(exec_pending)
                await db.commit()
            await self._flush_pending_events()

    async def delete_dag_task(self, dag_task_id: str) -> None:
        lock = Orchestrator._locks.setdefault(self.session_id, asyncio.Lock())
        async with lock:
            async with async_session() as db:
                plan = await self._get_or_create_active_plan(db)
                if not plan or plan.phase != "confirmed":
                    return
                pending: list[dict] = []
                ctx = PhaseContext(
                    db=db, plan=plan, user_message=f"删除 {dag_task_id}",
                    mentions=[], pending_events=pending, orchestrator=self,
                )
                await PHASE_REGISTRY["confirmed"].execute(ctx)
                self._pending_events.extend(pending)
                await db.commit()
            await self._flush_pending_events()

    # ── 内部辅助 ──────────────────────────────────────────────

    async def _get_or_create_active_plan(self, db):
        result = await db.execute(
            select(Plan).where(
                Plan.session_id == self.session_id, Plan.status == "active",
            )
        )
        plan = result.scalar_one_or_none()
        if not plan:
            plan = Plan(session_id=self.session_id, phase="clarify", status="active")
            db.add(plan)
            await db.flush()
        return plan

    async def _get_session_agent_ids(self, db) -> list[str]:
        result = await db.execute(
            select(SessionAgent).where(SessionAgent.session_id == self.session_id)
        )
        return [b.agent_id for b in result.scalars().all()]

    async def _persist_system_message(self, db, content: str) -> Message:
        msg = Message(
            session_id=self.session_id, role="system",
            content=content, message_type="system",
        )
        db.add(msg)
        await db.flush()
        self._pending_events.append({
            "type": "chat.message",
            "session_id": self.session_id,
            "payload": {
                "id": msg.id, "role": "system", "content": content,
                "message_type": "system", "created_at": _utcnow().isoformat(),
            },
        })
        return msg

    async def _publish_error(self, message: str) -> None:
        await event_bus.publish(self.session_id, {
            "type": "chat.message",
            "session_id": self.session_id,
            "payload": {
                "id": "", "role": "system",
                "content": f"[编排器错误] {message}",
                "message_type": "system", "created_at": _utcnow().isoformat(),
            },
        })

    async def _flush_pending_events(self) -> None:
        try:
            for event in self._pending_events:
                await event_bus.publish(self.session_id, event)
        finally:
            self._pending_events.clear()
