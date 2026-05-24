"""WebSocket 路由处理 —— 双异步任务模式。

任务 A：从 WebSocket 读取 → 校验 → 持久化 → 发布到 EventBus → 触发 Agent/Orchestrator
任务 B：从 EventBus 队列读取 → 发送到 WebSocket 客户端
"""

import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.core.event_bus import event_bus
from app.models.message import Message
from app.models.session import Session
from app.ws.connection_manager import manager

router = APIRouter()


def _utcnow():
    return datetime.now(timezone.utc)


@router.websocket("/ws/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    session_id: str,
    client_id: str = Query(...),
):
    # Validate session exists
    async with async_session() as db:
        session = await db.get(Session, session_id)
        if not session:
            await websocket.close(code=4004, reason="Session not found")
            return

    await manager.connect(client_id, session_id, websocket)
    queue = await event_bus.subscribe(session_id)

    async def ws_to_eventbus():
        """Read from WebSocket, persist messages, publish to event bus."""
        try:
            while True:
                raw = await websocket.receive_text()
                data = json.loads(raw)
                msg_type = data.get("type", "")

                if msg_type == "chat.send":
                    await _handle_chat_send(session_id, client_id, data.get("payload", {}))
                elif msg_type == "ping":
                    manager.handle_pong(client_id)  # reset heartbeat on any ping/pong
                    await manager.send_personal({"type": "pong", "session_id": session_id}, client_id)
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            manager.disconnect(client_id)

    async def eventbus_to_ws():
        """Read from session event queue, forward to WebSocket."""
        try:
            while True:
                event = await queue.get()
                await manager.send_personal(event, client_id)
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    await asyncio.gather(ws_to_eventbus(), eventbus_to_ws())


async def _handle_chat_send(session_id: str, client_id: str, payload: dict):
    """Persist a user message and broadcast it."""
    content = payload.get("content", "")
    if not content.strip():
        return

    async with async_session() as db:
        # Touch session last_active
        session = await db.get(Session, session_id)
        if session:
            session.last_active_at = _utcnow()

        message = Message(
            session_id=session_id,
            role="user",
            content=content,
            message_type=payload.get("message_type", "text"),
        )
        db.add(message)
        await db.commit()
        await db.refresh(message)

        # Broadcast message to all clients in this session
        msg_data = {
            "type": "chat.message",
            "session_id": session_id,
            "payload": {
                "id": message.id,
                "session_id": message.session_id,
                "role": message.role,
                "content": message.content,
                "message_type": message.message_type,
                "created_at": message.created_at.isoformat(),
            },
        }
        await event_bus.publish(session_id, msg_data)

        # 记录 session 类型，用于 with 块外的分发
        session_type = session.type if session else "single"

    # 根据会话类型分发：群聊走 Orchestrator，单聊走 Agent Runner
    if session_type == "group":
        from app.core.orchestrator import Orchestrator
        asyncio.create_task(Orchestrator(session_id).handle_message(content))
    else:
        asyncio.create_task(_trigger_agent(session_id, content))


async def _trigger_agent(session_id: str, content: str):
    """单聊模式：调用 Agent Runner 获取回复（fire-and-forget）。"""
    from app.services.agent_runner import run_agent_reply
    try:
        await run_agent_reply(session_id, content)
    except Exception:
        pass
