"""DeepSeek adapter via OpenAI-compatible HTTP API."""

import asyncio
from typing import AsyncIterator

from openai import AsyncOpenAI

from app.core.config import settings
from app.services.adapters.base import AgentContext, AgentResponse, BaseAdapter

RETRY_DELAYS = [1, 2, 4]  # seconds
MAX_RETRIES = 3


class DeepSeekAdapter(BaseAdapter):
    adapter_type = "deepseek"

    def __init__(self):
        self.model = "deepseek-chat"
        self.temperature = 0.7
        self.max_tokens = 4096
        self.system_prompt = "You are a helpful AI assistant."

    async def initialize(self, config: dict) -> None:
        self.model = config.get("model", self.model)
        self.temperature = config.get("temperature", self.temperature)
        self.max_tokens = config.get("max_tokens", self.max_tokens)
        self.system_prompt = config.get("system_prompt", self.system_prompt)
        api_key = config.get("api_key", settings.deepseek_api_key)
        self.client = AsyncOpenAI(api_key=api_key, base_url=settings.deepseek_base_url)

    async def send_message(self, context: AgentContext, message: str) -> AgentResponse:
        messages = self._build_messages(context, message)
        response = await self._retry(lambda: self.client.chat.completions.create(
            model=self.model, messages=messages, temperature=self.temperature,
            max_tokens=self.max_tokens,
        ))
        choice = response.choices[0]
        return AgentResponse(
            content=choice.message.content or "",
            metadata={
                "model": response.model,
                "tokens_used": response.usage.total_tokens if response.usage else 0,
                "finish_reason": choice.finish_reason,
            },
        )

    async def stream_message(self, context: AgentContext, message: str) -> AsyncIterator[str]:
        messages = self._build_messages(context, message)
        response = await self._retry(lambda: self.client.chat.completions.create(
            model=self.model, messages=messages, temperature=self.temperature,
            max_tokens=self.max_tokens, stream=True,
        ))
        async for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield delta.content

    async def execute_task(self, context: AgentContext, task: dict) -> AgentResponse:
        task_prompt = self._build_task_prompt(task)
        return await self.send_message(context, task_prompt)

    async def review_result(
        self, context: AgentContext, original_task: dict, result: str
    ) -> AgentResponse:
        review_prompt = (
            f"You are a code reviewer. Review the following output for task: {original_task.get('title', '')}\n\n"
            f"Task description: {original_task.get('description', '')}\n\n"
            f"Output to review:\n{result}\n\n"
            "Check for: correctness, security, performance, readability.\n"
            "Output JSON: {\"passed\": true/false, \"feedback\": \"...\", \"suggested_changes\": \"...\"}"
        )
        review_ctx = AgentContext(
            session_id=context.session_id,
            agent_role=context.agent_role,
            config={"system_prompt": "You are a code reviewer. Output JSON only."},
        )
        return await self.send_message(review_ctx, review_prompt)

    async def get_capabilities(self) -> dict:
        return {
            "adapter_type": "deepseek",
            "supports_streaming": True,
            "supports_tools": True,
            "model": self.model,
        }

    # ── private ──────────────────────────────────────────────

    def _build_messages(self, context: AgentContext, user_message: str) -> list[dict]:
        msgs = [{"role": "system", "content": context.config.get("system_prompt", self.system_prompt)}]
        for h in context.conversation_history:
            role = h.get("role", "user")
            content = h.get("content", "")
            if role in ("user", "assistant", "system"):
                msgs.append({"role": role, "content": content})
        msgs.append({"role": "user", "content": user_message})
        return msgs

    def _build_task_prompt(self, task: dict) -> str:
        parts = [f"Task: {task.get('title', '')}"]
        if task.get("description"):
            parts.append(f"Description: {task['description']}")
        parts.append("Complete this task and output the result.")
        return "\n".join(parts)

    async def _retry(self, fn, retries: int = MAX_RETRIES):
        last_exc = None
        for attempt in range(retries + 1):
            try:
                return await fn()
            except Exception as e:
                last_exc = e
                if attempt < retries:
                    await asyncio.sleep(RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)])
        raise last_exc
