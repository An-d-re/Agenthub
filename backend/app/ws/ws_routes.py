"""WebSocket 路由处理 —— 双异步任务模式。

任务 A：从 WebSocket 读取 → 校验 → 持久化 → 发布到 EventBus → 触发 Agent/Orchestrator
任务 B：从 EventBus 队列读取 → 发送到 WebSocket 客户端
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

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
                elif msg_type == "chat.regenerate":
                    await _handle_chat_regenerate(session_id, client_id, data.get("payload", {}))
                elif msg_type == "chat.modify":
                    await _handle_chat_modify(session_id, client_id, data.get("payload", {}))
                elif msg_type == "plan.action":
                    await _handle_plan_action(session_id, data.get("payload", {}))
                elif msg_type == "session.control":
                    await _handle_session_control(session_id, data.get("payload", {}))
                elif msg_type in ("ping", "pong"):
                    manager.handle_pong(client_id)
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logging.getLogger(__name__).exception("ws_to_eventbus 异常: %s", e)
        finally:
            await manager.disconnect(client_id)
            # 无客户端连接此 session 时清理 EventBus 队列
            remaining = manager.has_session_clients(session_id)
            if not remaining:
                event_bus.unsubscribe(session_id)

    async def eventbus_to_ws():
        """Read from session event queue, forward to WebSocket."""
        try:
            while True:
                event = await queue.get()
                await manager.send_personal(event, client_id)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logging.getLogger(__name__).exception("eventbus_to_ws 异常: %s", e)

    await asyncio.gather(ws_to_eventbus(), eventbus_to_ws())


async def _handle_chat_send(session_id: str, client_id: str, payload: dict):
    """Persist a user message and broadcast it."""
    content = payload.get("content", "")
    logger.info("chat.send session=%s content=%s", session_id, content[:80])
    if not content.strip():
        return

    async with async_session() as db:
        # Touch session last_active
        session = await db.get(Session, session_id)
        if session:
            session.last_active_at = _utcnow()

        quote_id = payload.get("quote_message_id", "") or None
        message = Message(
            session_id=session_id,
            role="user",
            content=content,
            message_type=payload.get("message_type", "text"),
            parent_id=quote_id,
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
                "parent_id": message.parent_id,
                "created_at": message.created_at.isoformat(),
            },
        }
        await event_bus.publish(session_id, msg_data)

        # 记录 session 类型，用于 with 块外的分发
        session_type = session.type if session else "single"

    # 解析 @mentions
    import re as _re
    mentions = _re.findall(r'@([^\s@]+)', content)

    # 根据会话类型分发：群聊走 Orchestrator，单聊走 Agent Runner
    if session_type == "group":
        from app.core.orchestrator import Orchestrator
        # 检查锁状态：如果锁被占用，立即发排队通知
        if Orchestrator.is_locked(session_id):
            await event_bus.publish(session_id, {
                "type": "chat.message",
                "session_id": session_id,
                "payload": {
                    "id": f"queue-{message.id}",
                    "role": "system",
                    "content": "⏳ 消息已排队，正在处理前一条消息…",
                    "message_type": "system",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
            })
        async def _run_orch():
            try:
                await Orchestrator(session_id).handle_message(content, mentions=mentions)
            except asyncio.CancelledError:
                logger.info("Orchestrator task CANCELLED session=%s", session_id)
            except Exception as e:
                logger.exception("Orchestrator task CRASH session=%s: %s", session_id, e)
                await event_bus.publish(session_id, {
                    "type": "chat.message",
                    "session_id": session_id,
                    "payload": {
                        "id": f"error-{message.id}",
                        "role": "system",
                        "content": "任务处理失败，请重试或联系管理员。",
                        "message_type": "system",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    },
                })
        task = asyncio.create_task(_run_orch())
        Orchestrator._running_tasks.setdefault(session_id, set()).add(task)
        task.add_done_callback(lambda t: Orchestrator._running_tasks.get(session_id, set()).discard(t))
    else:
        asyncio.create_task(_trigger_agent(session_id, content))


async def _trigger_agent(session_id: str, content: str):
    """单聊模式：调用 Agent Runner 获取回复（fire-and-forget）。"""
    from app.services.agent_runner import run_agent_reply
    try:
        await run_agent_reply(session_id, content)
    except Exception as e:
        logging.getLogger(__name__).exception("_trigger_agent 异常: %s", e)


async def _handle_chat_regenerate(session_id: str, client_id: str, payload: dict):
    """Handle chat.regenerate — re-run agent for the given message's prompt."""
    message_id = payload.get("message_id", "")
    if not message_id:
        return

    async with async_session() as db:
        # 找到要重新生成的 agent 消息
        agent_msg = await db.get(Message, message_id)
        if not agent_msg or agent_msg.role != "agent":
            return

        # 找到它之前的用户消息，获取原始 prompt
        result = await db.execute(
            select(Message).where(
                Message.session_id == session_id,
                Message.role == "user",
                Message.created_at < agent_msg.created_at,
            ).order_by(Message.created_at.desc()).limit(1)
        )
        user_msg = result.scalar_one_or_none()
        if not user_msg:
            return

        # 删除旧的 agent 消息（广播删除通知？简单起见：标记为 system 类型隐藏）
        agent_msg.message_type = "system"
        agent_msg.content = "[已重新生成]"
        session = await db.get(Session, session_id)
        if session:
            session.last_active_at = _utcnow()
        await db.commit()

        # 通知前端隐藏旧消息
        await manager.broadcast_to_session(session_id, {
            "type": "chat.message",
            "session_id": session_id,
            "payload": {
                "id": agent_msg.id,
                "role": "system",
                "content": "[已重新生成]",
                "message_type": "system",
                "created_at": agent_msg.created_at.isoformat(),
            },
        })

    # 根据会话类型重新触发
    session_type = "single"
    async with async_session() as db:
        s = await db.get(Session, session_id)
        if s:
            session_type = s.type

    if session_type == "group":
        from app.core.orchestrator import Orchestrator
        import re as _re
        mentions = _re.findall(r'@([^\s@]+)', user_msg.content)
        async def _re_run():
            try:
                await Orchestrator(session_id).handle_message(user_msg.content, mentions=mentions)
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.exception("Regenerate orchestrator CRASH session=%s: %s", session_id, e)
        task = asyncio.create_task(_re_run())
        Orchestrator._running_tasks.setdefault(session_id, set()).add(task)
        task.add_done_callback(lambda t: Orchestrator._running_tasks.get(session_id, set()).discard(t))
    else:
        asyncio.create_task(_trigger_agent(session_id, user_msg.content))


