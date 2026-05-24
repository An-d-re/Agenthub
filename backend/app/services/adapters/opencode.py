"""OpenCode 适配器 —— 字节系第二 Agent，走 OpenAI 兼容协议。

继承 DeepSeekAdapter。如果 OpenCode API key 未配置，自动降级为 DeepSeek。
"""

import logging

from app.core.config import settings
from app.services.adapters.deepseek import DeepSeekAdapter

logger = logging.getLogger(__name__)


class OpenCodeAdapter(DeepSeekAdapter):
    adapter_type = "opencode"

    def __init__(self):
        super().__init__()
        self._fallback_to_deepseek: bool = False

    async def initialize(self, config: dict) -> None:
        """如果 OpenCode key 未配置，降级使用 DeepSeek。"""
        api_key = config.get("api_key") or settings.opencode_api_key

        if api_key:
            from openai import AsyncOpenAI
            import httpx
            base_url = config.get("base_url") or settings.opencode_base_url
            self._model = config.get("model") or "opencode"
            self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, http_client=httpx.AsyncClient(trust_env=False))
        else:
            logger.warning("OpenCode API key 未配置，降级使用 DeepSeek")
            self._fallback_to_deepseek = True
            # 调用父类初始化（使用 DeepSeek 配置）
            await super().initialize({
                "api_key": settings.deepseek_api_key,
                "base_url": settings.deepseek_base_url,
                "model": "deepseek-chat",
            })

    async def get_capabilities(self) -> dict:
        return {
            "adapter_type": "opencode",
            "model": self._model,
            "supports_streaming": True,
            "fallback_to_deepseek": self._fallback_to_deepseek,
        }
