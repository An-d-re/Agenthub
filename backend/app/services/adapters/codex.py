"""
OpenCode CLI 适配器（桩）。

OpenCode 提供 OpenAI 兼容 API。未配置 API key 时自动降级到 DeepSeek。
当前为预留桩，直接继承 DeepSeekAdapter。
"""

import logging

from app.services.adapters.deepseek import DeepSeekAdapter

logger = logging.getLogger(__name__)


class CodexAdapter(DeepSeekAdapter):
    """OpenCode CLI 的适配器桩，使用 OpenAI 兼容协议。"""

    def __init__(self):
        super().__init__()
        self.adapter_type = "codex"

    async def initialize(self, config: dict) -> None:
        api_key = config.get("api_key")
        if not api_key:
            logger.info("OpenCode API key 未配置，降级到 DeepSeek")
            self.adapter_type = "deepseek"
            config["api_key"] = None  # DeepSeekAdapter 会用 settings 兜底
            await super().initialize(config)
            return
        self._config = config
