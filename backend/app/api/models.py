"""Models API —— 返回可用/不可用的大模型列表。"""

from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(prefix="/api/models", tags=["models"])

ADAPTER_DISPLAY = {
    "deepseek": {"name": "DeepSeek", "icon": "🧠", "description": "DeepSeek 深度思考模型"},
    "anthropic": {"name": "Claude", "icon": "✨", "description": "Anthropic Claude 模型"},
    "opencode": {"name": "OpenCode", "icon": "🔧", "description": "OpenCode AI 模型"},
}


def _has_key(adapter_type: str) -> bool:
    """检测适配器对应的 API Key 是否已配置。"""
    key_attr = f"{adapter_type}_api_key"
    return bool(getattr(settings, key_attr, ""))


@router.get("/available")
async def list_models():
    """返回所有适配器及其可用状态。

    可用 = 已配置 API Key；不可用 = 需要用户提供 Key。
    """
    models = []
    for at, info in ADAPTER_DISPLAY.items():
        models.append({
            "adapter_type": at,
            "name": info["name"],
            "icon": info["icon"],
            "description": info["description"],
            "available": _has_key(at),
            "needs_key": not _has_key(at),
        })
    return {"models": models}
