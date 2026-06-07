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
                if self._is_retryable(e):
                    if attempt < len(RETRY_DELAYS) - 1:
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
                if self._is_retryable(e):
                    if attempt < len(RETRY_DELAYS) - 1:
                        import asyncio
                        await asyncio.sleep(delay)
                else:
                    raise

    # ── 任务执行（Coder 角色，含工具调用循环）─────────────────

    MAX_TOOL_ITERATIONS = 10

    async def execute_task(self, context: AgentContext, task: dict) -> AgentResponse:
        if self._fallback_to_deepseek:
            fb = await self._get_fallback()
            return await fb.execute_task(context, task)

        import json
        from app.core.sandbox.tools import get_tools_schema
        from app.core.sandbox.manager import SandboxManager

        # 转换工具 schema：OpenAI "parameters" → Anthropic "input_schema"
        raw_tools = get_tools_schema()
        tools = [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["parameters"],
            }
            for t in raw_tools
        ]

        sm: SandboxManager | None = None
        workspace_dir = context.workspace_dir
        if workspace_dir:
            sm = SandboxManager(context.session_id)

        task_title = task.get("title", "")
        task_desc = task.get("description", "")
        task_prompt = (
            f"当前任务：{task_title}\n任务描述：{task_desc}\n\n"
            "请完成上述任务。使用工具写代码、运行测试，验证通过后给出最终总结。"
        )

        system_prompt = context.config.get("system_prompt", "")
        from app.core.prompts import CODER_TASK_PROMPT

        # 构建 Anthropic 消息（不含 system，alternating user/assistant）
        full_system = CODER_TASK_PROMPT
        if system_prompt:
            full_system += f"\n\nAdditional instructions: {system_prompt}"

        messages = []
        for msg in context.conversation_history:
            role = msg.get("role", "user")
            if role in ("agent", "system"):
                role = "assistant" if role == "agent" else "user"
            messages.append({"role": role, "content": msg.get("content", "")})
        messages.append({"role": "user", "content": task_prompt})

        all_artifacts: list[dict] = []
        all_tool_calls: list[dict] = []
        final_content = ""

        # ── ReAct 工具调用循环 ──────────────────────────────
        for iteration in range(self.MAX_TOOL_ITERATIONS):
            resp = await self._call_anthropic_with_retry(
                full_system, messages, tools,
            )
            if resp is None:
                return AgentResponse(content="[错误：任务执行失败]")

            # 分析响应中的 content blocks
            text_blocks = []
            tool_use_blocks = []
            for block in resp.content:
                if block.type == "text":
                    text_blocks.append(block.text)
                elif block.type == "tool_use":
                    tool_use_blocks.append(block)

            # 无工具调用 → 完成
            if not tool_use_blocks:
                final_content = "\n".join(text_blocks)
                break

            # 追加 assistant 消息（保持 content blocks 结构）
            assistant_content = []
            for block in resp.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })
            messages.append({"role": "assistant", "content": assistant_content})

            # 执行工具并构建 tool_result
            tool_results = []
            for tb in tool_use_blocks:
                tool_name = tb.name
                tool_args = tb.input if isinstance(tb.input, dict) else {}

                all_tool_calls.append({"name": tool_name, "arguments": tool_args})

                if sm:
                    result = await sm.execute_tool(tool_name, tool_args)
                else:
                    result = {"ok": False, "error": "沙箱不可用"}

                if tool_name == "write_file" and result.get("ok"):
                    path = tool_args.get("path", "")
                    ext = path.rsplit(".", 1)[-1] if "." in path else ""
                    lang_map = {
                        "py": "python", "js": "javascript", "ts": "typescript",
                        "html": "html", "css": "css", "json": "json", "md": "markdown",
                    }
                    all_artifacts.append({
                        "file_path": path,
                        "language": lang_map.get(ext, ext),
                        "content": tool_args.get("content", ""),
                    })

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tb.id,
                    "content": json.dumps(result, ensure_ascii=False),
                })

            messages.append({"role": "user", "content": tool_results})

            logger.info(
                "Anthropic execute_task 迭代 %d/%d: %d 个工具调用",
                iteration + 1, self.MAX_TOOL_ITERATIONS, len(tool_use_blocks),
            )

        # 超过最大迭代次数 → 要求最终总结
        if not final_content:
            messages.append({
                "role": "user",
                "content": "已达到最大工具调用次数。请基于上述执行结果给出最终总结。",
            })
            resp = await self._call_anthropic_with_retry(full_system, messages, None)
            if resp:
                for block in resp.content:
                    if block.type == "text":
                        final_content += block.text

        return AgentResponse(
            content=final_content,
            artifacts=all_artifacts,
            tool_calls=all_tool_calls,
        )

    async def _call_anthropic_with_retry(
        self, system_prompt: str, messages: list[dict], tools: list[dict] | None,
    ):
        """带重试的 Anthropic API 调用。"""
        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                kwargs = {
                    "model": self._model,
                    "max_tokens": 8192,
                    "messages": messages,
                }
                if system_prompt:
                    kwargs["system"] = system_prompt
                if tools:
                    kwargs["tools"] = tools
                return await self._client.messages.create(**kwargs)
            except Exception as e:
                logger.warning("Anthropic execute_task 第 %d 次尝试失败: %s", attempt + 1, e)
                if self._is_retryable(e) and attempt < len(RETRY_DELAYS) - 1:
                    import asyncio
                    await asyncio.sleep(delay)
                else:
                    raise
        return None

    async def stop(self) -> None:
        if self._client:
            try:
                await self._client.close()
            except Exception:
                pass
            self._client = None

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
