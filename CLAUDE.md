# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AgentHub 是 IM 聊天式的多 Agent 协作平台（字节跳动 AI 全栈开发挑战赛）。核心理念：**Agent 即联系人**。左侧栏显示 Agent 列表，点击进入单聊，群聊拉多个 Agent 由 Orchestrator 可见地主持会议。四阶段交互：需求澄清 → 方案对比 → 计划确认 → 迭代执行。

## 常用命令

```bash
# 后端
cd backend
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --reload-exclude "workspaces/*" --reload-exclude "data/*"

# 前端
cd frontend
npm install && npm run dev
```

`backend/.env` 配置 API keys（DeepSeek 必填，Anthropic/OpenCode 未配自动降级）。
验证：`python -c "from app.core.orchestrator import Orchestrator; print('OK')"`
构建：`cd frontend && npx next build`

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Next.js 14 + Tailwind + Shadcn UI + Zustand + Monaco Editor |
| 后端 | FastAPI + SQLite (aiosqlite) + SQLAlchemy async |
| 实时通信 | FastAPI 原生 WebSocket（心跳 30s ping/pong） |
| 内部事件 | `asyncio.Queue`（全局单例 `EventBus`，per-session 隔离） |
| 主力模型 | DeepSeek API（OpenAI 兼容协议，指数退避 1s/2s/4s） |
| 降级 | Anthropic/OpenCode 无 key 时自动降级 DeepSeek |

## 架构核心

### 目录

```
backend/app/
├── api/            # REST：agents/sessions/artifacts/traces CRUD
├── ws/             # WebSocket 路由 + ConnectionManager（心跳）
├── core/           # Orchestrator, EventBus, Middleware, Prompts, Config, Database, Tracer
├── models/         # SQLAlchemy 11 表
├── schemas/        # Pydantic
├── services/
│   ├── adapters/   # BaseAdapter → DeepSeek / Anthropic / OpenCode
│   └── agent_runner.py  # 单聊 Agent 回复（流式 token）
frontend/src/
├── app/            # page.tsx（三栏布局）+ globals.css
├── components/
│   ├── contacts/   # LeftSidebar + AgentEditor
│   ├── chat/       # ChatPanel, MessageList, MessageBubble, MessageInput
│   ├── cards/      # PlanCard, DiffCard
│   ├── tasks/      # TaskPipeline
│   └── trace/      # TracePanel
├── hooks/          # useWebSocket, useContacts
├── stores/         # Zustand：chatStore, agentStore
└── lib/            # constants, utils, time
```

### WebSocket 双协程

`/ws/{session_id}` 使用 `asyncio.gather(ws_to_eventbus(), eventbus_to_ws())`：
- **A**：读 WS → 校验 → 落库 Message → 发布 EventBus → 按 session.type 分发（group→Orchestrator, single→AgentRunner）
- **B**：从 EventBus 队列读 → 发 WS

### Orchestrator 逐消息状态机

每条群聊消息触发 `Orchestrator(session_id).handle_message(message)`，按 `Plan.phase` 路由：
```
clarify → comparison → confirmed → executing → done
```
每个阶段调对应 Adapter（Critic/Planner/Coder），落库 Message，发布 EventBus，更新 Plan.phase 后返回。下条消息触发下一步。并发锁 `asyncio.Lock` 保证同 session 串行。事件先缓存后发布（防幽灵数据）。

### Middleware 链（执行阶段）

顺序不可变：**ContextSummarizer**（>50条或>8K tokens 自动压缩）→ **LoopDetector**（MD5 签名追踪，≥3次同签名标记 blocked）→ **SubagentLimiter**（`asyncio.Semaphore(3)` per session 控制并发）

### Adapter

`BaseAdapter` 抽象：`send_message` / `stream_message` / `execute_task` / `review_result` / `get_capabilities`。工厂 `create_adapter(type)` 查找 `ADAPTER_REGISTRY`。
- DeepSeekAdapter：`openai.AsyncOpenAI`，`trust_env=False`
- AnthropicAdapter：无 key 降级 DeepSeek
- OpenCodeAdapter：继承 DeepSeekAdapter，无 key 降级

### 数据模型

```
Agent 1──N SessionAgent N──1 Session
Session 1──N Message
Session 1──N Plan 1──N Task
Task N──N TaskDependency（自引用）
Session 1──N Artifact / Trace
```

## 前/后端消息协议

WS 信封：`{type, session_id, payload}`

| 方向 | 关键类型 |
|------|---------|
| C→S | `chat.send`, `pong` |
| S→C | `chat.message`, `chat.stream.token`, `plan.comparison`, `task.update`, `artifact.created`, `trace.span`, `ping` |

## 编码约定

- 中文注释，英文变量/函数名
- 默认不写注释，只 WHY 不显然时加一行
- 不处理不可能的错误场景，不做"未来可能需要"的抽象
- Python：`except Exception`，pydantic-settings 读 env
- 前端：Zustand selector 不用 `|| []`（会导致无限渲染），用 `EMPTY_ARRAY` 常量

## 当前进度

- ✅ 基础设施（DB/REST/WS/适配器）
- ✅ 前端（三栏布局，Apple 浅色主题，自建 Agent，会话删除）
- ✅ Orchestrator 四阶段 + 中间件链
- ✅ Trace 埋点 + TracePanel（Jaeger 风格瀑布图，按服务过滤，trace 选择器）
- ✅ Diff 卡片 + Monaco DiffEditor + Plan 方案选择卡片
- ✅ TaskPipeline 面板
- ✅ @Mention Agent 选择（前端下拉 + 后端解析）
- ✅ 并行任务执行（asyncio.gather + 独立 DB session，SubagentLimiter 控制并发 ≤3）
- ✅ Reviewer 审查机制（任务完成后自动调用 reviewer，不通过回退重试）
- ✅ Web Preview（iframe sandbox + 设备尺寸切换）
- ✅ 一键部署（POST /api/deployments → 静态文件服务 → 访问 URL）
- ✅ Docker Compose（backend + frontend 独立容器）
- ✅ CodexAdapter 预留桩
- ✅ framer-motion 动画（MessageBubble spring-in 级联效果）
- ✅ 文件上传（图片内联预览 + 文件附件卡片，10MB 限制）
- ✅ 对话式局部修改（CodeBlock 行号选择 + chat.modify 协议 + 流式 Diff）
- ✅ WS 断线消息补齐（重连后 REST API 拉取断线期间消息）
- ✅ LLM 上下文压缩（DeepSeek 智能摘要，四维度结构化输出，规则降级兜底）
- ✅ 骨架屏（LeftSidebar + TaskPipeline 加载占位）
- ✅ 默认 Agent 种子数据（首次启动自动创建 3 个 Agent）
- ✅ 文件元数据持久化（file_name/file_url/file_size 存入 Message 表）
- ✅ 群聊消息显示具体 Agent 名称（多 Agent 可区分来源）
- ✅ .env.example 模板
- ✅ uvicorn reload 排除 workspaces/data 目录（避免上传文件误触发重载）

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
