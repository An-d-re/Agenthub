"""Artifact model — code files, diffs, and generated outputs."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.sqlite import CHAR as UUID

from app.core.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class Artifact(Base):
    __tablename__ = "artifacts"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id = Column(UUID(36), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    session_id = Column(UUID(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    file_path = Column(String(500), nullable=False)
    original_content = Column(Text, default="")
    modified_content = Column(Text, default="")
    language = Column(String(50), default="text")
    artifact_type = Column(String(20), default="code")  # code | diff | preview | file
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    def __repr__(self):
        return f"<Artifact {self.file_path}>"
