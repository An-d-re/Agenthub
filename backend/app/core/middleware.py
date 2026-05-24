"""编排器中间件链。

架构约束：顺序不可变。
ContextSummarizer（上下文压缩）→ LoopDetector（循环检测）→ SubagentLimiter（并行限制）

MVP 阶段：三个中间件均为透传，仅记录日志。实际逻辑在 MVP 之后补充。
"""

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class MiddlewareContext:
    """中间件链传递的上下文对象。"""
    session_id: str
    task_id: str | None = None
    conversation_history: list[dict] = field(default_factory=list)
    task_payload: dict = field(default_factory=dict)
    blocked: bool = False
    block_reason: str = ""


class BaseMiddleware:
    """中间件基类。"""
    async def process(self, ctx: MiddlewareContext) -> MiddlewareContext:
        raise NotImplementedError


class ContextSummarizer(BaseMiddleware):
    """上下文压缩：当 token 数超过阈值时，用 LLM 摘要替代早期消息。MVP 阶段透传。"""

    async def process(self, ctx: MiddlewareContext) -> MiddlewareContext:
        logger.debug("ContextSummarizer: MVP 透传")
        return ctx


class LoopDetector(BaseMiddleware):
    """循环检测：发现重复的(agent_role, task_signature)时标记 blocked。MVP 阶段透传。"""

    async def process(self, ctx: MiddlewareContext) -> MiddlewareContext:
        logger.debug("LoopDetector: MVP 透传")
        return ctx


class SubagentLimiter(BaseMiddleware):
    """并行限制：同一轮并行 Agent 数 ≤ 3。MVP 阶段透传。"""

    async def process(self, ctx: MiddlewareContext) -> MiddlewareContext:
        logger.debug("SubagentLimiter: MVP 透传")
        return ctx


class MiddlewareChain:
    """不可变顺序的中间件链：ContextSummarizer → LoopDetector → SubagentLimiter。"""

    def __init__(self):
        self._middlewares: list[BaseMiddleware] = [
            ContextSummarizer(),
            LoopDetector(),
            SubagentLimiter(),
        ]

    async def run(self, ctx: MiddlewareContext) -> MiddlewareContext:
        for m in self._middlewares:
            ctx = await m.process(ctx)
            if ctx.blocked:
                logger.warning("中间件 %s 已阻止: %s", type(m).__name__, ctx.block_reason)
                break
        return ctx
