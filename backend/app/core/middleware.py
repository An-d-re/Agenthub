"""编排器中间件链。

顺序不可变：ContextSummarizer → LoopDetector → SubagentLimiter
"""

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from app.core.event_bus import event_bus

logger = logging.getLogger(__name__)

# 模块级 OpenAI client 缓存（ContextSummarizer 复用）
_summarize_client = None


async def _get_summarize_client():
    global _summarize_client
    if _summarize_client is None:
        from openai import AsyncOpenAI
        from app.core.config import settings
        _summarize_client = AsyncOpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            timeout=15.0,
            trust_env=False,
        )
    return _summarize_client

# ── Context ──────────────────────────────────────────────────


@dataclass
class MiddlewareContext:
    session_id: str
    task_id: Optional[str] = None
    conversation_history: list[dict] = field(default_factory=list)
    task_payload: dict = field(default_factory=dict)
    blocked: bool = False
    block_reason: str = ""


# ── Base ────────────────────────────────────────────────────


class BaseMiddleware:
    async def process(self, ctx: MiddlewareContext) -> MiddlewareContext:
        raise NotImplementedError


# ── 1. ContextSummarizer ────────────────────────────────────


class ContextSummarizer(BaseMiddleware):
    """上下文压缩：当对话历史超长时，只保留最近消息 + 早期摘要。

    阈值：50 条消息或估算 > 8K tokens（按 4 chars/token 估算）。
    """

    MAX_MESSAGES = 50
    MAX_TOKENS = 8000

    async def process(self, ctx: MiddlewareContext) -> MiddlewareContext:
        history = ctx.conversation_history

        # 快速估算：每条消息 avg ~100 chars → 25 tokens，50 条 ≈ 1250 tokens，远低于 8K
        total_chars = sum(len(m.get("content", "")) for m in history)
        estimated_tokens = total_chars // 4

        if len(history) > self.MAX_MESSAGES or estimated_tokens > self.MAX_TOKENS:
            # 保留最近 20 条完整消息 + 前段摘要
            recent = history[-20:]
            old_summary = await self._summarize_old(history[:-20])
            ctx.conversation_history = (
                [{"role": "system", "content": f"[早期对话摘要] {old_summary}"}]
                if old_summary
                else []
            ) + recent

            logger.info(
                "ContextSummarizer: 压缩完成 %d→%d 条，tokens ~%d",
                len(history), len(ctx.conversation_history),
                sum(len(m.get("content", "")) for m in ctx.conversation_history) // 4,
            )

            # 通知前端
            await event_bus.publish(ctx.session_id, {
                "type": "context.summarized",
                "session_id": ctx.session_id,
                "payload": {
                    "before_messages": len(history),
                    "after_messages": len(ctx.conversation_history),
                    "before_tokens": estimated_tokens,
                    "after_tokens": sum(len(m.get("content", "")) for m in ctx.conversation_history) // 4,
                },
            })

        return ctx

    async def _summarize_old(self, old_messages: list[dict]) -> str:
        """调用 DeepSeek LLM 做智能摘要，失败时降级为规则摘要。"""
        if not old_messages:
            return ""

        # 构建摘要对话
        conversation_text = "\n".join(
            f"[{m.get('role', '?')}]: {m.get('content', '')[:300]}"
            for m in old_messages[-30:]  # 最多取最近 30 条旧消息做摘要
        )

        summary_prompt = (
            "请用中文总结以下对话的关键信息，严格按此格式输出（每行一条，不超过 300 字）：\n"
            "关键决策: <用户确认了哪些方案、选择了什么技术栈、做了什么取舍>\n"
            "已生成文件: <列出了哪些文件、分别是什么作用>\n"
            "待解决问题: <还有哪些问题悬而未决、哪些 TODO 未完成>\n"
            "用户偏好: <用户表达了哪些偏好、约束条件、代码风格要求>\n\n"
            f"对话内容:\n{conversation_text}\n\n"
            "现在输出摘要（如某条确实没有信息可写'无'）："
        )

        try:
            from app.core.config import settings

            if not settings.deepseek_api_key:
                raise ValueError("DeepSeek API key 未配置")

            client = await _get_summarize_client()
            response = await client.chat.completions.create(
                model="deepseek-chat",
                messages=[{"role": "user", "content": summary_prompt}],
                max_tokens=300,
                temperature=0.3,
            )
            summary = response.choices[0].message.content or ""
            logger.info("ContextSummarizer: LLM 摘要生成成功 (%d chars)", len(summary))
            return summary.strip()

        except Exception as e:
            logger.warning("ContextSummarizer: LLM 摘要失败 (%s)，降级为规则摘要", e)
            return self._fallback_summarize(old_messages)

    def _fallback_summarize(self, old_messages: list[dict]) -> str:
        """规则摘要 — LLM 不可用时的降级方案。"""
        decisions: list[str] = []
        files: list[str] = []

        for m in old_messages:
            content = m.get("content", "")
            lower = content.lower()
            if any(kw in lower for kw in ["方案", "approach", "选择", "selected", "决定", "decided"]):
                snippet = content[:200].replace("\n", " ")
                decisions.append(snippet)
            if "```" in content or "file:" in lower or "文件" in lower:
                paths = re.findall(r'`([^`]+\.\w+)`', content)
                files.extend(paths[:3])

        parts: list[str] = []
        if decisions:
            parts.append(f"关键决策: {'; '.join(decisions[-2:])}")
        if files:
            parts.append(f"已生成文件: {', '.join(files[:5])}")
        return " | ".join(parts) if parts else "无关键信息"


