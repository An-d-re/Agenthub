"""阶段：confirmed（计划确认）—— Planner 分解任务为 DAG，用户确认后进入执行。"""

import json
import logging
from sqlalchemy import select
from app.core.agent_factory import match_task_to_agent
from app.core.phases.base import BasePhaseHandler, PhaseContext
from app.core.prompts import PLANNER_DECOMPOSE_PROMPT
from app.models.agent import Agent
from app.models.task import Task, TaskDependency
from app.services.adapters.base import AgentContext, AgentRole

logger = logging.getLogger(__name__)


class ConfirmedHandler(BasePhaseHandler):
    """分解任务为 DAG，等待用户确认执行者分配后推进到 executing。"""

    async def execute(self, ctx: PhaseContext) -> str | None:
        existing_dag = ctx.plan.task_dag or []

        if existing_dag:
            return await self._handle_feedback(ctx)
        return await self._decompose(ctx)

    async def _handle_feedback(self, ctx: PhaseContext) -> str | None:
        lower = ctx.user_message.strip().lower()
        if lower.startswith("删除") or lower.startswith("delete"):
            task_id = ctx.user_message.strip().split()[-1] if " " in ctx.user_message.strip() else ""
            await self._do_delete_dag_task(ctx, task_id)
            return None
        else:
            await self._send_system_message(
                ctx.db, ctx.plan.session_id,
                "请在 DAG 卡片中指定每个任务的执行者，然后点击「确认执行」。",
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

        # 阶段进度提示（卡片出现后前端会清除）
        await self._send_system_message(
            ctx.db, ctx.plan.session_id,
            f"📐 **{agent.name}** 正在分解任务计划…",
            pending_events=ctx.pending_events, publish_now=True,
            message_type="temp_progress",
        )

        decompose_input = (
            f"已选方案：{ctx.plan.selected_approach}\n"
            f"方案详情：{json.dumps(ctx.plan.approaches, ensure_ascii=False)}\n\n"
            "请将上述方案分解为原子任务，标注依赖关系和所需能力类型。"
        )

        history = await self._get_conversation_history(ctx.db, ctx.plan.session_id)
        context = AgentContext(
            session_id=ctx.plan.session_id,
            agent_role=AgentRole.PLANNER,
            conversation_history=history,
            config={"system_prompt": PLANNER_DECOMPOSE_PROMPT},
        )

        content = await self._stream_agent_response(
            ctx.db, ctx.plan.session_id, adapter, agent, context,
            decompose_input, ctx.pending_events, "planner", stream=False,
        )

        task_dag = self._extract_json_array(content)
        if not task_dag or not isinstance(task_dag, list) or len(task_dag) == 0:
            task_dag = [{
                "id": "task-1", "title": ctx.plan.selected_approach or "实现需求",
                "description": content[:500], "dependencies": [],
                "required_capability": "code",
            }]

        # 为每个任务匹配现有 Agent（排除已分配给不同能力的 Agent）
        assigned_agent_ids: set[str] = set()
        capability_assigned: dict[str, str] = {}  # capability → agent_id
        dag_for_frontend = []

        for td in task_dag:
            capability = td.get("required_capability", "code")
            # 同能力类型可复用已分配的 Agent
            reuse_id = capability_assigned.get(capability)
            if reuse_id:
                td["assigned_agent_id"] = reuse_id
                match_reason = f"复用已有 {capability} Agent"
                agent = await ctx.db.get(Agent, reuse_id)
                dag_for_frontend.append({
                    "id": td["id"],
                    "title": td["title"],
                    "description": td.get("description", "")[:200],
                    "dependencies": td.get("dependencies", []),
                    "required_capability": capability,
                    "executor_type": "existing",
                    "agent_id": reuse_id,
                    "agent_name": agent.name if agent else "",
                    "match_reason": match_reason,
                })
                continue

            match = await match_task_to_agent(
                ctx.db, ctx.plan.session_id, capability, assigned_agent_ids,
            )

            if match.matched and match.agent:
                td["assigned_agent_id"] = match.agent.id
                assigned_agent_ids.add(match.agent.id)
                capability_assigned[capability] = match.agent.id
                dag_for_frontend.append({
                    "id": td["id"],
                    "title": td["title"],
                    "description": td.get("description", "")[:200],
                    "dependencies": td.get("dependencies", []),
                    "required_capability": capability,
                    "executor_type": "existing",
                    "agent_id": match.agent.id,
                    "agent_name": match.agent.name,
                    "match_reason": match.reason,
                })
            else:
                td["assigned_agent_id"] = None
                dag_for_frontend.append({
                    "id": td["id"],
                    "title": td["title"],
                    "description": td.get("description", "")[:200],
                    "dependencies": td.get("dependencies", []),
                    "required_capability": capability,
                    "executor_type": "new",
                    "agent_id": None,
                    "agent_name": None,
                    "match_reason": match.reason,
                })

        ctx.plan.task_dag = task_dag

        # 创建 Task + TaskDependency 记录
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

        # 全部任务已匹配现有 Agent → 自动确认，省去人工点击「确认执行」
        all_matched = all(td.get("assigned_agent_id") for td in task_dag)
        if all_matched:
            ctx.plan.phase = "executing"
            await self._send_system_message(
                ctx.db, ctx.plan.session_id, "所有任务已匹配到已有 Agent，自动确认，开始执行…",
                pending_events=ctx.pending_events,
            )
            # 仍推送 DAG 卡片供前端展示
            ctx.pending_events.append({
                "type": "plan.confirmed",
                "session_id": ctx.plan.session_id,
                "payload": {
                    "tasks": dag_for_frontend,
                    "hint": "所有任务已自动分配，开始执行",
                },
            })
            return "executing"

        # 有未匹配任务 → 等待用户手动确认
        ctx.pending_events.append({
            "type": "plan.confirmed",
            "session_id": ctx.plan.session_id,
            "payload": {
                "tasks": dag_for_frontend,
                "hint": "为每个任务指定执行者，选择模型后点击「确认执行」",
            },
        })

        return None

    # ── 外部 API 入口（plan.action confirm）──────────────────

    async def confirm_with_assignments(
        self, ctx: PhaseContext, assignments: list[dict],
    ) -> str | None:
        """处理前端 DAG 确认请求，携带用户的任务分配信息。

        assignments: [{"task_id": "task-1", "agent_id": "uuid", "adapter_type": null}, ...]
        """
        from app.core.agent_factory import create_temp_agent

        task_dag = ctx.plan.task_dag or []
        id_map: dict[str, dict] = {td["id"]: td for td in task_dag}

        logger.info(
            "confirm_with_assignments: assignments=%s, dag_ids=%s",
            [{a.get("task_id"): a.get("agent_id") or "NEW"} for a in assignments],
            {td["id"]: td.get("required_capability", "?") for td in task_dag},
        )

        for assign in assignments:
            dag_id = assign.get("task_id", "")
            td = id_map.get(dag_id)
            if not td:
                logger.warning("confirm_with_assignments: dag_id=%s NOT FOUND in id_map keys=%s", dag_id, list(id_map.keys()))
                continue

            agent_id = assign.get("agent_id")
            if agent_id:
                # 复用现有 Agent
                db_task = await ctx.db.get(Task, td.get("_db_id", ""))
                if db_task:
                    db_task.assigned_agent_id = agent_id
                    td["assigned_agent_id"] = agent_id  # 同步到内存 DAG
            else:
                # 新建临时 Agent
                adapter_type = assign.get("adapter_type", "deepseek")
                api_key = assign.get("api_key")
                db_task = await ctx.db.get(Task, td.get("_db_id", ""))
                if not db_task:
                    logger.warning("confirm_with_assignments: db_task NOT FOUND for dag_id=%s _db_id=%s", dag_id, td.get("_db_id"))
                    continue
                capability = td.get("required_capability", "code")
                logger.info("confirm_with_assignments: creating temp agent for dag_id=%s capability=%s", dag_id, capability)
                new_agent = await create_temp_agent(
                    ctx.db, ctx.plan.session_id, db_task,
                    capability, adapter_type, api_key,
                )
                td["assigned_agent_id"] = new_agent.id
                if db_task:
                    db_task.assigned_agent_id = new_agent.id
                await self._send_system_message(
                    ctx.db, ctx.plan.session_id,
                    f"✨ 创建了临时 Agent「{new_agent.name}」（{adapter_type}）",
                    agent_id=new_agent.id, agent_role=capability,
                    pending_events=ctx.pending_events,
                )
                ctx.pending_events.append({
                    "type": "agent.created",
                    "session_id": ctx.plan.session_id,
                    "payload": {
                        "id": new_agent.id, "name": new_agent.name,
                        "role_type": new_agent.role_type,
                        "adapter_type": new_agent.adapter_type,
                        "capability_tags": new_agent.capability_tags,
                        "is_deletable": new_agent.is_deletable,
                    },
                })

        ctx.plan.task_dag = task_dag
        ctx.plan.phase = "executing"
        await self._send_system_message(
            ctx.db, ctx.plan.session_id, "计划已确认，开始执行任务…",
            pending_events=ctx.pending_events,
        )
        return "executing"

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
