# AgentHub 开发问题与解决方案记录

本文档记录了 AgentHub 项目开发过程中遇到的主要问题及其解决方案，按模块和严重程度分类。

---

## 后端

### 致命 / 高危

#### 1. Orchestrator 并发竞态 — 同一 Session 多次 `asyncio.create_task()`

**问题**：WebSocket 路由对每条群聊消息调用 `asyncio.create_task(Orchestrator(session_id).handle_message(content))`，同一 Session 的并发消息会导致两个协程同时读写数据库，可能产生重复 Task 记录或状态不一致。

**解决**：在 Orchestrator 类上引入 `_locks: dict[str, asyncio.Lock]` 类变量，`handle_message()` 先获取对应 session 的锁再执行，保证同一 Session 串行处理。

**文件**：`backend/app/core/orchestrator.py`

```python
_locks: dict[str, asyncio.Lock] = {}

async def handle_message(self, user_message: str) -> None:
    lock = Orchestrator._locks.setdefault(self.session_id, asyncio.Lock())
    async with lock:
        await self._handle_message_locked(user_message)
```

---

#### 2. EventBus 与数据库事务不一致 — 事件先于 `db.commit()` 发布

**问题**：Orchestrator 在数据库事务 `db.commit()` 之前直接调用 `event_bus.publish()`。若后续提交失败（事务回滚），前端已收到包含新记录 ID 的事件，但这些 ID 在数据库中不存在，导致前端出现"幽灵数据"。

**解决**：引入 `_pending_events: list[dict]` 收集模式。阶段处理期间所有事件先写入 `_pending_events` 列表，`db.commit()` 成功后才调用 `_flush_pending_events()` 批量发布。

**文件**：`backend/app/core/orchestrator.py`

```python
self._pending_events.append({"type": "chat.message", "payload": {...}})
# ...
await db.commit()
await self._flush_pending_events()
```

---

#### 3. Adapter HTTP 连接泄漏 — `adapter.stop()` 从未调用

**问题**：Orchestrator 每次执行任务都通过 `_get_agent_adapter()` 创建新的 Adapter 实例（含 `httpx.AsyncClient`），但任务执行完毕后从未调用 `adapter.stop()` 关闭底层 HTTP 连接池，导致连接泄漏。

**解决**：在 `_execute_single_task` 中使用 `try/finally`，无论任务成功、失败还是异常，`finally` 块中都会调用 `adapter.stop()`。

**文件**：`backend/app/core/orchestrator.py`

---

#### 4. Adaptor 重试逻辑缺陷 — 最后一次重试吞掉错误

**问题**：三个 Adapter（DeepSeek、Anthropic、OpenCode）的重试条件为 `if attempt < len(RETRY_DELAYS) - 1 and self._is_retryable(e)`，当最后一次尝试遇到可重试错误时，条件为假，直接跳过 retry 但继续执行到循环后的 `return AgentResponse(...)`，返回虚假的成功响应而不是上报真实错误。

**解决**：重构条件结构——先判断是否可重试，再判断是否还有重试次数，不可重试或已达上限则返回错误响应。

```python
if self._is_retryable(e):
    if attempt < len(RETRY_DELAYS) - 1:
        # 等待后重试
        continue
return AgentResponse(content="", error=str(e))
```

**文件**：`backend/app/services/adapters/deepseek.py`、`anthropic.py`

---

#### 5. JSON 提取正则在嵌套对象时失败

**问题**：`_extract_json()` 使用正则 `r'\{.*?\}'`（非贪婪匹配），在嵌套 JSON（如 `{"tasks": [{"id": 1}, {"id": 2}]}`）中会匹配到第一个 `}` 就停止，解析失败。

**解决**：用逐字符括号深度追踪替代正则。遇到 `{` 深度 +1，遇到 `}` 深度 -1，深度归零时截取完整 JSON 字符串。

**文件**：`backend/app/core/orchestrator.py`

```python
def _extract_json(self, text: str) -> Optional[dict]:
    cleaned = re.sub(r'```(?:json)?\s*|\s*```', '', text)
    start = cleaned.find('{')
    if start >= 0:
        depth = 0
        for i in range(start, len(cleaned)):
            if cleaned[i] == '{': depth += 1
            elif cleaned[i] == '}':
                depth -= 1
                if depth == 0:
                    return json.loads(cleaned[start:i+1])
    return None
```

---

#### 6. WebSocket 心跳完全失效 — `_wait_pong` 为空函数

