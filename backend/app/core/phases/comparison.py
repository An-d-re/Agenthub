"""阶段：comparison（方案对比）—— Planner 生成方案选项或解析用户选择。"""

import json
import logging
from app.core.phases.base import BasePhaseHandler, PhaseContext
from app.core.prompts import PLANNER_APPROACHES_PROMPT
from app.models.message import Message
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
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "没有可用的 Planner Agent。",
                pending_events=ctx.pending_events,
            )
            return None

        # 阶段进度提示
        await self._send_system_message(
            ctx.db, ctx.plan.session_id,
            f"📋 **{agent.name}** 正在生成方案选项…",
            pending_events=ctx.pending_events, publish_now=True,
        )

        history = await self._get_conversation_history(ctx.db, ctx.plan.session_id)
        context = AgentContext(
            session_id=ctx.plan.session_id,
            agent_role=AgentRole.PLANNER,
            conversation_history=history,
            config={"system_prompt": PLANNER_APPROACHES_PROMPT},
        )

        # 流式调用 + 停止检查
        content = await self._stream_agent_response(
            ctx.db, ctx.plan.session_id, adapter, agent, context,
            ctx.user_message, ctx.pending_events, "planner",
        )

        approaches = self._extract_json_array(content)
        if not approaches or not isinstance(approaches, list) or len(approaches) == 0:
            approaches = [{
                "name": "推荐方案", "summary": content[:200],
                "pros": [], "cons": [], "recommended": True,
            }]

        ctx.plan.approaches = approaches

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
            session_id=ctx.plan.session_id,
            role="system", content=msg_text, message_type="system",
        )
        ctx.db.add(msg)
        await ctx.db.flush()

        ctx.pending_events.append({
            "type": "plan.comparison",
            "session_id": ctx.plan.session_id,
            "payload": {"approaches": approaches, "message_id": msg.id},
        })
        return None
