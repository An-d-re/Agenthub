"""Pydantic schemas for Agent CRUD."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AgentCreate(BaseModel):
    name: str
    role_type: str = "custom"  # system | custom
    adapter_type: str = "deepseek"
    system_prompt: str = ""
    skills: list[str] = []
    capability_tags: list[str] = []
    avatar_url: str = ""


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    skills: Optional[list[str]] = None
    capability_tags: Optional[list[str]] = None
    avatar_url: Optional[str] = None


class AgentResponse(BaseModel):
    id: str
    name: str
    avatar_url: str
    role_type: str
    adapter_type: str
    system_prompt: str
    skills: list[str]
    capability_tags: list[str]
    is_deletable: bool

    model_config = {"from_attributes": True}
