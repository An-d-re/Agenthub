"""WebSocket connection manager with heartbeat."""

import asyncio
import json
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState


class ConnectionManager:
    """Track active WebSocket connections, per-session broadcast, heartbeat."""

    HEARTBEAT_INTERVAL = 30
    HEARTBEAT_TIMEOUT = 10

    def __init__(self):
        self._connections: dict[str, WebSocket] = {}         # client_id → ws
        self._client_sessions: dict[str, str] = {}            # client_id → session_id
        self._heartbeat_tasks: dict[str, asyncio.Task] = {}
        self._pong_events: dict[str, asyncio.Event] = {}

    # ── lifecycle ──────────────────────────────────────────

    async def connect(self, client_id: str, session_id: str, websocket: WebSocket):
        # 防止竞态：同 client_id 旧连接先清理
        if client_id in self._connections:
            await self.disconnect(client_id)
        await websocket.accept()
        self._connections[client_id] = websocket
        self._client_sessions[client_id] = session_id
        self._heartbeat_tasks[client_id] = asyncio.create_task(self._heartbeat_loop(client_id))

    async def disconnect(self, client_id: str):
        ws = self._connections.pop(client_id, None)
        self._client_sessions.pop(client_id, None)
        if task := self._heartbeat_tasks.pop(client_id, None):
            task.cancel()
        self._pong_events.pop(client_id, None)
        # 真正关闭 WebSocket，防止客户端误以为还连着（僵尸连接）
        if ws:
            try:
                await ws.close()
            except Exception:
                pass

    @property
    def active_clients(self) -> dict[str, WebSocket]:
        return {cid: ws for cid, ws in self._connections.items()}

    def has_session_clients(self, session_id: str) -> bool:
        return any(sid == session_id for sid in self._client_sessions.values())

    # ── send ───────────────────────────────────────────────

    async def send_personal(self, message: dict[str, Any], client_id: str):
        ws = self._connections.get(client_id)
        if ws and ws.client_state == WebSocketState.CONNECTED:
            try:
                await ws.send_text(json.dumps(message, default=str))
            except Exception:
                await self.disconnect(client_id)

    async def broadcast_to_session(self, session_id: str, message: dict[str, Any], exclude: set[str] | None = None):
        exclude = exclude or set()
        for cid, sid in self._client_sessions.items():
            if sid == session_id and cid not in exclude:
                await self.send_personal(message, cid)

    # ── heartbeat ──────────────────────────────────────────

    async def _heartbeat_loop(self, client_id: str):
        await asyncio.sleep(self.HEARTBEAT_INTERVAL)
        while client_id in self._connections:
            ws = self._connections.get(client_id)
            if not ws:
                return
            try:
                await ws.send_text(json.dumps({"type": "ping", "timestamp": ""}))
                # 等待 pong 响应，超时则断开
                pong_event = asyncio.Event()
                self._pong_events[client_id] = pong_event
                await asyncio.wait_for(pong_event.wait(), timeout=self.HEARTBEAT_TIMEOUT)
            except (asyncio.TimeoutError, WebSocketDisconnect, Exception):
                await self.disconnect(client_id)
                return
            finally:
                self._pong_events.pop(client_id, None)
            await asyncio.sleep(self.HEARTBEAT_INTERVAL)

    def handle_pong(self, client_id: str):
        """客户端回复 ping 时调用，重置心跳计时器。"""
        pong_event = self._pong_events.get(client_id)
        if pong_event:
            pong_event.set()


manager = ConnectionManager()