**问题**：`connection_manager.py` 中 `_wait_pong` 定义为 `async def _wait_pong(self, client_id: str): pass`，函数体为空直接返回，心跳检测形同虚设——即使客户端已断开，服务端也无法感知。

**解决**：用 `asyncio.Event` 重写心跳循环。发送 ping 后创建 Event 并 `wait_for(timeout=30s)`，`handle_pong()` 设置 Event，超时则断开连接。

**文件**：`backend/app/ws/connection_manager.py`

```python
async def _heartbeat_loop(self, client_id: str):
    while client_id in self._connections:
        await ws.send_text(json.dumps({"type": "ping"}))
        pong_event = asyncio.Event()
        self._pong_events[client_id] = pong_event
        try:
            await asyncio.wait_for(pong_event.wait(), timeout=self.HEARTBEAT_TIMEOUT)
        except asyncio.TimeoutError:
            self.disconnect(client_id)
            return
```

---

#### 7. SQLite 消息日志泄漏敏感信息

**问题**：SQLAlchemy `echo=True` 会将所有 SQL 语句打印到控制台，可能泄漏消息内容等敏感数据。

**解决**：改为 `echo=False`。

**文件**：`backend/app/core/database.py`

---

#### 8. OpenCode Adapter 未禁用环境代理

**问题**：`OpenCodeAdapter` 继承 `DeepSeekAdapter`，父类构造中 `httpx.AsyncClient` 默认 `trust_env=True`，会读取系统 `HTTP_PROXY` 环境变量，在配置了代理的开发者机器上导致请求走代理而失败。

**解决**：OpenCodeAdapter 在 `__init__` 中传入 `http_client=httpx.AsyncClient(trust_env=False)`。

**文件**：`backend/app/services/adapters/opencode.py`

---

#### 9. 中间件压缩结果被丢弃

**问题**：`_execute_single_task` 在中间件链处理后重新从数据库查询 `conversation_history`，丢弃了中间件的压缩/摘要结果。

**解决**：改用 `mw_ctx.conversation_history`（中间件处理后的版本）传递给 Adapter。

**文件**：`backend/app/core/orchestrator.py`

---

#### 10. Plan 表缺少唯一约束 — 同一 Session 出现多个活跃 Plan

**问题**：`Plan` 表没有 `UNIQUE(session_id, status)` 约束，当锁机制失效或直接操作数据库时，可能插入多条 `status="active"` 的记录，导致状态机路由混乱。

**解决**：在 Plan 模型上添加 `UniqueConstraint("session_id", "status")` 或应用层守卫查询。

**文件**：`backend/app/models/`（Plan 模型）

---

### 中危

#### 11. agent_runner 打开 3 个独立数据库会话

**问题**：`agent_runner.py` 在同一个请求中先后三次调用 `SessionLocal()` 创建独立会话——一次查 Agent，一次查 Session，一次写 Message——浪费连接且可能看到不一致的快照。

**解决**：合并为单个数据库会话，一次查询所需数据，一次写入。

**文件**：`backend/app/services/agent_runner.py`

---

#### 12. 重试次数默认值不一致

**问题**：Task 模型 `max_retries` 默认值为 3，但 Orchestrator 中 `MAX_TASK_RETRIES = 1`，导致业务语义混乱。

**解决**：将模型默认值改为 1，与 Orchestrator 常量保持一致。

**文件**：`backend/app/models/` + `backend/app/core/orchestrator.py`

---

#### 13. `_trigger_agent` 静默吞异常

**问题**：`ws_routes.py` 中 `_trigger_agent` 的 `except Exception: pass` 静默丢弃所有异常，单聊模式下用户发送消息后得不到任何反馈。

**解决**：添加 `logger.exception()` 记录异常，并通过 EventBus 向用户发送错误提示消息。

**文件**：`backend/app/ws/ws_routes.py`

---

#### 14. 中间件状态泄漏 — Session 结束后未清理

**问题**：`LoopDetector` 和 `SubagentLimiter` 持有 per-session 计数器/状态，Session 完成后未调用 `reset_session()`，内存持续增长。

**解决**：在 Orchestrator 的 phase=done 时调用 `self.middleware.reset_session(session_id)`。

**文件**：`backend/app/core/orchestrator.py` + `backend/app/core/middleware.py`

---

#### 15. Agent Runner 使用错误的枚举值

