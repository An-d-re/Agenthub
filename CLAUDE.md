# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AgentHub 是 IM 聊天式的多 Agent 协作平台（字节跳动 AI 全栈开发挑战赛）。核心理念：**Agent 即联系人**，**会话依赖 Agent**，**群聊是独立实体**。左侧栏三标签（助手/群聊/话题），点 Agent 直接进入对话（不再跳 tab）。群聊中 Orchestrator 可见地主持多 Agent 协作。四阶段交互：需求澄清 → 方案对比 → 计划确认 → 迭代执行。右侧「协作剧场」可视化 Agent 协作过程。

## 常用命令

```bash
# 后端（Windows Git Bash 中 glob 可能被展开，去掉 reload-exclude 或改用单引号）
cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 前端
cd frontend && npm run dev

# Docker
docker-compose up --build
```

`backend/.env` 配置 API keys（DeepSeek 必填，其余按需）。
构建：`cd frontend && npx next build`
后端验证：`python -c "from app.core.orchestrator import Orchestrator; print('OK')"`

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Next.js 14 + Tailwind + Shadcn UI + Zustand + Monaco Editor + framer-motion |
| 后端 | FastAPI + SQLite (aiosqlite) + SQLAlchemy async |
| 实时通信 | FastAPI 原生 WebSocket（心跳 30s ping/pong，断线重连指数退避 1s/2s/4s/8s/16s/30s） |
| 内部事件 | `asyncio.Queue`（全局单例 `EventBus`，per-session 隔离） |
| 主力模型 | DeepSeek API（OpenAI 兼容协议，指数退避 1s/2s/4s） |
| 降级 | Anthropic/OpenCode/Codex 无 key 时自动降级 DeepSeek |

## 架构核心

### 目录

```
backend/app/
├── api/                  # REST：agents/sessions/artifacts/traces/deployments/models/uploads
├── ws/                   # WebSocket 路由 + ConnectionManager（心跳+断线补齐）
├── core/
│   ├── orchestrator.py   # 四阶段状态机 + 会话锁 + 停止/恢复
│   ├── phases/           # 各阶段处理器（base/clarify/comparison/confirmed/executing/registry）
│   ├── event_bus.py      # asyncio.Queue 全局单例
│   ├── middleware.py      # ContextSummarizer → LoopDetector → SubagentLimiter
│   ├── agent_factory.py  # 任务→Agent 匹配 + 临时 Agent 创建/销毁 + API Key 加密
│   ├── sandbox/          # SandboxManager（本地/Docker）+ 工具注册表（5 个工具）
│   ├── tracer.py         # 全链路追踪 span 上下文管理器
│   ├── static_reviewer.py # 静态代码审查（语法+安全，已集成到 executing phase）
│   ├── task_states.py    # 10 状态机 + 状态转换校验
│   ├── prompts.py        # Critic/Planner/Coder/Verifier/Reviewer 的 System Prompt
│   ├── config.py         # pydantic-settings 读 .env
│   └── database.py       # AsyncEngine + init_db（建表+种子数据）
├── models/               # SQLAlchemy 10 表（Agent/Session/SessionAgent/Message/PinnedMessage/Plan/Task/TaskDependency/Artifact/Trace/Deployment/UserSettings）
├── schemas/              # Pydantic（AgentCreate/Update/Response, SessionCreate/Response, MessageResponse, PinToggle）
├── services/
│   ├── adapters/         # BaseAdapter → DeepSeek / Anthropic / OpenCode / Codex
│   └── agent_runner.py  # 单聊 Agent 回复 + 局部修改（流式 token + artifact 提取）
frontend/src/
├── app/                  # layout.tsx（Geist 字体+ToastProvider）+ page.tsx（三栏布局+Demo引导+主题切换）+ globals.css（CSS变量+动画）
├── components/
│   ├── contacts/         # LeftSidebar（三标签+置顶+点Agent直达对话）+ AgentEditor（含模型选择）+ GroupEditor
│   ├── chat/             # ChatPanel（含任务状态恢复）, MessageList, MessageBubble（Agent图标）, MessageInput（Agent快捷@栏）, CodeBlock
│   ├── cards/            # PlanCard, DiffCard, PreviewCard, FileCard
│   ├── plans/            # DAGEditor
│   ├── tasks/            # CollaborationStage（协作剧场，替代旧 TaskPipeline）
│   ├── trace/            # TracePanel（仅后端 API 保留，UI 已移除）
│   ├── ui/               # shadcn/ui 组件
│   ├── SettingsPanel.tsx # 设置侧滑面板（模型 API Key 状态 + 关于）
│   └── ErrorBoundary.tsx # 错误边界（已挂载到 layout.tsx）
├── hooks/                # useWebSocket, useTheme, useContacts
├── stores/               # Zustand：chatStore（核心，SessionItem 用 camelCase）, agentStore
└── lib/                  # constants（EMPTY_ARRAY 铁律）, utils（cn）, agentIcons（AgentIcon/AgentPlaceholderIcon），toast
```

