"""Trace REST API — fetch traces for observability panel."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.trace import Trace

router = APIRouter(prefix="/api/traces", tags=["traces"])


@router.get("")
async def list_traces(
    session_id: str = Query(...),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Trace)
        .where(Trace.session_id == session_id)
        .order_by(desc(Trace.start_time))
        .limit(limit)
    )
    traces = result.scalars().all()
    return [
        {
            "id": t.id,
            "trace_id": t.trace_id,
            "span_id": t.span_id,
            "parent_span_id": t.parent_span_id,
            "operation_name": t.operation_name,
            "service_name": t.service_name,
            "duration_ms": t.duration_ms,
            "status": t.status,
            "tags": t.tags,
            "start_time": t.start_time.isoformat() if t.start_time else None,
        }
        for t in traces
    ]
