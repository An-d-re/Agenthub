"""阶段：confirmed（计划确认）—— Planner 分解任务为 DAG，用户确认后进入执行。"""

import json
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.phases.base import BasePhaseHandler, PhaseContext
from app.core.prompts import PLANNER_DECOMPOSE_PROMPT
from app.models.message import Message
from app.models.task import Task, TaskDependency
from app.services.adapters.base import AgentContext, AgentRole

logger = logging.getLogger(__name__)


class ConfirmedHandler(BasePhaseHandler):
    """分解任务为 DAG，等待用户确认后推进到 executing。"""

    async def execute(self, ctx: PhaseContext) -> str | None:
        existing_dag = ctx.plan.task_dag or []

        # 已有 DAG → 处理用户反馈
        if existing_dag:
            return await self._handle_feedback(ctx)

        # 首次进入：分解任务
        return await self._decompose(ctx)

    async def _handle_feedback(self, ctx: PhaseContext) -> str | None:
        lower = ctx.user_message.strip().lower()
        if lower in ("确认", "confirm", "ok", "好的", "可以", "执行", "开始", "go", "yes", "是"):
            await self._do_confirm_plan(ctx)
            return "executing"
        elif lower.startswith("删除") or lower.startswith("delete"):
            task_id = ctx.user_message.strip().split()[-1] if " " in ctx.user_message.strip() else ""
            await self._do_delete_dag_task(ctx, task_id)
            return None
        else:
            await self._send_system_message(
                ctx.db, ctx.plan.session_id,
                "请输入「确认」开始执行任务，或「删除 <任务ID>」移除不需要的任务。",
                pending_events=ctx.pending_events,
            )
            return None

    async def _decompose(self, ctx: PhaseContext) -> str | None:
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
            f"📐 **{agent.name}** 正在分解任务计划…",
            pending_events=ctx.pending_events, publish_now=True,
        )

        decompose_input = (
            f"已选方案：{ctx.plan.selected_approach}\n"
            f"方案详情：{json.dumps(ctx.plan.approaches, ensure_ascii=False)}\n\n"
            "请将上述方案分解为原子任务，标注依赖关系和所需角色。"
        )

        history = await self._get_conversation_history(ctx.db, ctx.plan.session_id)
        context = AgentContext(
            session_id=ctx.plan.session_id,
            agent_role=AgentRole.PLANNER,
            conversation_history=history,
            config={"system_prompt": PLANNER_DECOMPOSE_PROMPT},
        )

        # 流式调用 + 停止检查
        content = await self._stream_agent_response(
            ctx.db, ctx.plan.session_id, adapter, agent, context,
            decompose_input, ctx.pending_events, "planner",
        )

        task_dag = self._extract_json_array(content)
        if not task_dag or not isinstance(task_dag, list) or len(task_dag) == 0:
            task_dag = [{
                "id": "task-1", "title": ctx.plan.selected_approach or "实现需求",
                "description": content[:500], "dependencies": [], "agent_role": "coder",
            }]

        for td in task_dag:
            td["assigned_agent_id"] = await self._resolve_agent_id(
                ctx.db, ctx.plan.session_id, td.get("agent_role", "coder"), ctx.mentions,
                task_context={"title": td.get("title", ""), "description": td.get("description", "")},
            )

        ctx.plan.task_dag = task_dag

        # 创建 Task 和 TaskDependency 数据库记录
        id_map: dict[str, str] = {}
        for td in task_dag:
            task = Task(
                plan_id=ctx.plan.id,
                title=td["title"],
                description=td.get("description", ""),
                assigned_agent_id=td.get("assigned_agent_id"),
                status="pending",
            )
            ctx.db.add(task)
            await ctx.db.flush()
            id_map[td["id"]] = task.id
            td["_db_id"] = task.id

        for td in task_dag:
            for dep_id in td.get("dependencies", []):
                dep_db_id = id_map.get(dep_id)
                if dep_db_id:
                    dep = TaskDependency(
                        task_id=id_map[td["id"]], depends_on_task_id=dep_db_id,
                    )
                    ctx.db.add(dep)

        await ctx.db.flush()

        dag_for_frontend = []
        for td in task_dag:
            dag_for_frontend.append({
                "id": td["id"], "title": td["title"],
                "description": td.get("description", "")[:200],
                "dependencies": td.get("dependencies", []),
                "agent_role": td.get("agent_role", "coder"),
                "db_id": td.get("_db_id", ""),
            })

        msg = Message(
            session_id=ctx.plan.session_id,
            role="system",
            content="**任务计划已生成，请确认后执行：**\n" + "\n".join(
                f"- {t['id']}: {t['title']}" for t in dag_for_frontend
            ),
            message_type="system",
        )
        ctx.db.add(msg)
        await ctx.db.flush()

        ctx.pending_events.append({
            "type": "plan.confirmed",
            "session_id": ctx.plan.session_id,
            "payload": {
                "message_id": msg.id, "tasks": dag_for_frontend,
                "hint": "请勾选/删除任务后点击「确认执行」，或输入「确认」/「删除 <任务ID>」",
            },
        })
        return None

    async def _do_confirm_plan(self, ctx: PhaseContext) -> None:
        ctx.plan.phase = "executing"
        await self._send_system_message(
            ctx.db, ctx.plan.session_id, "计划已确认，开始执行任务…",
            pending_events=ctx.pending_events,
        )

    async def _do_delete_dag_task(self, ctx: PhaseContext, dag_task_id: str) -> None:
        task_dag = ctx.plan.task_dag or []
        target = next((t for t in task_dag if t.get("id") == dag_task_id), None)
        if not target:
            ids = ", ".join(t.get("id", "") for t in task_dag)
            await self._send_system_message(
                ctx.db, ctx.plan.session_id,
                f"未找到任务 {dag_task_id}。可删除的任务：{ids}",
                pending_events=ctx.pending_events,
            )
            return

        db_task_id = target.get("_db_id", "")
        if db_task_id:
            db_task = await ctx.db.get(Task, db_task_id)
            if db_task:
                await ctx.db.delete(db_task)

        new_dag = [t for t in task_dag if t.get("id") != dag_task_id]
        for t in new_dag:
            t["dependencies"] = [d for d in t.get("dependencies", []) if d != dag_task_id]

        ctx.plan.task_dag = new_dag
        await self._send_system_message(
            ctx.db, ctx.plan.session_id,
            f"已移除任务「{target.get('title', dag_task_id)}」。"
            + (f" 剩余 {len(new_dag)} 个任务。" if new_dag else " 所有任务已清空。"),
            pending_events=ctx.pending_events,
        )
