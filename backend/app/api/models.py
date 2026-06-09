"""Models API —— 返回可用模型列表和具体变体。"""

from fastapi import APIRouter

from app.core.config import settings
from app.api.settings import MODEL_CATALOG, _load_settings

router = APIRouter(prefix="/api/models", tags=["models"])

ADAPTER_DISPLAY = {
    "deepseek": {"name": "DeepSeek", "description": "通过 OpenAI 兼容协议接入"},
    "anthropic": {"name": "Claude", "description": "Anthropic Claude 系列模型"},
    "opencode": {"name": "OpenCode", "description": "OpenCode AI 模型"},
}


def _has_env_key(adapter_type: str) -> bool:
    key_attr = f"{adapter_type}_api_key"
    return bool(getattr(settings, key_attr, ""))


@router.get("/available")
async def list_models():
    """返回所有提供商、模型变体及可用状态。

    可用条件（任一满足）：
    - .env 中已配置对应 API Key
    - 前端 Settings 中已保存 API Key
    """
    user_settings = await _load_settings()
    models_out = []
    for atype, info in ADAPTER_DISPLAY.items():
        model_variants = MODEL_CATALOG.get(atype, [])
        user_prov = user_settings["providers"].get(atype, {})
        has_user_key = bool(user_prov.get("api_key", ""))
        available = _has_env_key(atype) or has_user_key
        selected_model = user_prov.get("model") or (model_variants[0]["id"] if model_variants else "")

        models_out.append({
            "adapter_type": atype,
            "name": info["name"],
            "description": info["description"],
            "available": available,
            "needs_key": not available,
            "models": model_variants,
            "selected_model": selected_model,
        })
    return {"models": models_out}
