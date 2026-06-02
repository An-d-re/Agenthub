"""
Codex 适配器（桩）。

提供 OpenAI 兼容 API。未配置 API key 时自动降级到 DeepSeek。
当前为预留桩，直接继承 DeepSeekAdapter 的所有方法。
TODO: 当 Codex 协议与 DeepSeek 出现差异时，重写相应方法。
"""

import logging

from app.services.adapters.deepseek import DeepSeekAdapter

logger = logging.getLogger(__name__)


class CodexAdapter(DeepSeekAdapter):
    """Codex 协议的适配器桩。无 key 时降级 DeepSeek。"""

    def __init__(self):
        super().__init__()
        self.adapter_type = "codex"

    async def initialize(self, config: dict) -> None:
        api_key = config.get("api_key")
        if not api_key:
            logger.info("Codex API key 未配置，降级到 DeepSeek")
            self.adapter_type = "deepseek"
            config["api_key"] = None
            await super().initialize(config)
            return
        self._config = config

    async def get_capabilities(self) -> dict:
        caps = await super().get_capabilities()
        caps["adapter_type"] = "codex"
        return caps
