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
from app.core.prompts import (
    CODER_TASK_PROMPT,
    REVIEWER_PROMPT_PREFIX,
)
from app.core.tracer import tracer
from app.models.agent import Agent
from app.models.artifact import Artifact
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
    ) -> tuple[Optional[Agent], Optional[BaseAdapter]]:
        """根据角色选择合适的 Agent。

        优先级：@mention → 能力匹配 → 索引回退。
        """
        agent_ids = await self._get_session_agent_ids(db, session_id)
        if not agent_ids:
            return None, None

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
                    agent = await db.get(Agent, aid)
                    if agent and agent.name.lower() == m_name.lower():
                        return await self._get_agent_adapter(db, aid)
                break

        for m in mentions:
            for aid in agent_ids:
                agent = await db.get(Agent, aid)
                if agent and agent.name == m:
                    if role in ("critic", "planner"):
                        return await self._get_agent_adapter(db, aid)

        # ── 2. 能力匹配 ──────────────────────────────────
        if task_context:
            required_caps = self._extract_required_capabilities(task_context)
            if required_caps:
                scored = []
                for aid in agent_ids:
                    agent = await db.get(Agent, aid)
                    if not agent:
                        continue
                    agent_caps = set(
                        tag.lower() for tag in (agent.capability_tags or [])
                    )
                    score = len(required_caps & agent_caps)
                    if score > 0:
                        scored.append((score, aid))

                scored.sort(key=lambda x: -x[0])
                # 按角色优先级选择：对于 coder/reviewer，优先能力匹配
                # 对于 planner/critic，能力匹配 + 索引回退混合
                if scored and role in ("coder", "reviewer"):
                    return await self._get_agent_adapter(db, scored[0][1])
                elif scored and role in ("critic", "planner"):
                    # planner 优先选能力匹配的，否则用第一个
                    for _, aid in scored:
                        ag, ad = await self._get_agent_adapter(db, aid)
                        if ag:
                            return ag, ad

        # ── 3. 索引回退 ──────────────────────────────────
        index_map = {
            "critic": 0, "planner": 0,
            "coder": min(1, len(agent_ids) - 1),
            "reviewer": min(2, len(agent_ids) - 1),
        }
        idx = index_map.get(role, 0)
        return await self._get_agent_adapter(db, agent_ids[idx])

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
    ) -> Optional[str]:
        agent, _ = await self._get_agent_for_role(db, session_id, role, mentions, task_context)
        return agent.id if agent else None

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
    ) -> Message:
        msg = Message(
            session_id=session_id,
            agent_id=agent_id or None,
            role="system" if not agent_id else "agent",
            content=content,
            message_type="system",
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
        return msg

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
                        return result
                except json.JSONDecodeError:
                    pass
        try:
            result = json.loads(cleaned)
            if isinstance(result, list):
                return result
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

    # ── Artifact 提取 ───────────────────────────────────────

    def _guess_file_path(self, full_content: str, code: str, language: str) -> str:
        path_match = re.search(
            r'(?:File|文件|path):\s*([^\s\n]+)', full_content, re.IGNORECASE
        )
        if path_match:
            raw = path_match.group(1)
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

    async def _extract_artifacts(
        self, db: AsyncSession, session_id: str, task: Task, content: str,
        pending_events: list[dict],
    ) -> list[dict]:
        artifacts: list[dict] = []
        code_blocks = re.finditer(r'`{3}(\w*)\s*\n(.*?)`{3}', content, re.DOTALL)
        for match in code_blocks:
            language = match.group(1) or "text"
            code = match.group(2).strip()
            if len(code) < 10:
                continue
            file_path = self._guess_file_path(content, code, language)
            original = ""
            prev_result = await db.execute(
                select(Artifact).where(
                    Artifact.session_id == session_id,
                    Artifact.file_path == file_path,
                    Artifact.task_id != task.id,
                ).order_by(Artifact.created_at.desc()).limit(1)
            )
            prev_artifact = prev_result.scalar_one_or_none()
            if prev_artifact and prev_artifact.modified_content:
                original = prev_artifact.modified_content

            artifact = Artifact(
                task_id=task.id, session_id=session_id,
                file_path=file_path, original_content=original,
                modified_content=code, language=language, artifact_type="code",
            )
            db.add(artifact)
            await db.flush()
            artifacts.append({
                "id": artifact.id, "file_path": artifact.file_path,
                "language": artifact.language,
                "original_content": original, "modified_content": code,
            })
            pending_events.append({
                "type": "artifact.created",
                "session_id": session_id,
                "payload": {
                    "artifact_id": artifact.id, "task_id": task.id,
                    "file_path": file_path, "language": language,
                    "original_content": original, "content_preview": code[:200],
                },
            })

        if not artifacts and len(content) > 50:
            artifact = Artifact(
                task_id=task.id, session_id=session_id,
                file_path=f"output/task-{task.title[:30]}.md",
                original_content="", modified_content=content,
                language="markdown", artifact_type="code",
            )
            db.add(artifact)
            await db.flush()
            artifacts.append({
                "id": artifact.id, "file_path": artifact.file_path,
                "language": "markdown", "modified_content": content,
            })
            pending_events.append({
                "type": "artifact.created",
                "session_id": session_id,
                "payload": {
                    "artifact_id": artifact.id, "task_id": task.id,
                    "file_path": artifact.file_path, "language": "markdown",
                    "content_preview": content[:200],
                },
            })
        return artifacts

    # ── Reviewer ────────────────────────────────────────────

    async def _review_task_output(
        self, db: AsyncSession, session_id: str, task: Task, output: str,
        pending_events: list[dict], mentions: Optional[list[str]] = None,
    ) -> bool:
        """双层审查：静态规则（零 token）→ LLM Reviewer。返回 True 表示通过。"""
        # Layer 1: 静态规则检查
        from app.core.static_reviewer import review_static
        static_result = review_static(output)
        if not static_result.passed:
            task.status = "retrying"
            task.retry_count += 1
            task.error_message = "; ".join(static_result.errors)
            await db.flush()
            await self._publish_task_update(session_id, task, "retrying", pending_events)
            await self._send_system_message(
                db, session_id,
                f"🔍 静态检查未通过：{'; '.join(static_result.errors)}\n"
                + (f"⚠️ 警告：{'; '.join(static_result.warnings)}" if static_result.warnings else ""),
                agent_role="reviewer", pending_events=pending_events,
            )
            return False

        # Layer 2: LLM Reviewer
        reviewer_agent, reviewer_adapter = await self._get_agent_for_role(
            db, session_id, "reviewer", mentions,
            task_context={"title": task.title, "description": task.description or ""},
        )
        if not reviewer_agent or not reviewer_adapter:
            # 静态检查通过 + 无 LLM reviewer = 通过
            if static_result.warnings:
                await self._send_system_message(
                    db, session_id,
                    f"⚠️ 审查警告（仅静态检查）：{'; '.join(static_result.warnings)}",
                    agent_role="reviewer", pending_events=pending_events,
                )
            return True

        try:
            review_ctx = AgentContext(
                session_id=session_id,
                agent_role=AgentRole.REVIEWER,
                current_task={"id": task.id, "title": task.title, "description": task.description or ""},
                config={"system_prompt": REVIEWER_PROMPT_PREFIX},
            )
            review_input = (
                f"Task: {task.title}\n"
                f"Description: {task.description or 'N/A'}\n\n"
                f"Static checks passed. Code output to review:\n\n{output[:4000]}"
            )
            review_resp = await reviewer_adapter.send_message(review_ctx, review_input)
            review_data = self._extract_json(review_resp.content)

            if review_data and not review_data.get("passed", True):
                if task.retry_count >= self.MAX_TASK_RETRIES:
                    task.status = "dispute"
                    task.error_message = review_data.get("feedback", "Reviewer 连续不通过")
                    await db.flush()
                    await self._publish_task_update(session_id, task, "dispute", pending_events)
                    await self._send_system_message(
                        db, session_id,
                        f"❌ 任务「{task.title}」Reviewer 审查 {task.retry_count + 1} 次仍未通过。\n"
                        f"反馈：{review_data.get('feedback', '')[:200]}\n输入「重试」重新执行。",
                        agent_id=reviewer_agent.id, agent_role="reviewer",
                        pending_events=pending_events,
                    )
                    return False
                task.status = "retrying"
                task.retry_count += 1
                task.error_message = review_data.get("feedback", "")
                await db.flush()
                await self._publish_task_update(session_id, task, "retrying", pending_events)
                await self._send_system_message(
                    db, session_id,
                    f"🔍 Reviewer: {review_data.get('feedback', '审查未通过')}\n"
                    f"📝 建议: {review_data.get('suggested_changes', '')[:300]}",
                    agent_id=reviewer_agent.id, agent_role="reviewer",
                    pending_events=pending_events,
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