### 设计系统

**色调**：Warm dark（`#141210` 基色，`#B8956A` 琥珀 accent）。浅色模式 warm ivory（`#FAF8F5`）。CSS 变量在 `globals.css`，统一用 `var(--accent)` / `var(--bg-secondary)` / `var(--text-primary)`，禁止硬编码品牌色。`useTheme` hook 管理 localStorage 持久化。

**布局**：三栏通用 header 高度 **48px**，顶部 border-b 水平对齐。主题切换 + 设置按钮在右上角固定定位。主题切换从右下角移到右上角。

**Agent 图标**：用 `AgentIcon` / `AgentPlaceholderIcon` 组件（`@/lib/agentIcons`），**禁止 emoji** 表示 Agent 类型。每个 adapter type 有独特的 SVG 图标（DeepSeek=神经网络节点，Anthropic=十角星，OpenCode=代码括号，Codex=立方体）。

**角色颜色**：简化为 3 类——决策层(Planner/Critic)=琥珀色，执行层(Coder/Write/Calculate/Data/Design/Analyze)=中性灰，审查层(Reviewer/Verify)=绿色。

**动画**：`animate-spring`、`animate-fade-in`、`animate-slide-up`、`animate-pulse-blue`、`animate-skeleton`、`.glass`（毛玻璃）、`.streaming-cursor`。

**Zustand 铁律**：selector 中永远使用 `EMPTY_ARRAY` 常量（`@/lib/constants`），**禁止 `|| []`**——会创建新引用导致无限重渲染。

### 前/后端消息协议

WS 信封：`{type, session_id, payload}`

| 方向 | 关键类型 |
|------|---------|
| C→S | `chat.send`, `chat.modify`, `plan.action`（select_approach/confirm/delete_task）, `session.control`（stop/resume）, `pong` |
| S→C | `chat.message`（带 agent_role）, `chat.stream.token`, `chat.stream.reasoning`（DeepSeek 思维链）, `chat.reasoning.complete`, `plan.comparison`, `plan.confirmed`, `task.update`, `artifact.created`（含 original_content）, `trace.span`, `agent.created`, `context.summarized`, `subagent.queue`, `session.control`, `ping` |

### WebSocket 双协程

`/ws/{session_id}` 使用 `asyncio.gather(ws_to_eventbus(), eventbus_to_ws())`：
- **A**：读 WS → 校验 → 落库 Message → 发布 EventBus → 按 session.type 分发（group→Orchestrator, single→AgentRunner）
- **B**：从 EventBus 队列读 → 发 WS

### Orchestrator

每条群聊消息触发 `Orchestrator(session_id).handle_message(message, mentions)`，按 `Plan.phase` 路由：
```
clarify → comparison → confirmed → executing → done
```
- **Phase 处理器**：`core/phases/` 目录，通过 `PHASE_REGISTRY` 字典注册。Clarify 阶段用 `_critic_has_confirmed()` 检测 `[READY]` 标记 + `_is_still_asking()` 防误判——即使有 [READY]，如果仍在向用户提问也不推进
- **自动推进**：clarify→comparison→confirmed 在一个请求内连续执行，只在"选方案"和"确认DAG"时暂停等待用户
- **方案选择**：前端 PlanCard 点击 → `plan.action select_approach` WS 直接 API，不走文本解析
- **并行执行**：就绪任务通过 `asyncio.gather` 并行执行，SubagentLimiter（`asyncio.Semaphore(3)`）控制并发
- **Reviewer**：Adapter 层 `review_result()` 方法已实现（调用 LLM 审查输出 JSON `{passed, feedback, suggested_changes}`），但未集成到 phase 执行流中
- **Session 控制**：`stop_session`/`resume_session` 通过 per-session `asyncio.Event` 停止/恢复执行
- **并发锁**：per-session `asyncio.Lock` 保证同 session 串行处理消息
- **临时 Agent**：执行阶段为不匹配任务自动创建 temp agent（`is_temp=True`），plan done 时销毁

### Middleware 链（执行阶段）

顺序不可变：**ContextSummarizer**（>50条或>8K tokens 自动压缩，LLM 摘要 + 规则降级兜底）→ **LoopDetector**（MD5 签名追踪 task_title+description，≥3次同签名标记 blocked）→ **SubagentLimiter**（`asyncio.Semaphore(3)` per session 控制并发）

### Adapter

