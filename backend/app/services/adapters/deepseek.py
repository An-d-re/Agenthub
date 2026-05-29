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

    # ── 任务执行（Coder 角色，含工具调用循环）─────────────────

    MAX_TOOL_ITERATIONS = 10

    async def execute_task(self, context: AgentContext, task: dict) -> AgentResponse:
        """执行任务 —— ReAct 循环：LLM 决策 → 工具调用 → 沙箱执行 → 结果回传。"""
        import json
        from app.core.sandbox.tools import get_tools_schema
        from app.core.sandbox.manager import SandboxManager

        # 构建 OpenAI function calling 格式的工具列表
        raw_tools = get_tools_schema()
        tools = [{"type": "function", "function": t} for t in raw_tools]

        # 创建沙箱管理器
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

        # 构建消息：system + history + task
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        for msg in context.conversation_history:
            role = msg.get("role", "user")
            if role == "agent":
                role = "assistant"
            messages.append({"role": role, "content": msg.get("content", "")})

        messages.append({"role": "user", "content": task_prompt})

        all_artifacts: list[dict] = []
        all_tool_calls: list[dict] = []
        final_content = ""

        # ── ReAct 工具调用循环 ──────────────────────────────
        for iteration in range(self.MAX_TOOL_ITERATIONS):
            resp = await self._call_with_retry(messages, tools)
            if resp is None:
                return AgentResponse(content="[错误：任务执行失败]")

            choice = resp.choices[0]
            msg = choice.message

            # 无工具调用 → 任务完成
            if not msg.tool_calls:
                final_content = msg.content or ""
                break

            # 追加 assistant 消息（含 tool_calls）
            tc_dicts = []
            for tc in msg.tool_calls:
                tc_dicts.append({
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                })
            messages.append({
                "role": "assistant",
                "content": msg.content,
                "tool_calls": tc_dicts,
            })

            # 逐个执行工具
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                all_tool_calls.append({"name": tool_name, "arguments": tool_args})

                if sm:
                    result = await sm.execute_tool(tool_name, tool_args)
                else:
                    result = {"ok": False, "error": "沙箱不可用"}

                # 追踪 write_file 产出的文件
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

                # 工具结果回传
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, ensure_ascii=False),
                })

            logger.info(
                "execute_task 迭代 %d/%d: %d 个工具调用",
                iteration + 1, self.MAX_TOOL_ITERATIONS, len(msg.tool_calls),
            )

        # 超过最大迭代次数 → 要求最终总结
        if not final_content:
            messages.append({
                "role": "user",
                "content": "已达到最大工具调用次数。请基于上述执行结果给出最终总结。",
            })
            resp = await self._call_with_retry(messages, None)
            if resp:
                final_content = resp.choices[0].message.content or ""

        return AgentResponse(
            content=final_content,
            artifacts=all_artifacts,
            tool_calls=all_tool_calls,
        )

    async def _call_with_retry(self, messages: list[dict], tools: list[dict] | None):
        """带重试的 API 调用。"""
        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                kwargs = {
                    "model": self._model,
                    "messages": messages,
                    "temperature": 0.5,
                    "max_tokens": 8192,
                }
                if tools:
                    kwargs["tools"] = tools
                    kwargs["tool_choice"] = "auto"
                return await self._client.chat.completions.create(**kwargs)
            except Exception as e:
                logger.warning("DeepSeek execute_task 第 %d 次尝试失败: %s", attempt + 1, e)
                if self._is_retryable(e) and attempt < len(RETRY_DELAYS) - 1:
                    import asyncio
                    await asyncio.sleep(delay)
                else:
                    raise
        return None

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

    async def stop(self) -> None:
        if self._client:
            try:
                await self._client.close()
            except Exception:
                pass
            self._client = None

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
