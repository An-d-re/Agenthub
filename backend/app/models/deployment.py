"""Deployment model — 一键部署记录。"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.sqlite import CHAR as UUID

from app.core.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class Deployment(Base):
    __tablename__ = "deployments"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(UUID(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    artifact_id = Column(UUID(36), ForeignKey("artifacts.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), default="pending")  # pending | deploying | running | failed
    url = Column(String(500), nullable=True)
    port = Column(Integer, default=0)
    logs = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    def __repr__(self):
        return f"<Deployment {self.id} [{self.status}]>"