# ── 2. LoopDetector ─────────────────────────────────────────


class LoopDetector(BaseMiddleware):
    """循环检测：跟踪每个会话的任务签名，检测同一任务重复执行。

    如果同一 (agent_role + task_title) 在连续 2 轮中被执行且之前已失败，
    标记 blocked 防止无限重试。
    """

    def __init__(self):
        # session_id → set of task signatures
        self._signatures: dict[str, set[str]] = {}
        # session_id → dict[signature, count]
        self._counts: dict[str, dict[str, int]] = {}

    async def process(self, ctx: MiddlewareContext) -> MiddlewareContext:
        signature = self._make_signature(ctx.task_payload)
        sid = ctx.session_id

        if sid not in self._signatures:
            self._signatures[sid] = set()
            self._counts[sid] = {}

        self._signatures[sid].add(signature)
        self._counts[sid][signature] = self._counts[sid].get(signature, 0) + 1

        count = self._counts[sid][signature]

        if count >= 3:
            ctx.blocked = True
            ctx.block_reason = (
                f"LoopDetector: 任务「{ctx.task_payload.get('title', 'unknown')}」"
                f"已执行 {count} 次，疑似循环，已阻止。请人工检查需求或拆分方式。"
            )
            logger.warning("LoopDetector blocked: %s (count=%d)", signature, count)

        return ctx

    def _make_signature(self, task_payload: dict) -> str:
        title = task_payload.get("title", "")
        desc = task_payload.get("description", "")
        raw = f"{title}|{desc[:100]}"
        return hashlib.md5(raw.encode()).hexdigest()[:12]

    def reset_session(self, session_id: str):
        self._signatures.pop(session_id, None)
        self._counts.pop(session_id, None)


# ── 3. SubagentLimiter ──────────────────────────────────────


class SubagentLimiter(BaseMiddleware):
    """并行限制：每个会话最多 3 个 Agent 同时工作。

    使用信号量控制并发，超出上限的任务等待而非阻塞。
    """

    MAX_CONCURRENT = 3

    def __init__(self):
        self._semaphores: dict[str, asyncio.Semaphore] = {}

    async def process(self, ctx: MiddlewareContext) -> MiddlewareContext:
        sid = ctx.session_id
        if sid not in self._semaphores:
            self._semaphores[sid] = asyncio.Semaphore(self.MAX_CONCURRENT)

        sem = self._semaphores[sid]
        if sem.locked():
            await event_bus.publish(sid, {
                "type": "subagent.queue",
                "session_id": sid,
                "payload": {
                    "task_id": ctx.task_id,
                    "status": "queued",
                    "max_concurrent": self.MAX_CONCURRENT,
                },
            })

        return ctx

    async def acquire(self, session_id: str):
        import asyncio
        if session_id not in self._semaphores:
            self._semaphores[session_id] = asyncio.Semaphore(self.MAX_CONCURRENT)
        await self._semaphores[session_id].acquire()

    def release(self, session_id: str):
        if session_id in self._semaphores:
            self._semaphores[session_id].release()

    def reset_session(self, session_id: str):
        self._semaphores.pop(session_id, None)


# ── Chain ───────────────────────────────────────────────────


class MiddlewareChain:
    """不可变顺序的中间件链。"""

    def __init__(self):
        self._summarizer = ContextSummarizer()
        self._loop_detector = LoopDetector()
        self._subagent_limiter = SubagentLimiter()
        self._middlewares: list[BaseMiddleware] = [
            self._summarizer,
            self._loop_detector,
            self._subagent_limiter,
        ]

    async def run(self, ctx: MiddlewareContext) -> MiddlewareContext:
        for m in self._middlewares:
            ctx = await m.process(ctx)
            if ctx.blocked:
                logger.warning("中间件 %s 已阻止: %s", type(m).__name__, ctx.block_reason)
                break
        return ctx

    @property
    def subagent_limiter(self) -> SubagentLimiter:
        return self._subagent_limiter

    def reset_session(self, session_id: str):
        self._loop_detector.reset_session(session_id)
        self._subagent_limiter.reset_session(session_id)
