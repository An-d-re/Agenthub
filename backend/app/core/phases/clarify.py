"""阶段：clarify（需求澄清）—— Critic 角色质疑需求，最多 2 轮。"""

import logging
import re
from app.core.phases.base import BasePhaseHandler, PhaseContext
from app.core.prompts import CRITIC_SYSTEM_PROMPT
from app.services.adapters.base import AgentContext, AgentRole

logger = logging.getLogger(__name__)


class ClarifyHandler(BasePhaseHandler):
    """Critic 角色澄清需求，最多 2 轮后自动推进到 comparison。"""

    MAX_CLARIFY_ROUNDS = 2

    # 纯数学算式：跳过 LLM 复杂度评估，直接判 simple
    MATH_ONLY_RE = re.compile(
        r"^[\d+\-*/().\s^%×÷xX]+$|^\d+\s*[+\-*/×÷xX]\s*\d+"
    )

    async def _assess_complexity(self, ctx: PhaseContext) -> str:
        """快速调用 Critic 判断任务简单/复杂。返回 'simple' 或 'complex'。"""
        # 纯数字算式 → 直接跳过 LLM
        if self.MATH_ONLY_RE.match(ctx.user_message.strip()):
            return "simple"

        agent, adapter = await self._get_agent_for_role(
            ctx.db, ctx.plan.session_id, "critic", ctx.mentions,
        )
        if not agent or not adapter:
            return "complex"

        try:
            context = AgentContext(
                session_id=ctx.plan.session_id,
                agent_role=AgentRole.CODER,
                config={"system_prompt": (
                    "You are a task complexity assessor. "
                    "Given a user request, reply with exactly ONE word: "
                    '"simple" if the task is a straightforward computation, fact lookup, '
                    "translation, or single-step operation that needs NO clarification. "
                    '"complex" if it involves multi-step reasoning, code generation, '
                    "ambiguous requirements, design decisions, or anything needing discussion.\n\n"
                    'Reply ONLY with "simple" or "complex".'
                )},
            )
            resp = await adapter.send_message(context, ctx.user_message)
            await adapter.stop()
            result = resp.content.strip().lower()
            if "simple" in result and "complex" not in result:
                return "simple"
            return "complex"
        except Exception as e:
            logger.warning("复杂度评估失败，默认走完整 clarify: %s", e)
            return "complex"

    async def execute(self, ctx: PhaseContext) -> str | None:
        # 停止检查
        if self._get_stop_event(ctx.plan.session_id) and self._get_stop_event(ctx.plan.session_id).is_set():
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "⏹️ 已停止生成。",
                pending_events=ctx.pending_events,
            )
            return None

        clarify_round = ctx.plan.clarify_round or 0

        # 轮次 1+：必须等用户说 ok/确认 才推进
        if clarify_round > 0:
            lower = ctx.user_message.strip().lower()
            if lower in ("确认", "confirm", "ok", "好的", "可以", "执行", "开始", "go", "yes", "是"):
                ctx.plan.phase = "comparison"
                ctx.plan.task_dag = {}
                ctx.plan.clarify_round = 0
                await self._send_system_message(
                    ctx.db, ctx.plan.session_id, "需求已明确，正在生成方案…",
                    pending_events=ctx.pending_events,
                )
                return "comparison"

        # 首次对话：LLM 复杂度评估 → 简单任务跳过 clarify
        if clarify_round == 0:
            complexity = await self._assess_complexity(ctx)
            if complexity == "simple":
                ctx.plan.phase = "comparison"
                ctx.plan.task_dag = {}
                ctx.plan.clarify_round = 0
                await self._send_system_message(
                    ctx.db, ctx.plan.session_id, "需求已明确（简单任务），正在生成方案…",
                    pending_events=ctx.pending_events,
                )
                return "comparison"

        if clarify_round >= self.MAX_CLARIFY_ROUNDS:
            ctx.plan.phase = "comparison"
            ctx.plan.clarify_round = 0
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "需求澄清已完成（已达最大轮次）。正在生成方案选项…",
                pending_events=ctx.pending_events,
            )
            return "comparison"

        agent, adapter = await self._get_agent_for_role(
            ctx.db, ctx.plan.session_id, "critic", ctx.mentions,
        )
        if not agent or not adapter:
            clarify_round += 1
            ctx.plan.clarify_round = clarify_round
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "会话中没有可用的 Agent，请先添加 Agent。",
                pending_events=ctx.pending_events,
            )
            if clarify_round >= self.MAX_CLARIFY_ROUNDS:
                ctx.plan.phase = "comparison"
                ctx.plan.task_dag = {}
                ctx.plan.clarify_round = 0
                return "comparison"
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
            agent_role=AgentRole.CODER,
            conversation_history=history,
            config={"system_prompt": CRITIC_SYSTEM_PROMPT},
        )

        # 流式调用 + 停止检查
        content = await self._stream_agent_response(
            ctx.db, ctx.plan.session_id, adapter, agent, context,
            ctx.user_message, ctx.pending_events, "critic",
        )

        clarify_round += 1
        ctx.plan.clarify_round = clarify_round

        # Critic 自己确认需求已明确 + 没有在问新问题 → 自动推进
        if self._critic_has_confirmed(content):
            ctx.plan.phase = "comparison"
            ctx.plan.task_dag = {}
            ctx.plan.clarify_round = 0
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "需求已明确，正在生成方案…",
                pending_events=ctx.pending_events,
            )
            return "comparison"

        return None

    def _critic_has_confirmed(self, content: str) -> bool:
        """Critic 在回复中放了 [READY] 标记，表示需求已明确。
        但如果仍在向用户提问，即使有 [READY] 也不推进。"""
        if "[READY]" not in content:
            return False
        if self._is_still_asking(content):
            return False
        return True

    @staticmethod
    def _is_still_asking(content: str) -> bool:
        """检测回复中是否仍在向用户提问（含问号、编号问题、请求确认）。"""
        # 排除代码块
        lines = [l for l in content.split("\n") if not l.strip().startswith("```")]
        text = "\n".join(lines)
        if "?" in text or "？" in text:
            return True
        # 编号问题模式：1. xxx / 2) xxx / 1、xxx
        if re.search(r"(?:^|\n)\s*\d+[\.\)、]\s", text):
            return True
        # 请求用户提供更多信息
        if re.search(r"请(?:确认|回复|说明|提供|描述|告诉|选择|输入|补充|明确)", text):
            return True
        return False
