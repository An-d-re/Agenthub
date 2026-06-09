"""Agent runner — dispatches user messages to the appropriate agent adapter."""

import json
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.artifact_utils import extract_code_blocks, create_artifacts_from_blocks
from app.core.database import async_session
from app.core.event_bus import event_bus
from app.models.agent import Agent
from app.models.message import Message, PinnedMessage
from app.models.session import SessionAgent
from app.services.adapters import create_adapter
from app.services.adapters.base import AgentContext, AgentRole
from app.services.adapters.config_resolver import resolve_adapter_config


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

        # 注入 Pin 消息作为上下文
        pinned_result = await db.execute(
            select(Message)
            .join(PinnedMessage, PinnedMessage.message_id == Message.id)
            .where(PinnedMessage.session_id == session_id)
            .order_by(PinnedMessage.pinned_at)
        )
        pinned_msgs = pinned_result.scalars().all()
        if pinned_msgs:
            pinned_content = "以下是用户固定的重要消息，请在回答时优先参考：\n"
            for i, pm in enumerate(pinned_msgs, 1):
                role_label = "用户" if pm.role == "user" else "助手"
                pinned_content += f"\n[{i}] {role_label}: {pm.content}\n"
            conversation.insert(0, {"role": "system", "content": pinned_content})

    # Create adapter
    adapter = create_adapter(agent.adapter_type)
    try:
        config = await resolve_adapter_config(
            agent.adapter_type,
            encrypted_agent_key=agent.encrypted_api_key,
            preferred_model=agent.preferred_model,
        )
        config["system_prompt"] = agent.system_prompt or None
        config["deep_thinking"] = True
        await adapter.initialize(config)

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
                        "payload": {"message_id": agent_msg_id, "reasoning_id": f"reasoning-{agent_msg_id}", "token": token.text, "sequence": reason_count},
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
        config = await resolve_adapter_config(
            agent.adapter_type,
            encrypted_agent_key=agent.encrypted_api_key,
            preferred_model=agent.preferred_model,
        )
        config["system_prompt"] = agent.system_prompt or None
        config["deep_thinking"] = True
        await adapter.initialize(config)

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
                        "payload": {"message_id": agent_msg_id, "reasoning_id": f"reasoning-{agent_msg_id}", "token": token.text, "sequence": reason_count},
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
                    "original_content": art.original_content or "",
                    "content_preview": (art.modified_content or art.original_content or "")[:500],
                },
            })
    finally:
        await adapter.stop()


def _extract_artifacts_from_content(content: str, message_id: str, session_id: str):
    """Extract code artifacts from agent reply for diff display."""
    blocks = extract_code_blocks(content)
    return create_artifacts_from_blocks(blocks, session_id=session_id, artifact_type="diff")