async def _handle_chat_modify(session_id: str, client_id: str, payload: dict):
    """Handle chat.modify — code selection + modification instruction."""
    message_id = payload.get("message_id", "")
    start_line = payload.get("start_line", 0)
    end_line = payload.get("end_line", 0)
    instruction = payload.get("instruction", "")
    if not instruction.strip() or not message_id:
        return

    async with async_session() as db:
        session = await db.get(Session, session_id)
        if session:
            session.last_active_at = _utcnow()

        message = Message(
            session_id=session_id,
            role="user",
            content=instruction,
            message_type="modify",
            parent_id=message_id,
            code_selection={"start_line": start_line, "end_line": end_line, "message_id": message_id},
        )
        db.add(message)
        await db.commit()
        await db.refresh(message)

        msg_data = {
            "type": "chat.message",
            "session_id": session_id,
            "payload": {
                "id": message.id,
                "session_id": message.session_id,
                "role": message.role,
                "content": f"[修改请求] 第{start_line}-{end_line}行: {instruction}",
                "message_type": message.message_type,
                "code_selection": message.code_selection,
                "parent_id": message.parent_id,
                "created_at": message.created_at.isoformat(),
            },
        }
        await event_bus.publish(session_id, msg_data)

    from app.services.agent_runner import run_agent_modify
    asyncio.create_task(run_agent_modify(session_id, message_id, start_line, end_line, instruction))


async def _handle_plan_action(session_id: str, payload: dict):
    """Handle plan.action — select approach / confirm plan (with assignments) / delete task from DAG."""
    action = payload.get("action", "")
    if action == "select_approach":
        approach_name = payload.get("approach_name", "")
        if approach_name:
            from app.core.orchestrator import Orchestrator
            asyncio.create_task(Orchestrator(session_id).select_approach(approach_name))
    elif action == "confirm":
        assignments = payload.get("assignments", [])
        from app.core.orchestrator import Orchestrator
        asyncio.create_task(Orchestrator(session_id).confirm_plan(assignments))
    elif action == "delete_task":
        task_id = payload.get("task_id", "")
        if task_id:
            from app.core.orchestrator import Orchestrator
            asyncio.create_task(Orchestrator(session_id).delete_dag_task(task_id))


async def _handle_session_control(session_id: str, payload: dict):
    """Handle session.control — stop/resume session execution."""
    action = payload.get("action", "")
    from app.core.orchestrator import Orchestrator
    if action == "stop":
        Orchestrator.stop_session(session_id)
        await event_bus.publish(session_id, {
            "type": "session.control",
            "session_id": session_id,
            "payload": {"action": "stopped"},
        })
    elif action == "resume":
        Orchestrator.resume_session(session_id)
        await event_bus.publish(session_id, {
            "type": "session.control",
            "session_id": session_id,
            "payload": {"action": "resumed"},
        })
