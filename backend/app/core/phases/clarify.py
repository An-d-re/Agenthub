"""阶段：clarify（需求澄清）—— Critic 角色质疑需求，最多 2 轮。"""

import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.phases.base import BasePhaseHandler, PhaseContext, _utcnow
from app.core.prompts import CRITIC_SYSTEM_PROMPT
from app.models.message import Message
from app.services.adapters.base import AgentContext, AgentRole

logger = logging.getLogger(__name__)


class ClarifyHandler(BasePhaseHandler):
    """Critic 角色澄清需求，最多 2 轮后自动推进到 comparison。"""

    MAX_CLARIFY_ROUNDS = 2

    async def execute(self, ctx: PhaseContext) -> str | None:
        task_dag = ctx.plan.task_dag or {}
        clarify_round = task_dag.get("clarify_round", 0)

        if clarify_round >= self.MAX_CLARIFY_ROUNDS:
            ctx.plan.phase = "comparison"
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "需求澄清已完成。正在生成方案选项…",
                pending_events=ctx.pending_events,
            )
            return "comparison"

        agent, adapter = await self._get_agent_for_role(
            ctx.db, ctx.plan.session_id, "critic", ctx.mentions,
        )
        if not agent or not adapter:
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "会话中没有可用的 Agent，请先添加 Agent。",
                pending_events=ctx.pending_events,
            )
            return None

        history = await self._get_conversation_history(ctx.db, ctx.plan.session_id)
        context = AgentContext(
            session_id=ctx.plan.session_id,
            agent_role=AgentRole.PLANNER,
            conversation_history=history,
            config={"system_prompt": CRITIC_SYSTEM_PROMPT},
        )

        response = await adapter.send_message(context, ctx.user_message)
        content = response.content

        msg = Message(
            session_id=ctx.plan.session_id,
            agent_id=agent.id,
            role="agent",
            content=content,
            message_type="system",
        )
        ctx.db.add(msg)
        await ctx.db.flush()

        ctx.pending_events.append({
            "type": "chat.message",
            "session_id": ctx.plan.session_id,
            "payload": {
                "id": msg.id, "agent_id": agent.id, "agent_role": "critic",
                "role": "agent", "content": content, "message_type": "system",
                "created_at": _utcnow().isoformat(),
            },
        })

        clarify_round += 1
        ctx.plan.task_dag = task_dag | {"clarify_round": clarify_round}

        if clarify_round >= self.MAX_CLARIFY_ROUNDS or self._critic_has_signaled_done(content):
            ctx.plan.phase = "comparison"
            ctx.plan.task_dag = {}
            return "comparison"

        return None

    def _critic_has_signaled_done(self, content: str) -> bool:
        signals = ["不再需要澄清", "可以往下推进", "需求已经明确", "可以开始了", "准备好了"]
        lower = content.lower()
        return any(s.lower() in lower for s in signals)