`BaseAdapter` 抽象：`send_message` / `stream_message` / `execute_task` / `review_result` / `get_capabilities`。工厂 `create_adapter(type)` 查找 `ADAPTER_REGISTRY`。

核心数据类型：
- `AgentRole` 枚举：PLANNER / CODER / REVIEWER / ARCHITECT
- `AgentContext`：dataclass 封装 session_id, agent_role, config, conversation_history, current_task, workspace_dir
- `AgentResponse`：dataclass 封装 content, metadata, artifacts, tool_calls
- `StreamToken`：dataclass 区分 content token 和 reasoning token

| Adapter | 实现方式 | 备注 |
|---------|---------|------|
| DeepSeekAdapter | `openai.AsyncOpenAI`，`trust_env=False` | 主力。支持 reasoning/thinking 模式。`execute_task` 实现 ReAct tool loop（最多 10 轮迭代） |
| AnthropicAdapter | anthropic AsyncClient | 默认 `claude-sonnet-4-20250514`。无 key 降级 DeepSeekAdapter。tool_use/tool_result 格式 |
| OpenCodeAdapter | 继承 DeepSeekAdapter | 默认 `opencode` 模型。无 key 降级 DeepSeekAdapter |
| CodexAdapter | 继承 DeepSeekAdapter | 空桩，完全继承 DeepSeekAdapter |

### Agent 工厂（agent_factory.py）

- **match_task_to_agent**：两层匹配——语义名称匹配（capability 关键词→Agent 名称） + capability tag 匹配
- **create_temp_agent**：为无匹配 Agent 的任务自动创建临时 Agent（`is_temp=True`），按 capability 命名（如 "Coder#temp"），API key AES-256-GCM 加密存储
- **destroy_temp_agents**：plan done 时清理 session 的所有临时 Agent
- **API Key 加密**：AES-256-GCM，密钥由 `SECRET_KEY` env 经 SHA-256 派生，nonce 前置 + base64 编码

### 协作剧场（CollaborationStage）

右侧 340px 面板展示多 Agent 协作过程。数据流：

- **任务来源**：`chatStore.tasks[sessionId]`（WebSocket `task.update` 推送）+ `chatStore.confirmedPlans[sessionId]`（DAG 确认后的全量计划）
- **Agent 定位**：`computeSlot()` 根据角色计算绝对定位坐标——Orchestrator 居中，其余 Agent 沿弧线分布
- **依赖连线**：`DependencyWires` 用 `getBoundingClientRect()` 获取 DOM 位置，SVG 贝塞尔曲线连接
- **完成动画**：`CompletionBurst` 粒子从舞台中心向外飞散，Agent 头像 staggered 闪绿
- **全部任务始终可见**：合并 `confirmedPlan.tasks`（含未开始 pending）+ 运行时 `tasks`，一次性展示总量（`1/5 → 5/5`）

### 任务刷新持久化

在 `ChatPanel.tsx` 的 `useEffect([activeSessionId])` 中，`GET /api/sessions/{id}` 返回的 `plan.tasks` 被映射到 `TaskItem[]` 并写入 store。逻辑：
1. WS 推送任务优先（更实时）
2. `existingTasks.length === 0` 时才从 API 恢复（WS 已连则不覆盖）
3. 处于 executing 阶段时同步恢复 `confirmedPlan`（供协作剧场渲染 DAG）

### 沙箱（sandbox/）

- **SandboxManager**：per-session 工作目录管理。两种模式——local（subprocess，始终可用）和 Docker（惰性检测）
- **工具注册表**（5 个）：`write_file` / `read_file` / `run_command` / `install_deps` / `list_files`
- **安全措施**：路径穿越防护、危险命令检测、输出截断（5000 chars）、命令超时（120s）
- **auto_fix_loop**：执行→读错误→修复的自动循环

### 任务状态机（task_states.py）

10 状态：`pending → ready → running → reviewing → done`，异常路径：`retrying` / `failed` / `blocked` / `dispute` / `cancelled`

`ALLOWED_TRANSITIONS` 字典定义合法转换，`validate_transition(from, to)` 校验。

### 数据模型

```
Agent 1──N SessionAgent N──1 Session
Session 1──N Message（含 file_name/file_url/file_size/tokens_used/parent_id/code_selection/reasoning）
Session 1──N Plan 1──N Task
Task N──N TaskDependency（自引用，含自引用检查约束）
Session 1──N Artifact（含 original_content 用于 Diff）/ Trace / Deployment
Agent：is_temp（临时 Agent 标记）, encrypted_api_key（AES-256-GCM 加密存储）
```

### REST API 总览

