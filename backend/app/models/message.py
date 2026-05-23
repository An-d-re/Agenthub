"""Message and PinnedMessage models."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.sqlite import CHAR as UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(UUID(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(UUID(36), ForeignKey("agents.id", ondelete="SET NULL"), nullable=True)
    role = Column(String(20), nullable=False)  # user | agent | system
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default="text")  # text | code | image | file | card | system
    parent_id = Column(UUID(36), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    code_selection = Column(JSON, nullable=True)  # {start_line, end_line} for partial modify
    tokens_used = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    session = relationship("Session", back_populates="messages")

    def __repr__(self):
        return f"<Message {self.role} in {self.session_id}>"


class PinnedMessage(Base):
    __tablename__ = "pinned_messages"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(UUID(36), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    message_id = Column(UUID(36), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    pinned_at = Column(DateTime(timezone=True), default=_utcnow)
