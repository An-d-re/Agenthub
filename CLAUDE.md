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
| 实时通信 | FastAPI 原生 WebSocket（心跳 30s ping/pong，断线重连指数退避） |
| 内部事件 | `asyncio.Queue`（全局单例 `EventBus`，per-session 隔离） |
| 主力模型 | DeepSeek API（OpenAI 兼容协议，指数退避 1s/2s/4s） |
| 降级 | Anthropic/OpenCode/Codex 无 key 时自动降级 DeepSeek |

## 架构核心

### 目录

```
backend/app/
├── api/            # REST：agents/sessions/artifacts/traces/deployments/plans
├── ws/             # WebSocket 路由 + ConnectionManager（心跳+断线补齐）
├── core/           # Orchestrator, EventBus, Middleware, Prompts, Config, Database, Tracer
├── models/         # SQLAlchemy 12 表（含 Deployment）
├── schemas/        # Pydantic
├── services/
│   ├── adapters/   # BaseAdapter → DeepSeek / Anthropic / OpenCode / Codex
│   └── agent_runner.py  # 单聊 Agent 回复 + 局部修改（流式 token）
frontend/src/
├── app/            # page.tsx（三栏布局+Demo引导+主题切换）+ globals.css（CSS变量+动画）
├── components/
│   ├── contacts/   # LeftSidebar（三标签）+ AgentEditor + GroupEditor
│   ├── chat/       # ChatPanel, MessageList, MessageBubble, MessageInput, CodeBlock
│   ├── cards/      # PlanCard, DiffCard, PreviewCard
│   ├── plans/      # DAGEditor
│   ├── tasks/      # TaskPipeline
│   └── trace/      # TracePanel（Jaeger 风格瀑布图）
├── hooks/          # useWebSocket, useTheme
├── stores/         # Zustand：chatStore, agentStore
└── lib/            # constants, utils, time, toast（ToastProvider+useToast）
```

### 设计系统

CSS 变量定义在 `globals.css:5-27`，统一使用 `var(--accent)` / `var(--bg-secondary)` / `var(--text-primary)` 等，避免硬编码 `#007AFF` / `#F5F5F7`。支持浅色/暗色双主题（`dark:` 类切换），`useTheme` hook 管理 localStorage 持久化。组件中 `/opacity` 尾缀（如 `bg-[#007AFF]/10`）因 CSS 变量限制保留硬编码。

### 前/后端消息协议

WS 信封：`{type, session_id, payload}`

| 方向 | 关键类型 |
|------|---------|
| C→S | `chat.send`, `chat.modify`, `plan.action`（select_approach/confirm/delete_task）, `session.control`（stop/resume）, `pong` |
| S→C | `chat.message`（带 agent_role）, `chat.stream.token`, `plan.comparison`, `plan.confirmed`, `task.update`, `artifact.created`（带 original_content）, `review.result`, `trace.span`, `ping` |

### WebSocket 双协程

`/ws/{session_id}` 使用 `asyncio.gather(ws_to_eventbus(), eventbus_to_ws())`：
- **A**：读 WS → 校验 → 落库 Message → 发布 EventBus → 按 session.type 分发（group→Orchestrator, single→AgentRunner）
- **B**：从 EventBus 队列读 → 发 WS

### Orchestrator

每条群聊消息触发 `Orchestrator(session_id).handle_message(message, mentions)`，按 `Plan.phase` 路由：
```
clarify → comparison → confirmed → executing → done
```
- **自动推进**：clarify→comparison→confirmed 在一个请求内连续执行，只在"选方案"和"确认DAG"时暂停等待用户
- **方案选择**：前端 PlanCard 点击 → `plan.action select_approach` WS 直接 API，不走文本解析
- **并行执行**：就绪任务通过 `asyncio.gather` 并行执行，SubagentLimiter（`asyncio.Semaphore(3)`）控制并发
- **Reviewer**：任务完成后自动调用 reviewer 审查，输出 JSON `{passed, feedback, suggested_changes}`，不通过回退重试（有递归保护）
- **Session 控制**：`stop_session`/`resume_session` 通过 `asyncio.Event` 停止/恢复执行
- 并发锁 `asyncio.Lock` 保证同 session 串行。事件先缓存后发布（防幽灵数据）。

### Middleware 链（执行阶段）

