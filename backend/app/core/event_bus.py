"""Internal event bus backed by asyncio.Queue. Single-process only."""

import asyncio
from typing import Any

from app.core.config import settings


class EventBus:
    """Per-session event queues for routing messages to WebSocket connections."""

    def __init__(self):
        self._queues: dict[str, asyncio.Queue] = {}

    async def subscribe(self, session_id: str) -> asyncio.Queue:
        if session_id not in self._queues:
            self._queues[session_id] = asyncio.Queue(maxsize=1000)
        return self._queues[session_id]

    def unsubscribe(self, session_id: str):
        self._queues.pop(session_id, None)

    async def publish(self, session_id: str, event: dict[str, Any]):
        if session_id in self._queues:
            await self._queues[session_id].put(event)

    async def broadcast(self, event: dict[str, Any]):
        for q in self._queues.values():
            await q.put(event)


event_bus = EventBus()
