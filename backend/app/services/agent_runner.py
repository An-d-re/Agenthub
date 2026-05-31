"""Agent runner — dispatches user messages to the appropriate agent adapter."""

import json
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.database import async_session
from app.core.event_bus import event_bus
from app.models.agent import Agent
from app.models.message import Message
from app.models.session import SessionAgent
from app.services.adapters import create_adapter
from app.services.adapters.base import AgentContext, AgentRole


def _utcnow():
    return datetime.now(timezone.utc)


async def run_agent_reply(session_id: str, user_message: str):
    """Find the session's agent, call its adapter, stream result via EventBus."""
    async with async_session() as db:
        # 获取 session agent 绑定和对话历史（合并两次读取为一次会话）
        result = await db.execute(
            select(SessionAgent).where(SessionAgent.session_id == session_id)
        )
        bindings = result.scalars().all()
        if not bindings:
            return

        binding = bindings[0]
        agent = await db.get(Agent, binding.agent_id)
        if not agent:
            return

        # 获取对话历史
        result = await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .order_by(Message.created_at.desc())
            .limit(30)
        )
        history = list(reversed(result.scalars().all()))
        conversation = [
            {"role": m.role if m.role != "agent" else "assistant", "content": m.content}
            for m in history[:-1]  # 排除刚保存的用户消息
        ]

    # Create adapter
    adapter = create_adapter(agent.adapter_type)
    try:
        await adapter.initialize({
            "api_key": None,  # uses settings env var as fallback
            "model": None,    # uses adapter default
            "system_prompt": agent.system_prompt or None,
            "deep_thinking": True,
        })

        context = AgentContext(
            session_id=session_id,
            agent_role=AgentRole.PLANNER,
            conversation_history=conversation,
        )

        # Create agent message placeholder
        agent_msg_id = None
        async with async_session() as db:
            msg = Message(session_id=session_id, role="agent", agent_id=agent.id, content="", message_type="text")
            db.add(msg)
            await db.commit()
            await db.refresh(msg)
            agent_msg_id = msg.id

        # Stream tokens
        full_content = ""
        token_count = 0
        try:
            async for token in adapter.stream_message(context, user_message):
                if isinstance(token, str):
                    full_content += token
                    token_count += 1
                    await event_bus.publish(session_id, {
                        "type": "chat.stream.token",
                        "session_id": session_id,
                        "payload": {"message_id": agent_msg_id, "token": token, "sequence": token_count},
                    })
                elif token.type == "reasoning":
                    await event_bus.publish(session_id, {
                        "type": "chat.stream.reasoning",
                        "session_id": session_id,
                        "payload": {"message_id": agent_msg_id, "reasoning_id": f"reasoning-{agent_msg_id}", "token": token.text, "sequence": 0},
                    })
                elif token.type == "content":
                    full_content += token.text
                    token_count += 1
                    await event_bus.publish(session_id, {
                        "type": "chat.stream.token",
                        "session_id": session_id,
                        "payload": {"message_id": agent_msg_id, "token": token.text, "sequence": token_count},
                    })
        except Exception as e:
            full_content = f"[Error: {e}]"

        # Update message with full content
        async with async_session() as db:
            msg = await db.get(Message, agent_msg_id)
            if msg:
                msg.content = full_content
                msg.tokens_used = token_count
                await db.commit()

        # Send completion event
        await event_bus.publish(session_id, {
            "type": "chat.message",
            "session_id": session_id,
            "payload": {
                "id": agent_msg_id,
                "session_id": session_id,
                "agent_id": agent.id,
                "role": "agent",
                "content": full_content,
                "message_type": "text",
                "tokens_used": token_count,
                "created_at": _utcnow().isoformat(),
            },
        })
    finally:
        await adapter.stop()


