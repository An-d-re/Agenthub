"""Anthropic Claude adapter via HTTP API."""

import asyncio
from typing import AsyncIterator

from anthropic import AsyncAnthropic

from app.core.config import settings
from app.services.adapters.base import AgentContext, AgentResponse, BaseAdapter

RETRY_DELAYS = [1, 2, 4]
MAX_RETRIES = 3


class AnthropicAdapter(BaseAdapter):
    adapter_type = "anthropic"

    def __init__(self):
        self.model = "claude-sonnet-4-20250514"
        self.max_tokens = 4096
        self.system_prompt = "You are Claude, a senior software engineer."

    async def initialize(self, config: dict) -> None:
        self.model = config.get("model", self.model)
        self.max_tokens = config.get("max_tokens", self.max_tokens)
        self.system_prompt = config.get("system_prompt", self.system_prompt)
        api_key = config.get("api_key", settings.anthropic_api_key)
        self.client = AsyncAnthropic(api_key=api_key)

    async def send_message(self, context: AgentContext, message: str) -> AgentResponse:
        system = context.config.get("system_prompt", self.system_prompt)
        messages = self._build_messages(context, message)
        response = await self._retry(lambda: self.client.messages.create(
            model=self.model, max_tokens=self.max_tokens,
            system=system, messages=messages,
        ))
        content = response.content[0].text if response.content else ""
        return AgentResponse(
            content=content,
            metadata={
                "model": response.model,
                "tokens_used": response.usage.input_tokens + response.usage.output_tokens if response.usage else 0,
                "stop_reason": response.stop_reason,
            },
        )

    async def stream_message(self, context: AgentContext, message: str) -> AsyncIterator[str]:
        system = context.config.get("system_prompt", self.system_prompt)
        messages = self._build_messages(context, message)
        async with self.client.messages.stream(
            model=self.model, max_tokens=self.max_tokens,
            system=system, messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def execute_task(self, context: AgentContext, task: dict) -> AgentResponse:
        task_prompt = self._build_task_prompt(task)
        return await self.send_message(context, task_prompt)

    async def review_result(
        self, context: AgentContext, original_task: dict, result: str
    ) -> AgentResponse:
        review_prompt = (
            f"Review this output for task '{original_task.get('title', '')}':\n{result}\n\n"
            "Check correctness, security, performance, readability. Output JSON: "
            '{"passed": true/false, "feedback": "...", "suggested_changes": "..."}'
        )
        review_ctx = AgentContext(
            session_id=context.session_id,
            agent_role=context.agent_role,
            config={"system_prompt": "You are a code reviewer."},
        )
        return await self.send_message(review_ctx, review_prompt)

    async def get_capabilities(self) -> dict:
        return {
            "adapter_type": "anthropic",
            "supports_streaming": True,
            "model": self.model,
        }

    # ── private ──────────────────────────────────────────────

    def _build_messages(self, context: AgentContext, user_message: str) -> list[dict]:
        msgs = []
        for h in context.conversation_history:
            role = h.get("role", "user")
            if role == "assistant":
                role = "assistant"
            elif role == "user":
                role = "user"
            else:
                continue
            msgs.append({"role": role, "content": h.get("content", "")})
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
