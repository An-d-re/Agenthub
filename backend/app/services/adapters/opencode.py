"""OpenCode adapter via OpenAI-compatible HTTP API."""

from openai import AsyncOpenAI

from app.core.config import settings
from app.services.adapters.deepseek import DeepSeekAdapter


class OpenCodeAdapter(DeepSeekAdapter):
    """OpenCode is OpenAI-compatible; reuse DeepSeekAdapter implementation."""

    adapter_type = "opencode"

    async def initialize(self, config: dict) -> None:
        self.model = config.get("model", "opencode-default")
        self.temperature = config.get("temperature", 0.7)
        self.max_tokens = config.get("max_tokens", 4096)
        self.system_prompt = config.get("system_prompt", "You are OpenCode, a lightweight coding assistant.")
        api_key = config.get("api_key", settings.opencode_api_key)
        base_url = config.get("base_url", settings.opencode_base_url)
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def get_capabilities(self) -> dict:
        return {
            "adapter_type": "opencode",
            "supports_streaming": True,
            "model": self.model,
        }
