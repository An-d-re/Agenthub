"""Pydantic schemas for Session."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SessionCreate(BaseModel):
    title: str = "New Session"
    type: str = "single"  # single | group
    agent_ids: list[str] = []


class AgentBindingResponse(BaseModel):
    id: str
    agent_id: str
    session_id: str
    agent_name: str = ""
    agent_avatar: str = ""
    adapter_type: str = ""


class TaskStatusResponse(BaseModel):
    task_id: str
    title: str = ""
    status: str = "pending"
    assigned_agent_id: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PlanResponse(BaseModel):
    phase: str = "clarify"
    status: str = "active"
    selected_approach: Optional[str] = None
    tasks: list[TaskStatusResponse] = []

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    id: str
    title: str
    type: str
    status: str
    pinned_at: Optional[datetime] = None
    last_active_at: Optional[datetime] = None
    created_at: datetime
    agents: list[AgentBindingResponse] = []
    plan: Optional[PlanResponse] = None

    model_config = {"from_attributes": True}


class SessionListItem(BaseModel):
    id: str
    title: str
    type: str
    status: str
    pinned_at: Optional[datetime] = None
    last_active_at: Optional[datetime] = None
    last_message_preview: str = ""
    agent_count: int = 0
    agent_ids: list[str] = []
