# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AgentHub 是 IM 聊天式的多 Agent 协作平台（字节跳动 AI 全栈开发挑战赛）。核心理念：**Agent 即联系人**，**会话依赖 Agent**，**群聊是独立实体**。左侧栏三标签（助手/群聊/话题），群聊中 Orchestrator 可见地主持多 Agent 协作。四阶段交互：需求澄清 → 方案对比 → 计划确认 → 迭代执行。

## 常用命令

```bash
# 后端
cd backend
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --reload-exclude "workspaces/*" --reload-exclude "data/*"

# 前端
cd frontend
npm install && npm run dev

# Docker
docker-compose up --build
```

`backend/.env` 配置 API keys（DeepSeek 必填，Anthropic/OpenCode/Codex 未配自动降级）。
验证：`python -c "from app.core.orchestrator import Orchestrator; print('OK')"`
构建：`cd frontend && npx next build`

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
│   ├── static_reviewer.py # 静态代码审查（语法+安全，未集成到执行流）
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
│   ├── contacts/         # LeftSidebar（三标签）+ AgentEditor + GroupEditor
│   ├── chat/             # ChatPanel, MessageList, MessageBubble, MessageInput, CodeBlock
│   ├── cards/            # PlanCard, DiffCard, PreviewCard
│   ├── plans/            # DAGEditor
│   ├── tasks/            # TaskPipeline
│   ├── trace/            # TracePanel（Jaeger 风格瀑布图）
│   ├── ui/               # shadcn/ui 组件（button/card/dialog/dropdown-menu/input/tabs/tooltip 等）
│   └── ErrorBoundary.tsx # 类组件错误边界（已定义，未在 layout/page 中使用）
├── hooks/                # useWebSocket（含重连+断线补齐）, useTheme（localStorage 持久化）, useContacts（会话列表初始化）
├── stores/               # Zustand：chatStore（核心）, agentStore
└── lib/                  # constants（EMPTY_ARRAY/API_BASE/WS_BASE）, utils（cn）, time（relativeTime/shortTime）, toast（ToastProvider+useToast）
```

### 设计系统

CSS 变量定义在 `globals.css`，统一使用 `var(--accent)` / `var(--bg-secondary)` / `var(--text-primary)` 等，避免硬编码 `#007AFF` / `#F5F5F7`。支持浅色/暗色双主题（`dark:` 类切换），`useTheme` hook 管理 localStorage 持久化。组件中 `/opacity` 尾缀（如 `bg-[#007AFF]/10`）因 CSS 变量限制保留硬编码。自定义动画：`animate-spring`（弹性缩放）、`animate-fade-in`、`animate-slide-up`、`animate-pulse-blue`（连接指示灯）、`animate-skeleton`（骨架屏）、`.glass`（毛玻璃）、`.streaming-cursor`（闪烁光标）。

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
- **Phase 处理器**：`core/phases/` 目录，每个 phase 独立文件，通过 `PHASE_REGISTRY` 字典注册
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
- 前端：Zustand selector 不用 `|| []`（会导致无限渲染），用 `EMPTY_ARRAY` 常量

## 当前进度

- ✅ 基础设施（DB/REST/WS/适配器/沙箱/工具注册表）
- ✅ 前端三栏布局 + 左侧三标签（助手🤖/群聊👥/话题💬，SVG 图标 + spring 滑动指示线）
- ✅ Apple 设计系统（CSS 变量 + 浅色/暗色双主题 + 毛玻璃 + 焦点环 + 微交互动画）
- ✅ Orchestrator 四阶段 + Phase 独立处理器 + 自动推进（仅关键决策点暂停）
- ✅ PlanCard 方案选择直连 WebSocket（plan.action select_approach）
- ✅ Agent 消息角色可见（Critic🔍/Planner📋/Coder💻/Reviewer✅ 等 9 种角色徽章 + 气泡颜色区分）
- ✅ 全局 Toast 通知系统（success/error/warning/info + framer-motion 动画 + 3 条队列）
- ✅ TracePanel（Jaeger 风格瀑布图 + 服务筛选 + trace 选择器）
- ✅ Diff 卡片 + Monaco DiffEditor（original_content 从旧 artifact 提取）
- ✅ Web Preview（iframe sandbox + 设备尺寸切换 phone/tablet/desktop + HTML/SVG/CSS/JS）
- ✅ 一键部署（POST /api/deployments → 静态 HTML 生成 → URL + 状态轮询，20s 超时）
- ✅ TaskPipeline 面板（9 状态 + 进度条 + 实时耗时 + 错误详情 + 骨架屏加载态）
- ✅ DAGEditor（任务勾选/删除 + 执行器选择 existing/new + 模型选择 + API Key 加密输入）
- ✅ @Mention Agent 选择（前端下拉 + 键盘导航）
- ✅ 并行任务执行（asyncio.gather + 独立 DB session，SubagentLimiter 控制并发 ≤3）
- ✅ 群聊创建面板（GroupEditor 多选 Agent + 群名称输入）
- ✅ Agent 编辑/删除（AgentEditor 侧滑面板 + Skill 预置库勾选 + 系统 Agent 保护）
- ✅ 引用回复 + 重新生成 + 一键应用 Diff + Session 停止/恢复
- ✅ 文件上传（XMLHttpRequest + 进度百分比 + 图片内联预览 + 文件附件卡片）
- ✅ 对话式局部修改（CodeBlock 行号选择 + chat.modify 协议 + 流式 Diff）
- ✅ WS 断线消息补齐 + 离线横幅（黄色重连/绿色恢复，最多 8 次重试）
- ✅ LLM 上下文压缩（ContextSummarizer：50 条/8K tokens 触发，DeepSeek 四维度摘要 + 规则降级）
- ✅ 骨架屏（LeftSidebar + TaskPipeline + MessageList + DiffCard）
- ✅ 首次打开 Demo 引导（localStorage 标记，轮询 agents 就绪后自动创建 Demo 群聊）
- ✅ 会话导出 Markdown（GET /api/sessions/{id}/export）
- ✅ DeepSeek 思维链（chat.stream.reasoning + chat.reasoning.complete + ReasoningBlock 可折叠展示）
- ✅ API Key 加密存储（AES-256-GCM，create_temp_agent 时加密，decrypt_api_key 解密）
- ✅ ErrorBoundary（已挂载到 layout.tsx）
- ✅ 封面页（聚焦穿透动画 + 品牌渐变 + sessionStorage 持久化）
- ✅ 会话持久化（URL query param 恢复 + fetchSessions 补全）
- ⚠️ CodexAdapter：空桩，完全继承 DeepSeekAdapter（前端不可选，预留占位）
- ⚠️ 后端无 Python 单元测试（pytest），但 `tests/` 目录已有 Playwright E2E 测试（`run-tests` skill）

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
