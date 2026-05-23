"""Plan model — orchestration plans for a session."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.dialects.sqlite import CHAR as UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class Plan(Base):
    __tablename__ = "plans"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(UUID(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    phase = Column(String(20), default="clarify")  # clarify | comparison | confirmed | executing | done
    approaches = Column(JSON, nullable=True)  # [{name, summary, pros, cons, recommended}]
    selected_approach = Column(String(100), nullable=True)
    task_dag = Column(JSON, nullable=True)  # [{id, title, dependencies[], assigned_agent_id}]
    status = Column(String(20), default="active")
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow)

    tasks = relationship("Task", back_populates="plan", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Plan {self.phase} for session {self.session_id}>"