**问题**：`agent_runner.py` 中 `agent_role="planner"` 传的是字符串字面量而非 `AgentRole.PLANNER` 枚举，导致下游比较可能失败。

**解决**：改为 `from app.services.adapters.base import AgentContext, AgentRole` 并使用 `agent_role=AgentRole.PLANNER`。

**文件**：`backend/app/services/agent_runner.py`

---

### 低危

#### 16. Sessions API 返回迭代器而非列表

**问题**：`return reversed(result.scalars().all())` 返回的是迭代器而非列表，FastAPI 序列化时可能失败。

**解决**：改为 `return list(reversed(result.scalars().all()))`。

**文件**：`backend/app/api/sessions.py`

---

#### 17. `.env` 文件被 Git 追踪

**问题**：`backend/.env` 包含真实 API Key 被提交到仓库。

**解决**：`git rm --cached backend/.env` 从 Git 中移除，确认 `.gitignore` 已包含 `.env`。

**文件**：`backend/.env`、`.gitignore`

---

#### 18. Critic 阶段关键词误触发

**问题**：Critic 阶段的"澄清完成"判断关键词包含 "proceed"、"moving on"、"我的假设"、"assumptions"——这些词在正常对话中很容易出现，导致过早退出澄清阶段。

**解决**：移除这些模糊关键词，仅保留明确的确认语义短语。

**文件**：`backend/app/core/orchestrator.py`

---

#### 19. Done 阶段后无法开始新任务

**问题**：当 Plan 处于 done 阶段时，用户发送新的合理需求（如"再帮我加个功能"），Orchestrator 直接返回"当前会话已完成"而不启动新的工作流。

**解决**：Done 阶段检测用户消息长度 > 5 且非简单确认语时，重置 Plan 为 clarify 阶段重新开始。

**文件**：`backend/app/core/orchestrator.py`

---

#### 20. Clarify → Comparison 过渡传错消息

**问题**：进入 comparison 阶段时传入了原始 `user_message`，如果消息内容恰好包含方案名称关键词，会错误匹配到某个方案。

**解决**：明确传入空字符串 `""`，避免意外匹配。

**文件**：`backend/app/core/orchestrator.py`

---

#### 21. 文件路径安全 — `_guess_file_path` 未过滤路径遍历

**问题**：从 Agent 输出中猜测文件路径时未过滤 `../` 等路径遍历字符。

**解决**：对生成的路径做 `os.path.basename` 或过滤 `..` / 斜杠。

**文件**：`backend/app/core/orchestrator.py`

---

#### 22. Trace 构造参数覆盖默认值

**问题**：`tracer.py` 中创建 Trace 时显式传入 `start_time=None`、`end_time=None`，覆盖了模型的 `default=func.now()`。

**解决**：移除这些多余的关键字参数。

**文件**：`backend/app/core/tracer.py`

---

#### 23. 未使用的 REVIEWER_PROMPT_PREFIX 常量

**问题**：`prompts.py` 中定义了 `REVIEWER_PROMPT_PREFIX`，但 MVP 阶段跳过 Review，常量未使用。

**解决**：添加注释标记为后续使用，暂时保留。

**文件**：`backend/app/core/prompts.py`

---

## 前端

### 致命 / 高危

#### 24. Tailwind CSS 颜色令牌缺失 — 所有组件样式不生效

**问题**：`tailwind.config.ts` 只映射了 `background` 和 `foreground`，但所有 UI 组件使用了 `bg-muted`、`bg-card`、`text-primary`、`border-border`、`text-destructive` 等类，这些类生成的 CSS 为空，导致页面几乎无样式。

**解决**：在配置中补全所有 shadcn 颜色令牌映射（card、muted、primary、secondary、accent、destructive，各含 DEFAULT 和 foreground），加上 border、ring、input、popover。

**文件**：`frontend/tailwind.config.ts`

---

#### 25. `tailwindcss-animate` 插件缺失

**问题**：Radix UI 组件（Dialog、Tabs 等）依赖 `animate-in`、`fade-in-0` 等动画类，这些由 `tailwindcss-animate` 插件提供。插件未安装导致所有进出场动画失效。

**解决**：`npm install tailwindcss-animate` 并在 `tailwind.config.ts` 的 plugins 中注册。

**文件**：`frontend/tailwind.config.ts`

---

#### 26. WebSocket 重连竞态 — Session 切换时旧定时器覆盖新连接

