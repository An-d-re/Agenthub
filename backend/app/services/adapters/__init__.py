"""Adapter registry factory."""

from app.services.adapters.anthropic import AnthropicAdapter
from app.services.adapters.base import BaseAdapter
from app.services.adapters.codex import CodexAdapter
from app.services.adapters.deepseek import DeepSeekAdapter
from app.services.adapters.opencode import OpenCodeAdapter

ADAPTER_REGISTRY: dict[str, type[BaseAdapter]] = {
    "deepseek": DeepSeekAdapter,
    "anthropic": AnthropicAdapter,
    "codex": CodexAdapter,
    "opencode": OpenCodeAdapter,
}


def create_adapter(adapter_type: str) -> BaseAdapter:
    adapter_cls = ADAPTER_REGISTRY.get(adapter_type)
    if not adapter_cls:
        raise ValueError(f"Unknown adapter type: {adapter_type}")
    return adapter_cls()
