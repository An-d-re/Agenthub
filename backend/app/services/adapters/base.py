"""Abstract base adapter for AI agent backends."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncIterator, Optional, Union


class AgentRole(str, Enum):
    PLANNER = "planner"
    CODER = "coder"
    REVIEWER = "reviewer"
    ARCHITECT = "architect"


@dataclass
class AgentContext:
    """Context passed to every adapter call."""

    session_id: str
    agent_role: AgentRole
    config: dict = field(default_factory=dict)
    conversation_history: list[dict] = field(default_factory=list)
    current_task: Optional[dict] = None


@dataclass
class AgentResponse:
    """Standardized response from any adapter."""

    content: str
    metadata: dict = field(default_factory=dict)
    artifacts: list[dict] = field(default_factory=list)
    tool_calls: list[dict] = field(default_factory=list)


@dataclass
class StreamToken:
    """流式 token，区分推理内容和回复内容。"""
    type: str  # "content" | "reasoning"
    text: str


# stream_message 的返回类型：可以是字符串（向后兼容）或 StreamToken
StreamTokenType = Union[str, StreamToken]


class BaseAdapter(ABC):
    """Abstract adapter for AI agent backends.

    Lifecycle: initialize(config) → send_message/stream_message/execute_task → stop()
    """

    adapter_type: str = ""

    @abstractmethod
    async def initialize(self, config: dict) -> None: ...

    @abstractmethod
    async def send_message(self, context: AgentContext, message: str) -> AgentResponse: ...

    @abstractmethod
    async def stream_message(self, context: AgentContext, message: str) -> AsyncIterator[StreamTokenType]: ...

    @abstractmethod
    async def execute_task(self, context: AgentContext, task: dict) -> AgentResponse: ...

    @abstractmethod
    async def review_result(self, context: AgentContext, original_task: dict, result: str) -> AgentResponse: ...

    @abstractmethod
    async def get_capabilities(self) -> dict: ...

    async def stop(self) -> None:
        pass
