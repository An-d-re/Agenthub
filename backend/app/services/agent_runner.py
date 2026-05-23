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
from app.services.adapters.base import AgentContext


def _utcnow():
    return datetime.now(timezone.utc)


async def run_agent_reply(session_id: str, user_message: str):
    """Find the session's agent, call its adapter, stream result via EventBus."""
    async with async_session() as db:
        # Get session agents
        result = await db.execute(
            select(SessionAgent).where(SessionAgent.session_id == session_id)
        )
        bindings = result.scalars().all()
        if not bindings:
            return

        # Single chat: use the first agent
        binding = bindings[0]
        agent = await db.get(Agent, binding.agent_id)
        if not agent:
            return

    # Create adapter
    adapter = create_adapter(agent.adapter_type)
    await adapter.initialize({
        "api_key": None,  # uses settings env var as fallback
        "model": None,    # uses adapter default
        "system_prompt": agent.system_prompt or None,
    })

    # Build context (get recent messages)
    async with async_session() as db:
        result = await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .order_by(Message.created_at.desc())
            .limit(30)
        )
        history = list(reversed(result.scalars().all()))
        conversation = [
            {"role": m.role if m.role != "agent" else "assistant", "content": m.content}
            for m in history[:-1]  # exclude the just-saved user message
        ]

    context = AgentContext(
        session_id=session_id,
        agent_role="planner",  # default for single chat
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
            full_content += token
            token_count += 1
            await event_bus.publish(session_id, {
                "type": "chat.stream.token",
                "session_id": session_id,
                "payload": {"message_id": agent_msg_id, "token": token, "sequence": token_count},
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

    await adapter.stop()
