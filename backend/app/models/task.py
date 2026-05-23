"""Task and TaskDependency models."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.sqlite import CHAR as UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    plan_id = Column(UUID(36), ForeignKey("plans.id", ondelete="CASCADE"), nullable=False)
    parent_task_id = Column(UUID(36), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, default="")
    assigned_agent_id = Column(UUID(36), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), default="pending")  # pending→in_progress→review→done|blocked|retry|dispute
    round = Column(Integer, default=1)
    priority = Column(Integer, default=0)
    retry_count = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    result = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow)

    plan = relationship("Plan", back_populates="tasks")

    def __repr__(self):
        return f"<Task {self.title} [{self.status}]>"


class TaskDependency(Base):
    __tablename__ = "task_dependencies"
    __table_args__ = (
        UniqueConstraint("task_id", "depends_on_task_id"),
        CheckConstraint("task_id != depends_on_task_id", name="ck_no_self_dep"),
    )

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id = Column(UUID(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    depends_on_task_id = Column(UUID(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
