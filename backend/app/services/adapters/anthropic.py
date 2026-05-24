"""Anthropic Claude 适配器 —— 通过 HTTP API 调用。

默认模型：claude-sonnet-4-20250514。
如果 Anthropic API key 未配置，自动降级为 DeepSeek 兜底。
"""

import logging
from typing import AsyncIterator

import httpx
from anthropic import AsyncAnthropic

from app.core.config import settings
from app.services.adapters.base import AgentContext, AgentResponse, BaseAdapter

logger = logging.getLogger(__name__)

RETRY_DELAYS = [1, 2, 4]


class AnthropicAdapter(BaseAdapter):
    adapter_type = "anthropic"

    def __init__(self):
        self._client: AsyncAnthropic | None = None
        self._model: str = "claude-sonnet-4-20250514"
        self._fallback_to_deepseek: bool = False

    async def initialize(self, config: dict) -> None:
        api_key = config.get("api_key") or settings.anthropic_api_key
        if not api_key:
            logger.warning("Anthropic API key 未配置，将降级使用 DeepSeek")
            self._fallback_to_deepseek = True
            return

        self._model = config.get("model") or "claude-sonnet-4-20250514"
        self._client = AsyncAnthropic(api_key=api_key, http_client=httpx.AsyncClient(trust_env=False))

    async def _get_fallback(self) -> BaseAdapter:
        """获取 DeepSeek 兜底适配器。"""
        from app.services.adapters.deepseek import DeepSeekAdapter
        adapter = DeepSeekAdapter()
        await adapter.initialize({"model": "deepseek-chat"})
        return adapter

    # ── 消息构建 ──────────────────────────────────────────────

    def _build_messages(self, context: AgentContext, user_message: str) -> list[dict]:
        messages = []
        for msg in context.conversation_history:
            role = msg.get("role", "user")
            if role == "agent":
                role = "assistant"
            messages.append({"role": role, "content": msg.get("content", "")})
        messages.append({"role": "user", "content": user_message})
        return messages

    # ── 方法实现 ──────────────────────────────────────────────

    async def send_message(self, context: AgentContext, message: str) -> AgentResponse:
        if self._fallback_to_deepseek:
            fb = await self._get_fallback()
            return await fb.send_message(context, message)

        system_prompt = context.config.get("system_prompt", "")
        messages = self._build_messages(context, message)

        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                resp = await self._client.messages.create(
                    model=self._model,
                    max_tokens=4096,
                    system=system_prompt if system_prompt else None,
                    messages=messages,
                )
                content = ""
                for block in resp.content:
                    if hasattr(block, "text"):
                        content += block.text
                return AgentResponse(content=content)

            except Exception as e:
                logger.warning("Anthropic send_message 第 %d 次尝试失败: %s", attempt + 1, e)
                if attempt < len(RETRY_DELAYS) - 1 and self._is_retryable(e):
                    import asyncio
                    await asyncio.sleep(delay)
                else:
                    raise

        return AgentResponse(content="[错误：所有重试均已失败]")

    async def stream_message(self, context: AgentContext, message: str) -> AsyncIterator[str]:
        if self._fallback_to_deepseek:
            fb = await self._get_fallback()
            async for token in fb.stream_message(context, message):
                yield token
            return

        system_prompt = context.config.get("system_prompt", "")
        messages = self._build_messages(context, message)

        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                async with self._client.messages.stream(
                    model=self._model,
                    max_tokens=4096,
                    system=system_prompt if system_prompt else None,
                    messages=messages,
                ) as stream:
                    async for event in stream:
                        if event.type == "text":
                            yield event.text
                return

            except Exception as e:
                logger.warning("Anthropic stream_message 第 %d 次尝试失败: %s", attempt + 1, e)
                if attempt < len(RETRY_DELAYS) - 1 and self._is_retryable(e):
                    import asyncio
                    await asyncio.sleep(delay)
                else:
                    raise

    async def execute_task(self, context: AgentContext, task: dict) -> AgentResponse:
        if self._fallback_to_deepseek:
            fb = await self._get_fallback()
            return await fb.execute_task(context, task)

        task_title = task.get("title", "")
        task_desc = task.get("description", "")
        task_prompt = (
            f"当前任务：{task_title}\n任务描述：{task_desc}\n\n"
            "请完成上述任务。输出完整可用的代码，标注文件路径。"
        )

        system_prompt = context.config.get("system_prompt", "")
        full_system = f"{system_prompt}\n\n{task_prompt}" if system_prompt else task_prompt

        messages = self._build_messages(context, task_prompt)

        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                resp = await self._client.messages.create(
                    model=self._model,
                    max_tokens=8192,
                    system=full_system,
                    messages=messages[-20:],
                )
                content = ""
                for block in resp.content:
                    if hasattr(block, "text"):
                        content += block.text
                return AgentResponse(content=content)

            except Exception as e:
                logger.warning("Anthropic execute_task 第 %d 次尝试失败: %s", attempt + 1, e)
                if attempt < len(RETRY_DELAYS) - 1 and self._is_retryable(e):
                    import asyncio
                    await asyncio.sleep(delay)
                else:
                    raise

        return AgentResponse(content="[错误：任务执行失败]")

    async def review_result(
        self, context: AgentContext, original_task: dict, result: str
    ) -> AgentResponse:
        if self._fallback_to_deepseek:
            fb = await self._get_fallback()
            return await fb.review_result(context, original_task, result)

        review_prompt = (
            f"审查以下任务输出：\n\n"
            f"任务：{original_task.get('title', '')}\n描述：{original_task.get('description', '')}\n\n"
            f"代码/输出：\n{result[:4000]}\n\n"
            "请以 JSON 格式给出评审结论："
            '{"passed": true/false, "feedback": "...", "suggested_changes": "..."}'
        )

        system_prompt = context.config.get("system_prompt", "")

        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                resp = await self._client.messages.create(
                    model=self._model,
                    max_tokens=2048,
                    system=system_prompt if system_prompt else None,
                    messages=[{"role": "user", "content": review_prompt}],
                )
                content = ""
                for block in resp.content:
                    if hasattr(block, "text"):
                        content += block.text
                return AgentResponse(content=content)

            except Exception as e:
                logger.warning("Anthropic review_result 第 %d 次尝试失败: %s", attempt + 1, e)
                if attempt < len(RETRY_DELAYS) - 1 and self._is_retryable(e):
                    import asyncio
                    await asyncio.sleep(delay)
                else:
                    raise

        return AgentResponse(content='{"passed": false, "feedback": "审查失败", "suggested_changes": ""}')

    async def get_capabilities(self) -> dict:
        return {
            "adapter_type": "anthropic",
            "model": self._model,
            "supports_streaming": True,
            "fallback_to_deepseek": self._fallback_to_deepseek,
        }

    def _is_retryable(self, error: Exception) -> bool:
        status = getattr(error, "status_code", None) or getattr(error, "status", None)
        if status and status in (429, 503, 529):
            return True
        msg = str(error).lower()
        return any(kw in msg for kw in ("timeout", "connection", "rate", "overloaded"))
