"""UserSettings model — runtime-modifiable settings."""

import uuid

from sqlalchemy import Column, JSON, String
from sqlalchemy.dialects.sqlite import CHAR as UUID

from app.core.database import Base


class UserSettings(Base):
    __tablename__ = "user_settings"

    id = Column(UUID(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    key = Column(String(100), unique=True, nullable=False)
    value = Column(JSON, nullable=False)

    def __repr__(self):
        return f"<UserSettings {self.key}>"
