"""Agent model — system and custom AI agents."""

import uuid

from sqlalchemy import Boolean, Column, String, Text, JSON
from sqlalchemy.dialects.sqlite import CHAR as UUID

from app.core.database import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    avatar_url = Column(String(500), default="")
    role_type = Column(String(20), nullable=False)  # system | custom
    adapter_type = Column(String(50), nullable=False)  # deepseek | anthropic | opencode
    system_prompt = Column(Text, default="")
    skills = Column(JSON, default=list)
    capability_tags = Column(JSON, default=list)
    is_deletable = Column(Boolean, default=True)

    def __repr__(self):
        return f"<Agent {self.name} ({self.adapter_type})>"