**问题**：`useWebSocket` 在 `sessionId` 变化时执行 cleanup 关闭旧 WS 并清除重连定时器，但如果 cleanup 执行时旧 WS 的 `setTimeout(connect, delay)` 已创建但尚未执行，新 Session 连接建立后旧定时器仍然触发，用旧 `sessionId` 调用 `connect()` 创建错误的连接。

**解决**：在 cleanup 中清除 `reconnectTimerRef`，且在 `connect()` 内部创建新连接前检查当前 `sessionId` 是否仍然匹配（用 ref 追踪最新 sessionId）。

**文件**：`frontend/src/hooks/useWebSocket.ts`

---

#### 27. `sendMessage` 静默丢弃消息

**问题**：`sendMessage` 在 `ws.readyState !== WebSocket.OPEN` 时直接 `return`，没有任何提示，用户输入后消息凭空消失。

**解决**：返回 boolean 或抛出错误，调用方据此向用户展示"发送失败，正在重连..."提示。

**文件**：`frontend/src/hooks/useWebSocket.ts`

---

### 高危

#### 28. ESLint 错误阻止 `next build`

**问题**：`ChatPanel.tsx` 中 `delete (window as any).__agenthub_ws_send` 缺少 `eslint-disable-next-line`；`MessageList.tsx` 中 `messages.map((msg, i) =>` 的 `i` 变量未使用。

**解决**：分别添加 eslint 注释和移除未使用变量。

**文件**：`frontend/src/components/chat/ChatPanel.tsx`、`MessageList.tsx`

---

#### 29. PlanCard "props in state" 反模式

**问题**：`PlanCard` 用 `useState` 管理 `chosen`（选中的方案索引），但当父组件通过 `selected` prop 传入新值时，本地 state 不会更新，UI 展示僵死。

**解决**：添加 `useEffect` 在 `selected` prop 变化时同步 `setChosen`。

**文件**：`frontend/src/components/cards/PlanCard.tsx`

---

#### 30. 角色字段未归一化

**问题**：后端可能发送 `role: "assistant"`，但前端渲染逻辑只识别 `"agent"`，导致 Agent 消息以用户气泡样式展示。

**解决**：在 `useWebSocket` 的 `onmessage` 中做映射：`assistant → agent`。

**文件**：`frontend/src/hooks/useWebSocket.ts`

---

### 中危

#### 31. `EMPTY_OBJ` 导出但从未引用

**问题**：`constants.ts` 中 `export const EMPTY_OBJ` 没有任何文件导入使用。

**解决**：删除或在使用它的 store 中导入。

**文件**：`frontend/src/lib/constants.ts`

---

#### 32. Agent 列表中 `avatarUrl` 字段被忽略

**问题**：`AgentList.tsx` 从 API 获取 `avatarUrl` 并存入 store，但渲染时只用 `avatarEmoji(adapterType)` 映射 emoji，`avatarUrl` 从未使用。

**解决**：未来支持自定义头像时可启用，当前接受这个冗余。

**文件**：`frontend/src/components/contacts/AgentList.tsx`

---

#### 33. `isDeletable` 字段未使用

**问题**：Agent store 中定义了 `isDeletable` 字段，但 UI 中没有删除 Agent 的功能入口。

**解决**：保留字段供后续 UI 使用。

**文件**：`frontend/src/stores/agentStore.ts`

---

#### 34. DiffCard 加载失败时无用户提示

**问题**：点击 DiffCard 获取 artifact 内容时，若 API 请求失败，`catch` 块为空，用户只会看到空白的 Diff 对话框。

**解决**：添加错误状态展示或使用 `contentPreview` 作为降级内容。

**文件**：`frontend/src/components/cards/DiffCard.tsx`

---

### 低危

#### 35. Next.js `reactStrictMode: true` 可能导致开发环境双重渲染异常

**问题**：Strict Mode 下 React 会双重挂载组件，WebSocket 连接可能被创建两次、定时器可能被注册两次。

**解决**：在 `useEffect` cleanup 中正确清理所有副作用（WS 连接、定时器），确保 Strict Mode 下也能正常工作。

**文件**：`frontend/next.config.mjs`

---

#### 36. 方法在组件内部重复创建

**问题**：`AgentList.tsx` 中 `avatarEmoji` 函数定义在组件体内，每次渲染都会重新创建。

**解决**：移到组件外部作为模块级函数。

**文件**：`frontend/src/components/contacts/AgentList.tsx`

---

#### 37. Trace 面板未处理组件卸载后 setState