async def run_agent_modify(session_id: str, original_message_id: str, start_line: int, end_line: int, instruction: str):
    """Handle code modification request — fetch original code, build modify prompt, stream result."""
    async with async_session() as db:
        result = await db.execute(
            select(SessionAgent).where(SessionAgent.session_id == session_id)
        )
        bindings = result.scalars().all()
        if not bindings:
            return
        binding = bindings[0]
        agent = await db.get(Agent, binding.agent_id)
        if not agent:
            return

        original_msg = await db.get(Message, original_message_id)
        if not original_msg:
            return

        original_content = original_msg.content

    # Build modify prompt
    modify_prompt = (
        f"用户要求修改以下代码的第 {start_line} 到第 {end_line} 行。\n\n"
        f"原始代码:\n```\n{original_content}\n```\n\n"
        f"修改指示: {instruction}\n\n"
        f"请只输出修改后的完整代码（整个文件），用 markdown 代码块包裹，并注明文件路径。"
        f"确保修改精准只影响指定行范围，其余代码保持不变。"
    )

    adapter = create_adapter(agent.adapter_type)
    try:
        await adapter.initialize({
            "api_key": None,
            "model": None,
            "system_prompt": agent.system_prompt or None,
            "deep_thinking": True,
        })

        context = AgentContext(
            session_id=session_id,
            agent_role=AgentRole.CODER,
            conversation_history=[],
        )

        # Create agent message placeholder
        agent_msg_id = None
        async with async_session() as db:
            msg = Message(
                session_id=session_id,
                role="agent",
                agent_id=agent.id,
                content="",
                message_type="code",
                parent_id=original_message_id,
            )
            db.add(msg)
            await db.commit()
            await db.refresh(msg)
            agent_msg_id = msg.id

        # Stream tokens
        full_content = ""
        token_count = 0
        try:
            async for token in adapter.stream_message(context, modify_prompt):
                if isinstance(token, str):
                    full_content += token
                    token_count += 1
                    await event_bus.publish(session_id, {
                        "type": "chat.stream.token",
                        "session_id": session_id,
                        "payload": {"message_id": agent_msg_id, "token": token, "sequence": token_count},
                    })
                elif token.type == "reasoning":
                    await event_bus.publish(session_id, {
                        "type": "chat.stream.reasoning",
                        "session_id": session_id,
                        "payload": {"message_id": agent_msg_id, "reasoning_id": f"reasoning-{agent_msg_id}", "token": token.text, "sequence": 0},
                    })
                elif token.type == "content":
                    full_content += token.text
                    token_count += 1
                    await event_bus.publish(session_id, {
                        "type": "chat.stream.token",
                        "session_id": session_id,
                        "payload": {"message_id": agent_msg_id, "token": token.text, "sequence": token_count},
                    })
        except Exception as e:
            full_content = f"[Error: {e}]"

        # Update message with full content
        async with async_session() as db:
            msg = await db.get(Message, agent_msg_id)
            if msg:
                msg.content = full_content
                msg.tokens_used = token_count
                await db.commit()

        # Extract artifacts for diff display
        artifacts = _extract_artifacts_from_content(full_content, agent_msg_id, session_id)
        async with async_session() as db:
            for art in artifacts:
                db.add(art)
            await db.commit()

        # Send completion event
        await event_bus.publish(session_id, {
            "type": "chat.message",
            "session_id": session_id,
            "payload": {
                "id": agent_msg_id,
                "session_id": session_id,
                "agent_id": agent.id,
                "role": "agent",
                "content": full_content,
                "message_type": "code",
                "parent_id": original_message_id,
                "tokens_used": token_count,
                "created_at": _utcnow().isoformat(),
            },
        })

        # Publish artifact events
        for art in artifacts:
            await event_bus.publish(session_id, {
                "type": "artifact.created",
                "session_id": session_id,
                "payload": {
                    "artifact_id": art.id,
                    "task_id": None,
                    "file_path": art.file_path,
                    "language": art.language,
                    "content_preview": (art.modified_content or art.original_content or "")[:500],
                },
            })
    finally:
        await adapter.stop()


def _extract_artifacts_from_content(content: str, message_id: str, session_id: str):
    """Extract code artifacts from agent reply for diff display."""
    import re as _re
    from app.models.artifact import Artifact

    artifacts = []
    blocks = _re.findall(r'```(\w+)?\s*\n(.*?)```', content, _re.DOTALL)
    for lang, code in blocks:
        file_path = _guess_file_path(code, lang)
        art = Artifact(
            task_id=None,
            session_id=session_id,
            file_path=file_path,
            original_content=None,
            modified_content=code.strip(),
            language=lang or "text",
            artifact_type="diff",
        )
        artifacts.append(art)
    return artifacts


def _guess_file_path(code: str, lang: str) -> str:
    """Guess file path from code comment or language."""
    ext_map = {
        "python": "py", "py": "py",
        "javascript": "js", "js": "js",
        "typescript": "ts", "ts": "ts",
        "tsx": "tsx", "jsx": "jsx",
        "html": "html", "css": "css",
        "json": "json", "sql": "sql",
        "bash": "sh", "sh": "sh",
        "yaml": "yml", "yml": "yml",
    }
    ext = ext_map.get(lang, lang)
    return f"modified_code.{ext}"
