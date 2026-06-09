"""PhaseHandler 基类 —— 包含所有 phase 共享的工具方法。"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.core.event_bus import event_bus
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


@dataclass
class PhaseContext:
    """阶段执行上下文 —— 每个 phase handler 的输入。"""
    db: AsyncSession
    plan: Plan
    user_message: str
    mentions: list[str] = field(default_factory=list)
    pending_events: list[dict] = field(default_factory=list)

    # 反向引用，用于访问 middleware、stop check 等
    orchestrator: Optional[object] = None


class BasePhaseHandler:
    """阶段处理器基类。

    包含所有 phase 共享的工具方法（Agent 选择、消息持久化、上下文管理、JSON 提取等）。
    子类只需实现 execute(ctx) → Optional[str]（返回下一阶段名或 None）。
    """

    MAX_TASK_RETRIES = 1

    # 角色关键词 → 标准角色名映射
    ROLE_KEYWORDS = {
        "critic": "critic", "planner": "planner", "coder": "coder",
        "reviewer": "reviewer", "architect": "planner",
        "审核": "reviewer", "审查": "reviewer", "规划": "planner",
        "编程": "coder", "写代码": "coder", "评论": "critic",
    }

    # 角色 → 预期能力标签（用于无 task_context 时的 Agent 匹配）
    ROLE_CAPABILITY_KEYWORDS = {
        "critic": ["需求分析", "问题澄清", "技术评估"],
        "planner": ["方案设计", "任务分解", "架构规划"],
        "coder": ["编程", "代码", "开发"],
        "reviewer": ["审查", "验证", "校对", "审核"],
    }

    async def execute(self, ctx: PhaseContext) -> Optional[str]:
        """执行阶段逻辑。返回下一阶段名称，或 None 保持当前阶段。"""
        raise NotImplementedError

    # ── Agent 选择 ──────────────────────────────────────────

    async def _get_session_agent_ids(self, db: AsyncSession, session_id: str) -> list[str]:
        result = await db.execute(
            select(SessionAgent).where(SessionAgent.session_id == session_id)
        )
        return [b.agent_id for b in result.scalars().all()]

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
            "api_key": None,
            "model": None,
            "system_prompt": agent.system_prompt or None,
            "deep_thinking": True,  # 启用 DeepSeek 深度思考模式
        })
        return agent, adapter

    # 技术关键词 → 能力标签映射
    TECH_CAPABILITY_MAP = {
        "python": ["python", "py", "django", "flask", "fastapi", "pytorch", "tensorflow"],
        "javascript": ["javascript", "js", "node", "nodejs", "deno"],
        "typescript": ["typescript", "ts"],
        "react": ["react", "reactjs", "next.js", "nextjs", "jsx", "tsx"],
        "vue": ["vue", "vuejs"],
        "html": ["html", "html5"],
        "css": ["css", "css3", "scss", "sass", "less", "tailwind"],
        "sql": ["sql", "mysql", "postgresql", "sqlite", "database", "db"],
        "rust": ["rust", "cargo"],
        "go": ["go", "golang"],
        "java": ["java", "spring", "maven"],
        "docker": ["docker", "container", "dockerfile"],
        "api": ["api", "rest", "graphql", "endpoint"],
        "frontend": ["frontend", "ui", "界面", "页面", "组件"],
        "backend": ["backend", "server", "服务端", "后端"],
    }

    async def _get_agent_for_role(
        self, db: AsyncSession, session_id: str, role: str,
        mentions: Optional[list[str]] = None, task_context: Optional[dict] = None,
        exclude_agent_ids: Optional[set[str]] = None,
    ) -> tuple[Optional[Agent], Optional[BaseAdapter]]:
        """根据角色选择合适的 Agent。

        优先级：@mention → 能力匹配 → 索引回退。
        exclude_agent_ids: 排除已分配给其他角色的 Agent，确保不同角色用不同 Agent。
        """
        agent_ids = await self._get_session_agent_ids(db, session_id)
        if not agent_ids:
            return None, None

        # 批量加载 Agent，避免后续 N+1 查询
        agents_result = await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        agent_map: dict[str, Agent] = {a.id: a for a in agents_result.scalars().all()}

        exclude = exclude_agent_ids or set()

        mentions = mentions or []

        # ── 1. @mention 匹配 ──────────────────────────────
        mention_to_role: dict[str, str] = {}
        for m in mentions:
            ml = m.lower()
            for kw, r in self.ROLE_KEYWORDS.items():
                if kw in ml:
                    mention_to_role[m] = r
                    break

        for m_name, m_role in mention_to_role.items():
            if m_role == role:
                for aid in agent_ids:
                    if aid in exclude:
                        continue
                    agent = agent_map.get(aid)
                    if agent and agent.name.lower() == m_name.lower():
                        return await self._get_agent_adapter(db, aid)
                break

        for m in mentions:
            for aid in agent_ids:
                if aid in exclude:
                    continue
                agent = agent_map.get(aid)
                if agent and agent.name == m:
                    if role in ("critic", "planner"):
                        return await self._get_agent_adapter(db, aid)

        # ── 2. 能力匹配 ──────────────────────────────────
        if task_context:
            required_caps = self._extract_required_capabilities(task_context)
            if required_caps:
                scored = []
                for aid in agent_ids:
                    if aid in exclude:
                        continue
                    agent = agent_map.get(aid)
                    if not agent:
                        continue
                    agent_caps = set(
                        tag.lower() for tag in (agent.capability_tags or [])
                    )
                    score = len(required_caps & agent_caps)
                    if score > 0:
                        scored.append((score, aid))

                scored.sort(key=lambda x: -x[0])
                if scored and role in ("coder", "reviewer"):
                    return await self._get_agent_adapter(db, scored[0][1])
                elif scored and role in ("critic", "planner"):
                    for _, aid in scored:
                        ag, ad = await self._get_agent_adapter(db, aid)
                        if ag:
                            return ag, ad

        # ── 2.5. 角色-能力回退（无 task_context 时按能力标签匹配角色）──
        role_caps = self.ROLE_CAPABILITY_KEYWORDS.get(role, [])
        if role_caps:
            role_caps_lower = set(c.lower() for c in role_caps)
            for aid in agent_ids:
                if aid in exclude:
                    continue
                agent = agent_map.get(aid)
                if not agent:
                    continue
                agent_caps = set(tag.lower() for tag in (agent.capability_tags or []))
                if agent_caps & role_caps_lower:
                    return await self._get_agent_adapter(db, aid)

        # ── 3. 索引回退 ──────────────────────────────────
        # 过滤掉已排除的 ID，按原始顺序排列
        available = [aid for aid in agent_ids if aid not in exclude]
        if not available:
            return None, None

        index_map = {
            "critic": 0,
            "planner": min(1, len(available) - 1),
            "coder": min(1, len(available) - 1),
            "reviewer": min(2, len(available) - 1),
        }
        idx = index_map.get(role, 0)
        return await self._get_agent_adapter(db, available[idx])

    def _extract_required_capabilities(self, task_context: dict) -> set[str]:
        """从任务描述中提取所需的能力标签。"""
        text = " ".join([
            task_context.get("title", ""),
            task_context.get("description", ""),
        ]).lower()
        required: set[str] = set()
        for cap, keywords in self.TECH_CAPABILITY_MAP.items():
            if any(kw in text for kw in keywords):
                required.add(cap)
        return required

    async def _resolve_agent_id(
        self, db: AsyncSession, session_id: str, role: str,
        mentions: Optional[list[str]] = None, task_context: Optional[dict] = None,
        exclude_agent_ids: Optional[set[str]] = None,
    ) -> Optional[str]:
        agent, _ = await self._get_agent_for_role(
            db, session_id, role, mentions, task_context, exclude_agent_ids=exclude_agent_ids,
        )
        return agent.id if agent else None

    async def _auto_create_agent(
        self, db: AsyncSession, session_id: str, role: str,
        task_context: Optional[dict] = None,
    ) -> tuple[Optional[Agent], Optional[BaseAdapter]]:
        """为缺失的角色自动创建 Agent，复用群聊现有 Agent 的 adapter_type。"""
        role_names = {
            "coder": "Coder · 执行者",
            "reviewer": "Reviewer · 验证者",
            "planner": "Planner · 规划者",
            "critic": "Critic · 分析者",
        }
        role_prompts = {
            "coder": (
                "You are a capable task executor. Execute the assigned task precisely. "
                "Use sandbox tools (write_file, run_command, read_file, install_deps, list_files) "
                "to complete the work. Test before finishing. Deliver results as a natural language summary."
            ),
            "reviewer": (
                "You are an independent verifier. Re-do the work independently, "
                "compare results, and state whether they match. "
                "Output natural text. Do NOT use JSON."
            ),
            "planner": "You are a project planner. Decompose requirements into executable tasks.",
            "critic": "You are a technical advisor. Clarify requirements before implementation.",
        }

        name = role_names.get(role, f"Agent · {role}")
        system_prompt = role_prompts.get(role, "")

        # 复用群聊现有 Agent 的 adapter_type
        agent_ids = await self._get_session_agent_ids(db, session_id)
        adapter_type = "deepseek"
        if agent_ids:
            first_agent = await db.get(Agent, agent_ids[0])
            if first_agent:
                adapter_type = first_agent.adapter_type

        capability_tags: list[str] = []
        if task_context:
            caps = self._extract_required_capabilities(task_context)
            capability_tags = list(caps)

        agent = Agent(
            name=name,
            role_type="custom",
            adapter_type=adapter_type,
            system_prompt=system_prompt,
            capability_tags=capability_tags,
            is_deletable=True,
            is_temp=True,
        )
        db.add(agent)
        await db.flush()

        # 绑定到当前会话
        session_agent = SessionAgent(session_id=session_id, agent_id=agent.id)
        db.add(session_agent)
        await db.flush()

        # 初始化适配器（复用全局 API key）
        adapter = create_adapter(agent.adapter_type)
        await adapter.initialize({
            "api_key": None,
            "model": None,
            "system_prompt": agent.system_prompt or None,
            "deep_thinking": True,
        })

        logger.info("Auto-created agent %s (role=%s) for session %s", agent.id, role, session_id)
        return agent, adapter

    # ── 消息持久化 ──────────────────────────────────────────

    async def _get_conversation_history(
        self, db: AsyncSession, session_id: str, limit: int = 30
    ) -> list[dict]:
        result = await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
        msgs = list(reversed(result.scalars().all()))
        return [
            {"role": "assistant" if m.role == "agent" else m.role, "content": m.content}
            for m in msgs
        ]

    async def _send_system_message(
        self, db: AsyncSession, session_id: str, content: str,
        agent_id: str = "", agent_role: str = "", pending_events: Optional[list[dict]] = None,
        publish_now: bool = False, message_type: str = "system",
    ) -> Message:
        msg = Message(
            session_id=session_id,
            agent_id=agent_id or None,
            role="system" if not agent_id else "agent",
            content=content,
            message_type=message_type,
        )
        db.add(msg)
        await db.flush()
        payload: dict = {
            "id": msg.id,
            "role": "system" if not agent_id else "agent",
            "content": content,
            "message_type": "system",
            "created_at": _utcnow().isoformat(),
        }
        if agent_id:
            payload["agent_id"] = agent_id
        if agent_role:
            payload["agent_role"] = agent_role
        if pending_events is not None:
            pending_events.append({
                "type": "chat.message",
                "session_id": session_id,
                "payload": payload,
            })
        # 立即发布到前端（绕过 pending_events 的 commit 延迟），用于进度提示
        if publish_now:
            from app.core.event_bus import event_bus
            try:
                await event_bus.publish(session_id, {
                    "type": "chat.message",
                    "session_id": session_id,
                    "payload": payload,
                })
            except Exception:
                pass  # 立即发布失败不影响主流程
        return msg

    # ── 流式 Agent 调用 + 停止检查 ──────────────────────────

    @staticmethod
    def _get_stop_event(session_id: str) -> Optional[asyncio.Event]:
        """获取 session 的停止信号，供流式调用中检查。"""
        from app.core.orchestrator import Orchestrator
        return Orchestrator.get_stop_event(session_id)

    async def _stream_agent_response(
        self, db: AsyncSession, session_id: str,
        adapter, agent, context: "AgentContext", message: str,
        pending_events: list[dict], agent_role: str,
        stream: bool = True,
    ) -> str:
        """流式调用 Agent，每 token 检查停止信号，直接发布到 EventBus。

        stream=False 时不推送 token 到前端也不添加 chat.message 到 pending_events
        （用于 Planner 分解等内部调用，用户只需看结构化结果）。

        Returns 完整响应文本。若被停止则追加 "已停止生成" 标记。
        """
        from app.core.event_bus import event_bus

        # 先在 DB 中创建占位消息（用于持久化），但不发往前端
        msg = Message(
            session_id=session_id, agent_id=agent.id,
            role="agent", content="", message_type="system",
        )
        db.add(msg)
        await db.flush()
        msg_id = msg.id

        # 深度思考内容用单独的 ID
        reasoning_id = f"reasoning-{msg_id}"

        full = ""
        reasoning = ""
        cancelled = False
        stop_event = self._get_stop_event(session_id)
        seq = 0
        reason_seq = 0
        try:
            async for token in adapter.stream_message(context, message):
                if stop_event and stop_event.is_set():
                    cancelled = True
                    break

                # 处理 StreamToken（新版）或纯字符串（向后兼容）
                if isinstance(token, str):
                    full += token
                    seq += 1
                    if stream:
                        await event_bus.publish(session_id, {
                            "type": "chat.stream.token",
                            "session_id": session_id,
                            "payload": {"message_id": msg_id, "token": token, "sequence": seq},
                        })
                elif token.type == "reasoning":
                    reasoning += token.text
                    reason_seq += 1
                    if stream:
                        await event_bus.publish(session_id, {
                            "type": "chat.stream.reasoning",
                            "session_id": session_id,
                            "payload": {"message_id": msg_id, "reasoning_id": reasoning_id, "token": token.text, "sequence": reason_seq},
                        })
                elif token.type == "content":
                    full += token.text
                    seq += 1
                    if stream:
                        await event_bus.publish(session_id, {
                            "type": "chat.stream.token",
                            "session_id": session_id,
                            "payload": {"message_id": msg_id, "token": token.text, "sequence": seq},
                        })
        except Exception as e:
            logger.exception("Agent 流式调用失败: %s", e)
            full = f"[Error: {e}]"
            if stream:
                await event_bus.publish(session_id, {
                    "type": "chat.stream.token",
                    "session_id": session_id,
                    "payload": {"message_id": msg_id, "token": full, "sequence": seq + 1},
                })

        if cancelled:
            full += "\n\n---\n⚠️ **已停止生成。**"

        # 更新 DB 消息内容
        msg.content = full
        await db.flush()

        # 发送完整消息到前端（覆盖流式占位），保留 reasoning 内容
        if stream:
            payload: dict = {
                "id": msg_id, "agent_id": agent.id, "agent_role": agent_role,
                "role": "agent", "content": full, "message_type": "system",
                "created_at": _utcnow().isoformat(),
            }
            if reasoning:
                payload["reasoning"] = reasoning
                payload["reasoning_id"] = reasoning_id
            pending_events.append({
                "type": "chat.message",
                "session_id": session_id,
                "payload": payload,
            })

            # 深度思考完成事件
            if reasoning:
                pending_events.append({
                    "type": "chat.reasoning.complete",
                    "session_id": session_id,
                    "payload": {
                        "message_id": msg_id,
                        "reasoning_id": reasoning_id,
                        "content": reasoning,
                    },
                })

        return full

    async def _publish_task_update(
        self, session_id: str, task: Task, status: str, pending_events: list[dict],
    ) -> None:
        payload = {
            "task_id": task.id,
            "title": task.title,
            "description": task.description[:200] if task.description else "",
            "status": status,
            "result": task.result,
            "error": task.error_message,
            "retry_count": task.retry_count,
        }
        if task.started_at:
            payload["started_at"] = task.started_at.isoformat()
        if task.completed_at:
            payload["completed_at"] = task.completed_at.isoformat()
        if task.assigned_agent_id:
            payload["agent_id"] = task.assigned_agent_id
        pending_events.append({
            "type": "task.update",
            "session_id": session_id,
            "payload": payload,
        })

    # ── JSON 提取 ───────────────────────────────────────────

    def _extract_json_array(self, text: str) -> Optional[list]:
        cleaned = re.sub(r'```(?:json)?\s*|\s*```', '', text)
        start = cleaned.find('[')
        if start >= 0:
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
                        return [item for item in result if item is not None]
                except json.JSONDecodeError:
                    pass
        try:
            result = json.loads(cleaned)
            if isinstance(result, list):
                return [item for item in result if item is not None]
        except json.JSONDecodeError:
            pass
        return None

    def _extract_json(self, text: str) -> Optional[dict]:
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

    # ── 任务执行辅助 ────────────────────────────────────────

    async def _check_all_done(
        self, db: AsyncSession, session_id: str, plan: Plan, pending_events: list[dict],
    ) -> bool:
        result = await db.execute(select(Task).where(Task.plan_id == plan.id))
        all_tasks = list(result.scalars().all())
        if all_tasks and all(t.status == "done" for t in all_tasks):
            plan.phase = "done"
            plan.status = "completed"
            await self._send_system_message(
                db, session_id, "🎉 所有任务已完成！", pending_events=pending_events,
            )
            return True
        return False

    def _parse_approach_selection(
        self, user_message: str, approaches: list[dict],
    ) -> Optional[dict]:
        lower = user_message.strip().lower()
        for a in approaches:
            name = a.get("name", "")
            if name.lower() in lower or lower in name.lower():
                return a
        num_match = re.search(r'(\d+)', lower)
        if num_match:
            idx = int(num_match.group(1)) - 1
            if 0 <= idx < len(approaches):
                return approaches[idx]
        return None
