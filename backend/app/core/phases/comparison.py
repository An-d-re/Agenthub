"""阶段：comparison（方案对比）—— Planner 生成方案选项或解析用户选择。"""

import logging
from app.core.phases.base import BasePhaseHandler, PhaseContext
from app.core.prompts import PLANNER_APPROACHES_PROMPT
from app.services.adapters.base import AgentContext, AgentRole

logger = logging.getLogger(__name__)


class ComparisonHandler(BasePhaseHandler):
    """生成多方案选项，解析用户选择后推进到 confirmed。"""

    async def execute(self, ctx: PhaseContext) -> str | None:
        # 停止检查
        if self._get_stop_event(ctx.plan.session_id) and self._get_stop_event(ctx.plan.session_id).is_set():
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "⏹️ 已停止生成。",
                pending_events=ctx.pending_events,
            )
            return None

        if ctx.plan.approaches:
            return await self._handle_selection(ctx)
        return await self._generate_approaches(ctx)

    async def _handle_selection(self, ctx: PhaseContext) -> str | None:
        selected = self._parse_approach_selection(ctx.user_message, ctx.plan.approaches or [])
        if selected:
            ctx.plan.selected_approach = selected.get("name", "")
            ctx.plan.phase = "confirmed"
            await self._send_system_message(
                ctx.db, ctx.plan.session_id,
                f"已选择方案：{selected.get('name', '')}。正在生成任务计划…",
                pending_events=ctx.pending_events,
            )
            return "confirmed"
        else:
            names = ", ".join(a.get("name", "") for a in (ctx.plan.approaches or []))
            await self._send_system_message(
                ctx.db, ctx.plan.session_id,
                f"请选择一个方案（输入名称或序号）：{names}",
                pending_events=ctx.pending_events,
            )
            return None

    async def _generate_approaches(self, ctx: PhaseContext) -> str | None:
        agent, adapter = await self._get_agent_for_role(
            ctx.db, ctx.plan.session_id, "planner", ctx.mentions,
        )
        if not agent or not adapter:
            agent, adapter = await self._auto_create_agent(
                ctx.db, ctx.plan.session_id, "planner",
                task_context={"title": ctx.user_message[:80], "description": ctx.user_message[:200]},
            )
        if not agent or not adapter:
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "没有可用的 Planner Agent，且无法自动创建。",
                pending_events=ctx.pending_events,
            )
            return None

        # 阶段进度提示（卡片出现后前端会清除）
        await self._send_system_message(
            ctx.db, ctx.plan.session_id,
            f"📋 **{agent.name}** 正在生成方案选项…",
            pending_events=ctx.pending_events, publish_now=True,
            message_type="temp_progress",
        )

        history = await self._get_conversation_history(ctx.db, ctx.plan.session_id)
        context = AgentContext(
            session_id=ctx.plan.session_id,
            agent_role=AgentRole.PLANNER,
            conversation_history=history,
            config={"system_prompt": PLANNER_APPROACHES_PROMPT},
        )

        # 流式调用（不推送到前端，用户只需看结构化卡片）
        content = await self._stream_agent_response(
            ctx.db, ctx.plan.session_id, adapter, agent, context,
            ctx.user_message, ctx.pending_events, "planner", stream=False,
        )

        approaches = self._extract_json_array(content)
        if not approaches or not isinstance(approaches, list) or len(approaches) == 0:
            # 模型未输出 JSON（可能直接给了答案），自动包装为单方案
            approaches = [{
                "name": "推荐方案", "summary": content[:200],
                "pros": [], "cons": [], "recommended": True,
            }]
            logger.warning("Planner 未输出有效 JSON，自动包装为单方案。原始输出前100字: %s", content[:100])

        # 检测方案中是否夹带了计算结果（模型越界），若有用简短的方案描述替换
        for a in approaches:
            if self._looks_like_answer(a.get("summary", "")):
                a["summary"] = "按需求分解为原子任务，分配 Agent 执行"
                logger.warning("Planner 方案 summary 包含疑似答案内容，已替换")

        ctx.plan.approaches = approaches

        # 只有1个推荐方案时自动选中，跳过方案选择卡
        if len(approaches) == 1 and approaches[0].get("recommended"):
            ctx.plan.selected_approach = approaches[0].get("name", "")
            ctx.plan.phase = "confirmed"
            await self._send_system_message(
                ctx.db, ctx.plan.session_id,
                f"已选择方案：{approaches[0].get('name', '')}。正在生成任务计划…",
                pending_events=ctx.pending_events,
            )
            return "confirmed"

        # 方案卡片通过 plan.comparison 事件推送到前端，不伴随文本消息
        ctx.pending_events.append({
            "type": "plan.comparison",
            "session_id": ctx.plan.session_id,
            "payload": {"approaches": approaches},
        })
        return None

    @staticmethod
    def _looks_like_answer(summary: str) -> bool:
        """检测 summary 是否像计算结果而非方案描述。"""
        import re
        # 包含算式结果：12345 x 6789 = 83810205
        if re.search(r'\d+[\s]*[×*xX][\s]*\d+[\s]*=[\s]*[\d,]+', summary):
            return True
        # 包含代码块
        if '```' in summary:
            return True
        # 包含 markdown 标题（通常是答案格式）
        if re.search(r'\*\*.*结果.*\*\*', summary):
            return True
        return False
