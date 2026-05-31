"""阶段：clarify（需求澄清）—— Critic 角色质疑需求，最多 2 轮。"""

import logging
from app.core.phases.base import BasePhaseHandler, PhaseContext
from app.core.prompts import CRITIC_SYSTEM_PROMPT
from app.services.adapters.base import AgentContext, AgentRole

logger = logging.getLogger(__name__)


class ClarifyHandler(BasePhaseHandler):
    """Critic 角色澄清需求，最多 2 轮后自动推进到 comparison。"""

    MAX_CLARIFY_ROUNDS = 2

    # 简单确定性任务模式：不需要需求澄清，直接推进
    TRIVIAL_PATTERNS = [
        # 纯计算
        r"^(计算|算|帮我算|请计算|帮我计算)\b",
        r"^[0-9+\-*/().\s^%]+$",
        r"^\d+\s*[+\-*/×÷xX]\s*\d+",
        # 纯翻译
        r"^(翻译|把|将).*(翻译|译)(成|为|一下)",
        r"^translate\b",
        # 纯事实查询
        r"^(什么是|什么叫|定义|解释一下)\b",
        r"^(what is|define|explain)\b",
    ]

    def _is_trivial_task(self, user_message: str) -> bool:
        """检测是否为简单确定性任务，无需 clarify。"""
        import re
        stripped = user_message.strip()
        for pattern in self.TRIVIAL_PATTERNS:
            if re.search(pattern, stripped, re.IGNORECASE):
                return True
        return False

    async def execute(self, ctx: PhaseContext) -> str | None:
        # 停止检查
        if self._get_stop_event(ctx.plan.session_id) and self._get_stop_event(ctx.plan.session_id).is_set():
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "⏹️ 已停止生成。",
                pending_events=ctx.pending_events,
            )
            return None

        task_dag = ctx.plan.task_dag or {}
        clarify_round = task_dag.get("clarify_round", 0)

        # 轮次 1+：必须等用户说 ok/确认 才推进（见 CONTEXT.md clarify 阶段规则）
        if clarify_round > 0:
            lower = ctx.user_message.strip().lower()
            if lower in ("确认", "confirm", "ok", "好的", "可以", "执行", "开始", "go", "yes", "是"):
                ctx.plan.phase = "comparison"
                ctx.plan.task_dag = {}
                await self._send_system_message(
                    ctx.db, ctx.plan.session_id, "需求已明确，正在生成方案…",
                    pending_events=ctx.pending_events,
                )
                return "comparison"

        # 简单确定性任务：跳过 clarify，直接进入 comparison
        if clarify_round == 0 and self._is_trivial_task(ctx.user_message):
            ctx.plan.phase = "comparison"
            ctx.plan.task_dag = {}
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "需求已明确（简单任务），正在生成方案…",
                pending_events=ctx.pending_events,
            )
            return "comparison"

        if clarify_round >= self.MAX_CLARIFY_ROUNDS:
            ctx.plan.phase = "comparison"
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "需求澄清已完成（已达最大轮次）。正在生成方案选项…",
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

        # 阶段进度提示
        await self._send_system_message(
            ctx.db, ctx.plan.session_id,
            f"🔍 **{agent.name}** 正在分析需求…",
            pending_events=ctx.pending_events, publish_now=True,
        )

        history = await self._get_conversation_history(ctx.db, ctx.plan.session_id)
        context = AgentContext(
            session_id=ctx.plan.session_id,
            agent_role=AgentRole.CODER,  # Critic 通过 system_prompt 控制行为，role 仅用于 trace
            conversation_history=history,
            config={"system_prompt": CRITIC_SYSTEM_PROMPT},
        )

        # 流式调用 + 停止检查
        content = await self._stream_agent_response(
            ctx.db, ctx.plan.session_id, adapter, agent, context,
            ctx.user_message, ctx.pending_events, "critic",
        )

        clarify_round += 1
        ctx.plan.task_dag = task_dag | {"clarify_round": clarify_round}

        # round 0（首次对话）：Critic 判断需求已足够清楚 → 直接推进
        if clarify_round == 1 and self._critic_has_signaled_done(content):
            ctx.plan.phase = "comparison"
            ctx.plan.task_dag = {}
            return "comparison"

        # round 1+：不检测信号词，必须等用户说"ok/确认"才会推进
        if clarify_round >= self.MAX_CLARIFY_ROUNDS:
            ctx.plan.phase = "comparison"
            ctx.plan.task_dag = {}
            return "comparison"

        return None

    def _critic_has_signaled_done(self, content: str) -> bool:
        signals = [
            "不再需要澄清", "可以往下推进", "需求已经明确", "需求已明确",
            "可以推进到方案阶段", "可以开始了", "准备好了",
            "no further clarification", "ready to proceed", "requirements are clear",
            "ready to move on", "no more questions", "i am ready",
            "assumptions", "proceed with", "move forward",
        ]
        lower = content.lower()
        return any(s.lower() in lower for s in signals)
