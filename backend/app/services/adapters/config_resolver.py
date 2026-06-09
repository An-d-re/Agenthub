"""Adapter config resolver — 按优先级合并 API key 和模型选择。

优先级：
  1. Agent 专属 encrypted_api_key (AES 解密)
  2. 前端 Settings 全局 API key (AES 解密)
  3. .env 环境变量
"""

from typing import Optional

from app.core.agent_factory import decrypt_api_key
from app.core.database import async_session
from app.api.settings import _load_settings


async def resolve_adapter_config(
    adapter_type: str,
    encrypted_agent_key: Optional[str] = None,
    preferred_model: Optional[str] = None,
) -> dict:
    """返回 adapter.initialize() 所需的 config dict。

    优先级：Agent 专属 → 全局 Settings → 环境变量。
    """
    api_key: Optional[str] = None
    model: Optional[str] = preferred_model or None  # Agent 级别的模型优先

    # 1. Agent 专属 key
    if encrypted_agent_key:
        try:
            api_key = decrypt_api_key(encrypted_agent_key)
        except Exception:
            pass

    # 2. 前端全局 Settings
    try:
        settings = await _load_settings()
        prov = settings["providers"].get(adapter_type, {})
        if not api_key:
            encrypted = prov.get("api_key", "")
            if encrypted:
                try:
                    api_key = decrypt_api_key(encrypted)
                except Exception:
                    pass
        if not model:
            model = prov.get("model") or None
    except Exception:
        pass

    return {
        "api_key": api_key,
        "model": model,
    }
