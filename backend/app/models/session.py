"""Session and SessionAgent models."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.sqlite import CHAR as UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class Session(Base):
    __tablename__ = "sessions"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(200), default="New Session")
    type = Column(String(20), nullable=False, default="single")  # single | group
    status = Column(String(20), default="active")  # active | archived
    pinned_at = Column(DateTime(timezone=True), nullable=True)
    last_active_at = Column(DateTime(timezone=True), default=_utcnow)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    messages = relationship("Message", back_populates="session", cascade="all, delete-orphan")
    agents = relationship("SessionAgent", back_populates="session", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Session {self.title}>"


class SessionAgent(Base):
    __tablename__ = "session_agents"
    __table_args__ = (UniqueConstraint("session_id", "agent_id"),)

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(UUID(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(UUID(36), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)

    session = relationship("Session", back_populates="agents")
