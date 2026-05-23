"""DeepSeek adapter via OpenAI-compatible HTTP API."""

from app.services.adapters.base import AgentContext, AgentResponse, BaseAdapter


class DeepSeekAdapter(BaseAdapter):
    adapter_type = "deepseek"

    async def initialize(self, config: dict) -> None:
        self.config = config

    async def send_message(self, context: AgentContext, message: str) -> AgentResponse:
        raise NotImplementedError

    async def stream_message(self, context: AgentContext, message: str):
        raise NotImplementedError

    async def execute_task(self, context: AgentContext, task: dict) -> AgentResponse:
        raise NotImplementedError

    async def review_result(
        self, context: AgentContext, original_task: dict, result: str
    ) -> AgentResponse:
        raise NotImplementedError

    async def get_capabilities(self) -> dict:
        return {"adapter_type": "deepseek", "supports_streaming": True}
