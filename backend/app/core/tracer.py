"""轻量级 trace/span 追踪器。

使用 async context manager 记录每个 span 的起止时间、耗时和状态，
自动持久化到 Trace 表并发布 trace.span 事件到 EventBus。
"""

import time
import uuid
import logging
from contextlib import asynccontextmanager
from typing import Optional

from app.core.database import async_session
from app.core.event_bus import event_bus

logger = logging.getLogger(__name__)


class Tracer:
    """全局单例追踪器。"""

    @asynccontextmanager
    async def span(
        self,
        session_id: str,
        operation_name: str,
        service_name: str = "agenthub",
        parent_span_id: Optional[str] = None,
        trace_id: Optional[str] = None,
        tags: Optional[dict] = None,
    ):
        """异步上下文管理器：进入时开始计时，退出时记录 span。"""
        from app.models.trace import Trace

        trace_id = trace_id or str(uuid.uuid4())
        span_id = str(uuid.uuid4())
        start = time.time()

        span_data = {
            "trace_id": trace_id,
            "span_id": span_id,
            "parent_span_id": parent_span_id,
            "operation_name": operation_name,
            "service_name": service_name,
            "session_id": session_id,
            "tags": tags or {},
            "status": "ok",
        }

        try:
            yield span_data
            span_data["status"] = "ok"
        except Exception:
            span_data["status"] = "error"
            raise
        finally:
            duration_ms = (time.time() - start) * 1000

            # 持久化到 DB
            try:
                async with async_session() as db:
                    trace = Trace(
                        session_id=session_id,
                        trace_id=trace_id,
                        span_id=span_id,
                        parent_span_id=parent_span_id,
                        operation_name=operation_name,
                        service_name=service_name,
                        duration_ms=duration_ms,
                        status=span_data["status"],
                        tags=span_data["tags"],
                    )
                    db.add(trace)
                    await db.commit()
            except Exception:
                logger.warning("Trace DB 持久化失败", exc_info=True)

            # 发布到 EventBus 供前端实时展示
            try:
                await event_bus.publish(session_id, {
                    "type": "trace.span",
                    "session_id": session_id,
                    "payload": {
                        "trace_id": trace_id,
                        "span_id": span_id,
                        "parent_span_id": parent_span_id,
                        "operation_name": operation_name,
                        "service_name": service_name,
                        "status": span_data["status"],
                        "duration_ms": round(duration_ms, 1),
                        "tags": span_data["tags"],
                    },
                })
            except Exception:
                logger.warning("Trace EventBus 发布失败", exc_info=True)


tracer = Tracer()
