"""Trace model — observability spans for the trace panel."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, JSON, String
from sqlalchemy.dialects.sqlite import CHAR as UUID

from app.core.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class Trace(Base):
    __tablename__ = "traces"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(UUID(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    trace_id = Column(String(36), nullable=False)
    span_id = Column(String(36), nullable=False, unique=True)
    parent_span_id = Column(String(36), nullable=True)
    operation_name = Column(String(200), nullable=False)
    service_name = Column(String(100), nullable=False)
    start_time = Column(DateTime(timezone=True), default=_utcnow)
    end_time = Column(DateTime(timezone=True), nullable=True)
    duration_ms = Column(Float, nullable=True)
    status = Column(String(10), default="ok")  # ok | error
    tags = Column(JSON, default=dict)
    logs = Column(JSON, default=list)

    def __repr__(self):
        return f"<Trace {self.operation_name} [{self.status}]>"