顺序不可变：**ContextSummarizer**（>50条或>8K tokens 自动压缩）→ **LoopDetector**（MD5 签名追踪，≥3次同签名标记 blocked）→ **SubagentLimiter**（`asyncio.Semaphore(3)` per session 控制并发）

### Adapter

`BaseAdapter` 抽象：`send_message` / `stream_message` / `execute_task` / `review_result` / `get_capabilities`。工厂 `create_adapter(type)` 查找 `ADAPTER_REGISTRY`。
- DeepSeekAdapter：`openai.AsyncOpenAI`，`trust_env=False`
- AnthropicAdapter：无 key 降级 DeepSeek
- OpenCodeAdapter：继承 DeepSeekAdapter，无 key 降级
- CodexAdapter：继承 DeepSeekAdapter，预留桩

### 数据模型

```
Agent 1──N SessionAgent N──1 Session
Session 1──N Message（含 file_name/file_url/file_size/tokens_used/parent_id/code_selection）
Session 1──N Plan 1──N Task
Task N──N TaskDependency（自引用）
Session 1──N Artifact（含 original_content 用于 Diff）/ Trace / Deployment
```

## 编码约定

- 中文注释，英文变量/函数名
- 默认不写注释，只 WHY 不显然时加一行
- 不处理不可能的错误场景，不做"未来可能需要"的抽象
- Python：`except Exception`，pydantic-settings 读 env
- 前端：Zustand selector 不用 `|| []`（会导致无限渲染），用 `EMPTY_ARRAY` 常量

## 当前进度

- ✅ 基础设施（DB/REST/WS/适配器）
- ✅ 前端三栏布局 + 左侧三标签（助手🤖/群聊👥/话题💬，SVG 图标 + spring 滑动指示线）
- ✅ Apple 设计系统（CSS 变量 + 浅色/暗色双主题 + 毛玻璃 + 焦点环）
- ✅ Orchestrator 四阶段 + 中间件链 + 自动推进（仅关键决策点暂停）
- ✅ PlanCard 方案选择直连 WebSocket（plan.action select_approach，不再走文本解析）
- ✅ Agent 消息角色可见（Critic🔍/Planner📋/Coder💻/Reviewer✅ 角色徽章 + 气泡颜色区分）
- ✅ 全局 Toast 通知系统（success/error/warning/info + framer-motion 动画）
- ✅ TracePanel（Jaeger 风格瀑布图 + 服务筛选 + trace 选择器）
- ✅ Diff 卡片 + Monaco DiffEditor（original_content 从旧 artifact 提取）
- ✅ Web Preview（iframe sandbox + 设备尺寸切换 + 支持 HTML/SVG/CSS/JS）
- ✅ 一键部署（POST /api/deployments → 静态文件服务 → URL + 状态轮询）
- ✅ TaskPipeline 面板
- ✅ DAGEditor（计划确认 + 任务勾选/删除 + 确认执行）
- ✅ @Mention Agent 选择（前端下拉 + 键盘导航 + 后端解析）
- ✅ 并行任务执行（asyncio.gather + 独立 DB session，SubagentLimiter 控制并发 ≤3）
- ✅ Reviewer 审查机制（自动调用 + JSON 输出 + 不通过回退重试 + 递归保护）
- ✅ 群聊创建面板（GroupEditor 多选 Agent + 群名称输入）
- ✅ Agent 删除确认弹窗（红色警告 + 话题连带删除提示）
- ✅ 引用回复 + 重新生成 + 一键应用 Diff + Session 停止
- ✅ 文件上传（XMLHttpRequest + 进度百分比 + 图片内联预览 + 文件附件卡片）
- ✅ 对话式局部修改（CodeBlock 行号选择 + chat.modify 协议 + 流式 Diff）
- ✅ WS 断线消息补齐 + 离线横幅（黄色重连/绿色恢复）
- ✅ LLM 上下文压缩（DeepSeek 四维度智能摘要 + 规则降级兜底）
- ✅ 骨架屏（LeftSidebar + TaskPipeline + MessageList 加载态）
- ✅ 首次打开 Demo 引导（localStorage 标记 + 自动创建 Demo 群聊）
- ✅ Docker Compose（backend + frontend + SQLite volume）
- ✅ 种子数据 + .env.example + CodexAdapter 桩 + framer-motion

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
