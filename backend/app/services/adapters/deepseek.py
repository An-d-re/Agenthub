"""DeepSeek 适配器 —— 通过 OpenAI 兼容 HTTP API 调用。

支持流式和非流式两种模式，内置指数退避重试（1s/2s/4s，最多 3 次）。
"""

import logging
from typing import AsyncIterator

import httpx
from openai import AsyncOpenAI

from app.core.config import settings
from app.services.adapters.base import AgentContext, AgentResponse, BaseAdapter

logger = logging.getLogger(__name__)

RETRY_DELAYS = [1, 2, 4]  # 重试间隔（秒）


class DeepSeekAdapter(BaseAdapter):
    adapter_type = "deepseek"

    def __init__(self):
        self._client: AsyncOpenAI | None = None
        self._model: str = "deepseek-chat"

    async def initialize(self, config: dict) -> None:
        api_key = config.get("api_key") or settings.deepseek_api_key
        base_url = config.get("base_url") or settings.deepseek_base_url
        self._model = config.get("model") or "deepseek-chat"
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, http_client=httpx.AsyncClient(trust_env=False))

    # ── 消息构建 ──────────────────────────────────────────────

    def _build_messages(
        self, context: AgentContext, user_message: str, system_override: str | None = None
    ) -> list[dict]:
        """将 AgentContext 转换为 OpenAI messages 格式。"""
        messages = []

        # 系统提示词
        system_prompt = system_override or context.config.get("system_prompt", "")
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        # 对话历史
        for msg in context.conversation_history:
            role = msg.get("role", "user")
            if role == "agent":
                role = "assistant"
            messages.append({"role": role, "content": msg.get("content", "")})

        # 当前消息
        messages.append({"role": "user", "content": user_message})

        return messages

    # ── 非流式调用（Critic / Planner）─────────────────────────

    async def send_message(self, context: AgentContext, message: str) -> AgentResponse:
        messages = self._build_messages(context, message)

        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                resp = await self._client.chat.completions.create(
                    model=self._model,
                    messages=messages,
                    temperature=0.7,
                    max_tokens=4096,
                )
                return AgentResponse(content=resp.choices[0].message.content or "")

            except Exception as e:
                logger.warning("DeepSeek send_message 第 %d 次尝试失败: %s", attempt + 1, e)
                if self._is_retryable(e):
                    if attempt < len(RETRY_DELAYS) - 1:
                        import asyncio
                        await asyncio.sleep(delay)
                else:
                    raise

        return AgentResponse(content="[错误：所有重试均已失败]")

    # ── 流式调用（单聊 Agent Runner）──────────────────────────

    async def stream_message(self, context: AgentContext, message: str) -> AsyncIterator[str]:
        messages = self._build_messages(context, message)

        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                stream = await self._client.chat.completions.create(
                    model=self._model,
                    messages=messages,
                    temperature=0.7,
                    max_tokens=4096,
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta and delta.content:
                        yield delta.content
                return  # 成功，退出重试循环

            except Exception as e:
                logger.warning("DeepSeek stream_message 第 %d 次尝试失败: %s", attempt + 1, e)
                if self._is_retryable(e):
                    if attempt < len(RETRY_DELAYS) - 1:
                        import asyncio
                        await asyncio.sleep(delay)
                else:
                    raise

    # ── 任务执行（Coder 角色）──────────────────────────────────

    async def execute_task(self, context: AgentContext, task: dict) -> AgentResponse:
        """执行任务 —— 将任务信息作为 system prompt 的一部分注入。"""
        task_title = task.get("title", "")
        task_desc = task.get("description", "")

        task_context = (
            f"当前任务：{task_title}\n任务描述：{task_desc}\n\n"
            "请完成上述任务。输出完整可用的代码，标注文件路径。"
        )

        system_prompt = context.config.get("system_prompt", "")
        full_system = f"{system_prompt}\n\n{task_context}" if system_prompt else task_context

        # 加入对话历史
        history_msgs = []
        for msg in context.conversation_history:
            role = msg.get("role", "user")
            if role == "agent":
                role = "assistant"
            history_msgs.append({"role": role, "content": msg.get("content", "")})

        # 重建：system + history + task
        final_messages = []
        if full_system:
            final_messages.append({"role": "system", "content": full_system})
        final_messages.extend(history_msgs[-20:])  # 最近 20 条
        final_messages.append({"role": "user", "content": task_context})

        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                resp = await self._client.chat.completions.create(
                    model=self._model,
                    messages=final_messages,
                    temperature=0.5,
                    max_tokens=8192,
                )
                return AgentResponse(content=resp.choices[0].message.content or "")

            except Exception as e:
                logger.warning("DeepSeek execute_task 第 %d 次尝试失败: %s", attempt + 1, e)
                if self._is_retryable(e):
                    if attempt < len(RETRY_DELAYS) - 1:
                        import asyncio
                        await asyncio.sleep(delay)
                else:
                    raise

        return AgentResponse(content="[错误：任务执行失败]")

    # ── 代码审查（Reviewer 角色）───────────────────────────────

    async def review_result(
        self, context: AgentContext, original_task: dict, result: str
    ) -> AgentResponse:
        review_prompt = (
            f"审查以下任务输出：\n\n"
            f"任务：{original_task.get('title', '')}\n描述：{original_task.get('description', '')}\n\n"
            f"代码/输出：\n{result[:4000]}\n\n"
            "请以 JSON 格式给出评审结论："
            '{"passed": true/false, "feedback": "...", "suggested_changes": "..."}'
        )

        system_prompt = context.config.get("system_prompt", "")
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": review_prompt})

        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                resp = await self._client.chat.completions.create(
                    model=self._model,
                    messages=messages,
                    temperature=0.3,
                    max_tokens=2048,
                )
                return AgentResponse(content=resp.choices[0].message.content or "")

            except Exception as e:
                logger.warning("DeepSeek review_result 第 %d 次尝试失败: %s", attempt + 1, e)
                if self._is_retryable(e):
                    if attempt < len(RETRY_DELAYS) - 1:
                        import asyncio
                        await asyncio.sleep(delay)
                else:
                    raise

        return AgentResponse(content='{"passed": false, "feedback": "审查失败", "suggested_changes": ""}')

    async def get_capabilities(self) -> dict:
        return {
            "adapter_type": "deepseek",
            "model": self._model,
            "supports_streaming": True,
            "retry_count": len(RETRY_DELAYS),
        }

    def _is_retryable(self, error: Exception) -> bool:
        """判断异常是否可重试（429 限流 / 503 服务不可用 / 网络错误）。"""
        status = getattr(error, "status_code", None) or getattr(error, "status", None)
        if status and status in (429, 503):
            return True
        msg = str(error).lower()
        if any(kw in msg for kw in ("timeout", "connection", "rate limit", "server error")):
            return True
        return False
