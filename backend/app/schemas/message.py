"""Pydantic schemas for Message."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class MessageResponse(BaseModel):
    id: str
    session_id: str
    agent_id: Optional[str] = None
    role: str
    content: str
    message_type: str
    parent_id: Optional[str] = None
    code_selection: Optional[dict] = None
    tokens_used: int
    created_at: datetime

    model_config = {"from_attributes": True}


class PinToggle(BaseModel):
    message_id: str
    pin: bool
