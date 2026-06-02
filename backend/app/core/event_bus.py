"""Internal event bus backed by asyncio.Queue. Single-process only."""

import asyncio
import logging
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class EventBus:
    """Per-session event queues for routing messages to WebSocket connections."""

    def __init__(self):
        self._queues: dict[str, asyncio.Queue] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, session_id: str) -> asyncio.Queue:
        async with self._lock:
            # 始终创建新队列，避免重连时收到过期事件
            if session_id in self._queues:
                old = self._queues[session_id]
                # 排空旧队列
                while not old.empty():
                    try:
                        old.get_nowait()
                    except asyncio.QueueEmpty:
                        break
            self._queues[session_id] = asyncio.Queue(maxsize=1000)
            return self._queues[session_id]

    def unsubscribe(self, session_id: str):
        self._queues.pop(session_id, None)

    async def publish(self, session_id: str, event: dict[str, Any]):
        if session_id in self._queues:
            try:
                self._queues[session_id].put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("EventBus 队列已满 session=%s，丢弃旧事件", session_id)
                # 丢弃最旧事件，放入新事件
                try:
                    self._queues[session_id].get_nowait()
                    self._queues[session_id].put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass

    async def broadcast(self, event: dict[str, Any]):
        for q in self._queues.values():
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass


event_bus = EventBus()
