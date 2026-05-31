"""Agent Factory —— 临时 Agent 的创建、匹配、销毁。

两层匹配：
1. 语义匹配：Agent 名称/角色是否与任务所需能力语义一致
2. 能力标签匹配：Agent capability_tags 是否覆盖任务所需技能

两层都不通过 → 标记为需新建临时 Agent
Plan done → 销毁该 Plan 期间创建的所有临时 Agent
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.session import SessionAgent
from app.models.task import Task

logger = logging.getLogger(__name__)


def _utcnow():
    return datetime.now(timezone.utc)


# ── 能力定义 ─────────────────────────────────────────────────

# 能力 → 语义匹配的角色名关键词（按此判断现有 Agent 是否"自然"执行该任务）
CAPABILITY_SEMANTIC_MAP: dict[str, set[str]] = {
    "calculate": {"calculator", "计算", "math", "数学", "arithmetic"},
    "code": {"coder", "developer", "编程", "开发", "工程师", "engineer", "programmer"},
    "verify": {"reviewer", "verifier", "审查", "验证", "审核", "复核", "auditor", "checker"},
    "design": {"planner", "architect", "规划", "设计", "设计师"},
    "analyze": {"critic", "analyst", "分析", "分析师", "advisor", "顾问"},
    "write": {"writer", "author", "写作", "文案", "编辑", "editor"},
    "data": {"analyst", "数据分析", "data scientist", "统计", "statistician"},
}


def _semantic_match(agent: Agent, capability: str) -> bool:
    """检查 Agent 的名称是否语义匹配目标能力。"""
    keywords = CAPABILITY_SEMANTIC_MAP.get(capability, set())
    if not keywords:
        return True  # 未知能力类型，默认允许复用
    agent_name_lower = (agent.name or "").lower()
    agent_role_lower = (agent.role_type or "").lower()
    combined = agent_name_lower + " " + agent_role_lower
    return any(kw in combined for kw in keywords)


def _capability_tag_match(agent: Agent, capability: str) -> bool:
    """检查 Agent 的能力标签是否覆盖目标能力。"""
    tags = {t.lower() for t in (agent.capability_tags or [])}
    return capability.lower() in tags


# ── 匹配逻辑 ─────────────────────────────────────────────────


@dataclass
class MatchResult:
    """Agent 匹配结果。"""
    matched: bool
    agent: Optional[Agent] = None
    reason: str = ""  # 匹配/不匹配的原因


async def match_task_to_agent(
    db: AsyncSession,
    session_id: str,
    capability: str,
    assigned_agent_ids: set[str],
) -> MatchResult:
    """为任务匹配现有 Agent。

    两层匹配：
    1. 语义匹配 —— Agent 身份看起来能做这个任务吗？
    2. 能力标签匹配 —— Agent 标签里有对应技能吗？

    两层都不通过 → 返回 MatchResult(matched=False)
    任一层通过 → 返回匹配到的 Agent
    """
    result = await db.execute(
        select(SessionAgent).where(SessionAgent.session_id == session_id)
    )
    session_agents = result.scalars().all()
    agent_ids = [sa.agent_id for sa in session_agents if sa.agent_id not in assigned_agent_ids]

    if not agent_ids:
        return MatchResult(matched=False, reason="群聊中没有可用的 Agent")

    for aid in agent_ids:
        agent = await db.get(Agent, aid)
        if not agent:
            continue

        sem_ok = _semantic_match(agent, capability)
        tag_ok = _capability_tag_match(agent, capability)

        if sem_ok and tag_ok:
            return MatchResult(matched=True, agent=agent, reason="语义 + 能力标签均匹配")
        if sem_ok:
            return MatchResult(matched=True, agent=agent, reason="语义匹配（能力标签未覆盖但角色一致）")

    return MatchResult(
        matched=False,
        reason=f"没有 Agent 在语义或能力标签上匹配 {capability} 能力",
    )


# ── 临时 Agent 创建 ──────────────────────────────────────────


async def create_temp_agent(
    db: AsyncSession,
    session_id: str,
    task: Task,
    capability: str,
    adapter_type: str,
    api_key: Optional[str] = None,
) -> Agent:
    """为任务创建临时 Agent，按 capability 自动命名。"""
    capability_names = {
        "calculate": "计算Agent",
        "code": "编码Agent",
        "verify": "验证Agent",
        "design": "设计Agent",
        "analyze": "分析Agent",
        "write": "写作Agent",
        "data": "数据Agent",
    }
    name = capability_names.get(capability, f"{capability.capitalize()}Agent")

    capability_prompts = {
        "calculate": "You are a precise calculator. Compute the required result accurately and show your work step by step.",
        "code": "You are a senior software engineer. Write clean, tested, production-ready code.",
        "verify": "You are an independent verifier. Re-do the work independently and compare results. Report PASS or FAIL with evidence.",
        "design": "You are a system architect. Design solutions with clear trade-off analysis.",
        "analyze": "You are a technical analyst. Break down problems into clear requirements.",
        "write": "You are a professional writer. Produce clear, well-structured content.",
        "data": "You are a data analyst. Process and analyze data accurately.",
    }
    system_prompt = capability_prompts.get(capability, f"You are a {capability} specialist.")

    # AES 加密 API Key
    encrypted_key = None
    if api_key:
        encrypted_key = _encrypt_api_key(api_key)

    agent = Agent(
        name=name,
        role_type="custom",
        adapter_type=adapter_type,
        system_prompt=system_prompt,
        capability_tags=[capability],
        is_deletable=True,
        encrypted_api_key=encrypted_key,
    )
    db.add(agent)
    await db.flush()

    # 绑定到会话
    session_agent = SessionAgent(session_id=session_id, agent_id=agent.id)
    db.add(session_agent)
    await db.flush()

    logger.info(
        "Created temp agent %s (capability=%s, adapter=%s) for session %s task %s",
        agent.id, capability, adapter_type, session_id, task.id,
    )
    return agent


# ── 临时 Agent 销毁 ──────────────────────────────────────────


async def destroy_temp_agents(db: AsyncSession, session_id: str) -> int:
    """销毁会话中所有临时 Agent（is_deletable=True 且非手动创建）。

    返回销毁数量。
    """
    result = await db.execute(
        select(SessionAgent).where(SessionAgent.session_id == session_id)
    )
    session_agents = result.scalars().all()

    destroyed = 0
    for sa in session_agents:
        agent = await db.get(Agent, sa.agent_id)
        if agent and agent.is_deletable:
            await db.delete(sa)
            await db.delete(agent)
            destroyed += 1
            logger.info("Destroyed temp agent %s (%s)", agent.id, agent.name)

    if destroyed:
        logger.info("Destroyed %d temp agents in session %s", destroyed, session_id)
    return destroyed


# ── API Key 加解密 ────────────────────────────────────────────


def _get_secret_key() -> bytes:
    """从环境变量获取加密密钥，自动填充/截断到 32 字节。"""
    import os
    import hashlib
    raw = os.getenv("SECRET_KEY", "agenthub-default-secret-key")
    return hashlib.sha256(raw.encode()).digest()


def _encrypt_api_key(api_key: str) -> str:
    """AES-256-GCM 加密 API Key，返回 base64 密文。"""
    import os as _os
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    import base64

    key = _get_secret_key()
    aesgcm = AESGCM(key)
    nonce = _os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, api_key.encode(), None)
    # nonce + ciphertext 一起编码
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt_api_key(encrypted: str) -> str:
    """解密由 _encrypt_api_key 生成的密文。"""
    import base64
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = _get_secret_key()
    aesgcm = AESGCM(key)
    raw = base64.b64decode(encrypted)
    nonce, ciphertext = raw[:12], raw[12:]
    return aesgcm.decrypt(nonce, ciphertext, None).decode()