**问题**：`TracePanel` 的 `fetchTraces` 异步请求可能在组件卸载后仍然调用 `setSpans`，React 会警告 "Can't perform a state update on an unmounted component"。

**解决**：添加 `cancelled` 标志，cleanup 中设置 `cancelled = true`，请求返回前检查。

**文件**：`frontend/src/components/trace/TracePanel.tsx`

---

#### 38. React Key 使用不稳定索引

**问题**：`MessageList` 中消息列表的 `key` 可能回退到数组索引，当消息列表变化时导致不必要的 DOM 重建。

**解决**：优先使用 `msg.id`，回退到 `msg.createdAt`（比索引更稳定）。

**文件**：`frontend/src/components/chat/MessageList.tsx`

---

#### 39. Markdown 渲染不支持 GFM 扩展

**问题**：`MessageBubble` 中 `ReactMarkdown` 默认不启用 GFM（表格、删除线、任务列表），Agent 输出的 Markdown 表格无法正确渲染。

**解决**：安装 `remark-gfm` 并作为 `remarkPlugins` 传入。

**文件**：`frontend/src/components/chat/MessageBubble.tsx`

---

#### 40. 全局 WebSocket 发送函数放在 render 阶段

**问题**：`ChatPanel` 中 `window.__agenthub_ws_send = sendMessage` 写在组件函数体（render phase），每次渲染都执行，可能干扰 React 的并发特性。

**解决**：移到 `useEffect` 中，在 cleanup 中清理。

**文件**：`frontend/src/components/chat/ChatPanel.tsx`

---

#### 41. `useContacts` — `useEffect` 依赖 `fetchSessions` 但 deps 为空

**问题**：`fetchSessions` 用 `useCallback` 包裹但依赖数组为空，`useEffect` 依赖 `[fetchSessions]` 实际上等价于 `[]`，画蛇添足。

**解决**：直接用 `useEffect(() => { ... }, [])` 并加 `eslint-disable-next-line`。

**文件**：`frontend/src/hooks/useContacts.ts`

---

#### 42. 未做 `Array.isArray` 防护

**问题**：多处 API 响应的 `.json()` 结果直接当作数组使用，没有 `Array.isArray` 校验。

**解决**：在使用前添加类型守卫。

**文件**：`frontend/src/hooks/useContacts.ts`、`frontend/src/components/trace/TracePanel.tsx`

---

#### 43. API_BASE / WS_BASE 硬编码散落各处

**问题**：前端多个文件各自写死 `"http://localhost:8000"` 或从 `process.env` 直接读取，环境变量变更时需要修改多处。

**解决**：统一提取到 `lib/constants.ts` 中，所有组件从此文件导入。

**文件**：`frontend/src/lib/constants.ts`

---

#### 44. popover 颜色变量缺失

**问题**：shadcn 的 Select/Command 组件使用 `--popover` 和 `--popover-foreground` CSS 变量，但 `globals.css` 中未定义，弹出菜单显示为透明背景。

**解决**：在 `globals.css` 中补充 `--popover: #18181b` 和 `--popover-foreground: #fafafa`。

**文件**：`frontend/src/app/globals.css`

---

## 总结

| 严重程度 | 后端 | 前端 | 合计 |
|---------|------|------|------|
| 致命/高危 | 10   | 4    | 14   |
| 中危     | 5    | 4    | 9    |
| 低危     | 8    | 10   | 18   |
| **合计** | **23** | **18** | **41** |

### 核心教训

1. **异步事务模式**：异步 Python 中 `asyncio.create_task()` 不是免费的——需要锁来保护共享状态，事件发布要等事务提交成功后再执行。
2. **JSON 提取**：永远不要用正则解析嵌套 JSON，字符级深度追踪更可靠。
3. **心跳不能用空函数**：WebSocket 长连接的超时检测需要真正的超时机制，`asyncio.Event` + `wait_for` 是简单有效的方案。
4. **前端常量统一管理**：API 地址、WS 地址等环境相关配置集中到单一文件，避免散落各处。
5. **Tailwind shadcn 需要完整颜色映射**：使用 shadcn UI 组件时，`tailwind.config.ts` 必须包含所有语义化颜色令牌，否则样式静默失效。
6. **HTTP 客户端生命周期**：Adapter 的 `httpx.AsyncClient` 需要成对的 `start()/stop()` 调用，泄漏会耗尽连接池。
7. **错误不能静默吞掉**：至少记录日志，否则线上问题无法排查。