| 路由 | 关键端点 |
|------|---------|
| `/api/agents` | CRUD + 系统 Agent 删除保护 |
| `/api/sessions` | CRUD + archive/pin + messages（支持 since 断线补齐）+ agents 成员管理 + export（Markdown 导出） |
| `/api/artifacts` | 列表 + 详情 + apply（写入 workspace） |
| `/api/deployments` | 创建（artifact→HTML）+ 列表 + 删除 |
| `/api/traces` | 按 session_id 列表查询 |
| `/api/models/available` | 返回各 adapter 可用性（基于 API key 配置） |
| `/api/sessions/{id}/upload` | 文件上传（image/text，max 10MB） |
| `/api/sessions/{id}/files/{name}` | 静态文件 serve |
| `/deployments` | 部署静态文件 serve |

## 编码约定

- 中文注释，英文变量/函数名
- 默认不写注释，只 WHY 不显然时加一行
- 不处理不可能的错误场景，不做"未来可能需要"的抽象
- Python：`except Exception`，pydantic-settings 读 env
- 前端：Zustand selector **禁止** `|| []`（每次渲染新引用 → 无限循环），必须用 `EMPTY_ARRAY`（`@/lib/constants`）
- `SessionItem` 字段用 camelCase（`agentCount`, `agentIds`, `pinnedAt`），API 传参用 snake_case
- Agent 图标**禁止 emoji**，用 `AgentIcon` / `AgentPlaceholderIcon`（`@/lib/agentIcons`）
- `dark:text-[var(--bg-secondary)]` 是 bug——bg-secondary 是深色背景色，不可做文字色。文字色用 `dark:text-[var(--text-primary)]`
- 三栏 header 统高 48px，顶部 border-b 必须对齐

## 当前进度

- ✅ 基础设施（DB/REST/WS/适配器/沙箱/工具注册表）
- ✅ 前端三栏布局 + warm dark 设计系统（琥珀 accent #B8956A，暗色基色 #141210）
- ✅ Orchestrator 四阶段 + Phase 处理器 + 自动推进 + `[READY]` 防误判
- ✅ PlanCard 方案选择 + DAGEditor 确认执行
- ✅ 协作剧场 (CollaborationStage)：Agent 头像环 + 呼吸动画 + 依赖连线 + 完成粒子爆发
- ✅ Agent 消息角色可见（简化 3 类：决策/执行/审查）
- ✅ SVG Agent 图标（替代所有 emoji）：`AgentIcon` / `AgentPlaceholderIcon`
- ✅ 群聊 Agent 快捷 @ 栏（输入框上方可见头像，点击即 @）
- ✅ 点 Agent 直接进入对话（自动查找或创建，不跳 tab）
- ✅ 置顶功能（API-first + 本地排序，snake_case 对接到 API）
- ✅ Cover 封面动画（任意位置点击跳过）
- ✅ 设置面板（右上齿轮 + 侧滑，显示各模型 API Key 配置状态）
- ✅ AgentEditor 模型选择（DeepSeek / Anthropic / OpenCode）
- ✅ 空状态具体示例（可点击 prompt 快速填充）
- ✅ 会话导出 Markdown + 文件上传 + Web Preview + 一键部署
- ✅ DeepSeek 思维链可折叠展示
- ✅ API Key AES-256-GCM 加密存储
- ✅ static_reviewer 已集成到 executing phase
- ✅ 后端 pytest 测试（33 个测试，test_api/test_event_bus/test_task_states）
- ✅ 任务状态页面刷新持久化（从 `GET /api/sessions/{id}` 的 `plan.tasks` 恢复）
- ✅ ErrorBoundary 挂载到 layout.tsx
- ✅ 会话持久化（URL query param 恢复 + 断线补齐）
- ⚠️ CodexAdapter：空桩（前端不可选）
- ⚠️ TracePanel 从 UI 移除（后端 API `/api/sessions/{id}/diagnostics` 保留供调试）

## Docker 部署

```bash
docker-compose up --build
# Backend: http://localhost:8000 (API docs: /docs)
# Frontend: http://localhost:3000
```

SQLite 数据挂载到 `./backend/data`，`.env` 通过 `docker-compose.yml` readonly mount 注入。

## 冒烟测试

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000

# 创建 Agent + 群聊
AGENT=$(curl -s -X POST http://localhost:8000/api/agents -H "Content-Type: application/json" \
  -d '{"name":"Test","role_type":"system","adapter_type":"deepseek"}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -X POST http://localhost:8000/api/sessions \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"测试\",\"type\":\"group\",\"agent_ids\":[\"$AGENT\"]}"

# WS 连接 ws://localhost:8000/ws/{session_id}?client_id=test
# 发送 {"type":"chat.send","payload":{"content":"写一个 hello world"}}
```
