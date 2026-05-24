# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AgentHub 是一个 IM 聊天式的多 Agent 协作平台（字节跳动 AI 全栈开发挑战赛，20 天开发周期）。核心理念：**Agent 即联系人**——如微信/飞书，每个 Agent 是独立联系人，单聊点击即聊，群聊拉多个 Agent 由 Orchestrator 可见地主持会议。

## 常用命令

```bash
# 后端
cd backend
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 前端（尚未搭建）
cd frontend
npm install && npm run dev
```

无测试框架，无 Docker，无认证。`.env` 在 `backend/` 下配置 API keys（DeepSeek 必填，Anthropic/OpenCode 可选，未配置自动降级 DeepSeek）。

验证方式：`python -c "from app.core.orchestrator import Orchestrator; print('OK')"`

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Next.js 14 + Tailwind + Shadcn UI（**尚未搭建**） |
| 后端 | FastAPI + SQLite (aiosqlite) + SQLAlchemy async |
| 实时通信 | FastAPI 原生 WebSocket |
| 内部事件 | `asyncio.Queue`（全局单例 `EventBus`，按 session 隔离队列） |
| 主力模型 | DeepSeek API（OpenAI 兼容协议） |
| 降级 | Anthropic/OpenCode 无 key 时自动降级 DeepSeek |

## 架构核心

### 目录约定

```
backend/app/
├── api/            # REST 路由（Agent CRUD, Session CRUD, Messages, Pins）
├── ws/             # WebSocket 路由 + ConnectionManager（心跳 30s）
├── core/           # 编排中枢：Orchestrator, EventBus, Middleware, Prompts, Config, Database
├── models/         # SQLAlchemy 模型（10 张表）
├── schemas/        # Pydantic 请求/响应模型
└── services/
    └── adapters/   # BaseAdapter → DeepSeek / Anthropic / OpenCode
```

### WebSocket 双协程模式

`ws_routes.py` 的 `websocket_endpoint` 使用 `asyncio.gather(ws_to_eventbus(), eventbus_to_ws())`：
- **任务 A**：从 WS 读取 → 校验 → 持久化 Message → 发布到 EventBus → 根据 session type 分发（group→Orchestrator, single→AgentRunner）
- **任务 B**：从 EventBus 队列读取 → 发送到 WS 客户端

Orchestrator 不订阅 EventBus，只向 EventBus 发布。输入直接从任务 A 获取。

### Orchestrator 逐消息状态机

群聊中每条用户消息触发一次 `Orchestrator(session_id).handle_message(message)`，按 `Plan.phase` 路由：

```
clarify → comparison → confirmed → executing → done
```

- 每个阶段调用对应 Adapter（Critic/Planner/Coder），持久化 Message，发布到 EventBus，更新 Plan.phase，然后返回
- 下一条用户消息触发下一步——不在后台阻塞等待
- MVP 跳过 Reviewer 环节（Coder 输出直接标记 done）
- 任务按依赖顺序逐个执行，失败自动重试 1 次 → 再失败标记 dispute 通知用户

### Adapter 体系

`BaseAdapter`（抽象类）定义：`send_message`, `stream_message`, `execute_task`, `review_result`, `get_capabilities`。所有方法返回 `AgentResponse`（content + metadata + artifacts）。

- **DeepSeekAdapter**：`openai.AsyncOpenAI`，含指数退避重试（1s/2s/4s），429/503/网络错误可重试
- **AnthropicAdapter**：`anthropic.AsyncAnthropic`，无 key 自动降级 DeepSeek
- **OpenCodeAdapter**：继承 DeepSeekAdapter，覆盖 base_url，无 key 自动降级 DeepSeek

工厂方法：`create_adapter(type)` 从 `ADAPTER_REGISTRY` 查找并实例化。

### 数据库模型关系

```
Session 1──N Message
Session 1──N SessionAgent N──1 Agent
Session 1──N Plan 1──N Task
Task N──N Task（自引用依赖，通过 TaskDependency）
```

### Middleware 链（当前 MVP 阶段透传）

执行阶段按序调用，顺序不可变：ContextSummarizer → LoopDetector → SubagentLimiter。

### 编码约定

- 注释使用中文，变量/函数名使用英文
- 默认不写注释，只在 WHY 不显然时加一行
- 不处理不可能发生的错误场景
- 不做"未来可能需要"的抽象
- Python：`except Exception`（不用裸 `except:`），配置通过 `pydantic-settings` 读环境变量

## 当前开发进度

- ✅ Phase 1-3 后端：数据库、REST API、WebSocket、三个 Adapter、AgentRunner
- ✅ Phase 4 后端：Orchestrator 状态机（四阶段 + 任务执行 + 失败重试）
- ❌ 前端：完全空白，`frontend/` 目录为空
- ❌ Reviewer + 反驳机制（MVP 跳过 Review）
- ❌ 并行任务执行（当前逐个执行）
- ❌ 中间件真正实现（当前透传）
- ❌ ContextCompactor（`services/compact.py` 不存在）
- ❌ Trace 全链路埋点
- ❌ 文件上传 / Diff 卡片 / 产物预览

## 冒烟测试

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000

# 创建群聊
curl -X POST http://localhost:8000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"title":"测试","type":"group","agent_ids":["<agent1-id>","<agent2-id>","<agent3-id>"]}'

# 通过 WebSocket 发消息触发编排
# ws://localhost:8000/ws/{session_id}?client_id=test
# 发送: {"type":"chat.send","payload":{"content":"用 React 写一个 Todo 应用"}}
# 观察: Clarify → Comparison → Confirmed → Executing → Done
```
