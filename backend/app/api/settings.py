"""Settings API —— 运行时配置 API Key 和模型选择。

支持用户在前端直接配置各提供商的 API Key 和默认模型，
替代在 .env 中手动配置的方式。存储在 UserSettings 表中。
"""

import hashlib
import os
from base64 import b64encode, b64decode
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.core.database import async_session
from app.models.user_settings import UserSettings

router = APIRouter(prefix="/api/settings", tags=["settings"])

SETTINGS_KEY = "model_settings"

# ── 模型目录 ───────────────────────────────────────────

MODEL_CATALOG: dict[str, list[dict]] = {
    "deepseek": [
        {"id": "deepseek-chat", "name": "DeepSeek-V4 Flash", "description": "通用对话，快速响应，适合大多数代码和文本任务"},
        {"id": "deepseek-reasoner", "name": "DeepSeek-V4 Pro", "description": "深度推理，适合复杂分析、数学和架构设计"},
    ],
    "anthropic": [
        {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "description": "平衡性能与成本，适合日常编码和对话"},
        {"id": "claude-opus-4-7", "name": "Claude Opus 4.7", "description": "最强推理与创造力，适合复杂架构和关键决策"},
        {"id": "claude-haiku-4-5", "name": "Claude Haiku 4.5", "description": "极速轻量，适合简单问答和快速分类"},
    ],
    "opencode": [
        {"id": "opencode", "name": "OpenCode", "description": "OpenCode 默认模型"},
    ],
}


def _get_secret_key() -> bytes:
    raw = os.getenv("SECRET_KEY", "agenthub-default-secret-key")
    return hashlib.sha256(raw.encode()).digest()


def _encrypt(plaintext: str) -> str:
    key = _get_secret_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return b64encode(nonce + ciphertext).decode()


def _decrypt(encrypted: str) -> str:
    key = _get_secret_key()
    aesgcm = AESGCM(key)
    raw = b64decode(encrypted)
    nonce, ciphertext = raw[:12], raw[12:]
    return aesgcm.decrypt(nonce, ciphertext, None).decode()


def _mask_key(key: str) -> str:
    """返回带掩码的 key 用于前端展示。"""
    if not key:
        return ""
    if len(key) <= 7:
        return key[:2] + "***"
    return key[:4] + "****" + key[-4:]


def _default_settings() -> dict:
    return {
        "providers": {
            atype: {"api_key": "", "model": models[0]["id"]}
            for atype, models in MODEL_CATALOG.items()
        }
    }


async def _load_settings() -> dict:
    async with async_session() as db:
        result = await db.execute(
            select(UserSettings).where(UserSettings.key == SETTINGS_KEY)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return _default_settings()
        return row.value


async def _save_settings(data: dict) -> None:
    async with async_session() as db:
        result = await db.execute(
            select(UserSettings).where(UserSettings.key == SETTINGS_KEY)
        )
        row = result.scalar_one_or_none()
        if row is None:
            row = UserSettings(key=SETTINGS_KEY, value=data)
            db.add(row)
        else:
            row.value = data
        await db.commit()


# ── Schema ────────────────────────────────────────────


class ProviderSettings(BaseModel):
    api_key: str = ""
    model: str = ""


class SettingsBody(BaseModel):
    providers: dict[str, ProviderSettings]


# ── Routes ────────────────────────────────────────────


@router.get("")
async def get_settings():
    """获取当前 Settings — API keys 以掩码形式返回。"""
    settings = await _load_settings()
    providers_out = {}
    for atype, prov in settings["providers"].items():
        key = prov.get("api_key", "")
        providers_out[atype] = {
            "api_key": _mask_key(key) if key else "",
            "model": prov.get("model", ""),
            "has_key": bool(key),
        }
    return {"providers": providers_out}


@router.put("")
async def update_settings(body: SettingsBody):
    """更新 Settings — API keys 以 AES-256-GCM 加密存储。

    前端传空 "api_key" 字段表示不修改该 key（保留原值）。
    传非空值则替换。
    """
    current = await _load_settings()
    for atype, prov in body.providers.items():
        if atype not in MODEL_CATALOG:
            raise HTTPException(400, f"Unknown provider: {atype}")
        current_prov = current["providers"].setdefault(atype, {"api_key": "", "model": ""})
        if prov.api_key and not prov.api_key.startswith("****"):
            # 新 key — 加密存储
            current_prov["api_key"] = _encrypt(prov.api_key)
        # 空字符串 = 保留原值
        if prov.model:
            valid_models = [m["id"] for m in MODEL_CATALOG.get(atype, [])]
            if prov.model not in valid_models:
                raise HTTPException(400, f"Unknown model '{prov.model}' for {atype}")
            current_prov["model"] = prov.model

    await _save_settings(current)
    return {"status": "ok"}


@router.post("/test")
async def test_connection(body: dict):
    """测试 API Key 是否有效。简单的模型列表调用。"""
    import time

    atype = body.get("adapter_type", "")
    api_key = body.get("api_key", "")

    if atype not in MODEL_CATALOG:
        raise HTTPException(400, f"Unknown provider: {atype}")
    if not api_key:
        raise HTTPException(400, "API key is required")

    start = time.monotonic()
    try:
        if atype == "deepseek":
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://api.deepseek.com/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                if r.status_code == 200:
                    elapsed = round((time.monotonic() - start) * 1000)
                    return {"ok": True, "latency_ms": elapsed}
                else:
                    return {"ok": False, "error": f"HTTP {r.status_code}"}

        elif atype == "anthropic":
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": "claude-haiku-4-5",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
                if r.status_code in (200, 429):
                    elapsed = round((time.monotonic() - start) * 1000)
                    return {"ok": True, "latency_ms": elapsed}
                else:
                    return {"ok": False, "error": f"HTTP {r.status_code}"}

        elif atype == "opencode":
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://api.opencode.ai/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                )
                if r.status_code == 200:
                    elapsed = round((time.monotonic() - start) * 1000)
                    return {"ok": True, "latency_ms": elapsed}
                else:
                    return {"ok": False, "error": f"HTTP {r.status_code}"}

        else:
            return {"ok": False, "error": "Unknown provider"}

    except Exception as e:
        elapsed = round((time.monotonic() - start) * 1000)
        return {"ok": False, "error": str(e)[:100], "latency_ms": elapsed}


@router.get("/models")
async def list_model_catalog():
    """返回所有提供商和可用模型列表。"""
    settings = await _load_settings()
    providers_out = {}
    for atype, models in MODEL_CATALOG.items():
        prov = settings["providers"].get(atype, {"api_key": "", "model": models[0]["id"]})
        providers_out[atype] = {
            "models": models,
            "selected_model": prov.get("model", models[0]["id"]),
            "has_key": bool(prov.get("api_key", "")),
        }
    return {"providers": providers_out}
