# AgentHub — 多 Agent 协作平台

IM 聊天式多 Agent 协作平台。用户像使用飞书/微信一样，通过群聊 @Agent 发起任务，由 Orchestrator 自动拆解、调度、执行，多个 Agent 协作产出代码、文档、网页等产物。

## 快速开始

```bash
# 后端
cd backend
pip install -r requirements.txt
cp .env.example .env  # 编辑填入 API Key
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 前端
cd frontend
npm install
npm run dev
```

前端运行在 `http://localhost:3000`，后端运行在 `http://localhost:8000`。

Docker 部署：

```bash
docker compose up -d
```

## 架构概览

```
┌─────────────────────────────────────────────────┐
│  前端 (Next.js 14 + React 18 + Tailwind CSS)     │
│  ┌──────────┬──────────┬──────────────────────┐ │
│  │ 群聊面板  │ 协作剧场  │ 设置/Settings        │ │
│  │ ChatPanel│ Collab   │ SettingsPanel        │ │
│  └──────────┴──────────┴──────────────────────┘ │
│        │  WebSocket + REST API                   │
└────────┼─────────────────────────────────────────┘
         │
┌────────┴─────────────────────────────────────────┐
│  后端 (FastAPI + SQLAlchemy + SQLite)            │
│  ┌──────────────────────────────────────────────┐│
│  │  Orchestrator（编排器）                      ││
│  │  clarify → comparison → confirmed → executing││
│  └──────────────────────────────────────────────┘│
│  ┌──────────┬──────────┬───────────────────────┐│
│  │ Agent     │ EventBus │ Adapters             ││
│  │ Factory   │ (Queue)  │ DeepSeek/Claude/Codex ││
│  └──────────┴──────────┴───────────────────────┘│
└──────────────────────────────────────────────────┘
```

### 核心概念

- **Agent**：每个 Agent 是一个可对话的 AI，有独立的 System Prompt、能力标签、适配器。系统预置 PM/架构师/前后端工程师/设计师/QA/DevOps 共 7 个 Agent，用户可自建
- **Session**：群聊/单聊会话。群聊中多 Agent 协作，单聊中 1v1
- **Plan**：Planner Agent 将需求拆解为任务 DAG（有向无环图），每个任务指定执行者
- **Orchestrator**：状态机驱动，clarify（澄清需求）→ comparison（方案对比）→ confirmed（任务分解+确认）→ executing（并发执行）→ done
- **Adapter**：统一适配层，对接 DeepSeek / Anthropic Claude / OpenAI Codex / OpenCode 等平台

### 项目结构

```
agenthub/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── api/                 # REST API（sessions, agents, artifacts）
│   │   ├── ws/                  # WebSocket（聊天消息、事件推送）
│   │   ├── core/
│   │   │   ├── orchestrator.py  # 编排状态机
│   │   │   ├── agent_factory.py # Agent 创建与匹配
│   │   │   ├── event_bus.py     # 会话级事件总线
│   │   │   ├── prompts.py       # 各阶段 System Prompt
│   │   │   └── phases/          # clarify/confirmed/executing 等阶段
│   │   ├── models/              # SQLAlchemy 数据模型
│   │   ├── schemas/             # Pydantic 序列化
│   │   └── services/adapters/   # Agent 平台适配器
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js App Router
│   │   ├── components/
│   │   │   ├── chat/            # 聊天面板、消息气泡、输入框
│   │   │   ├── tasks/           # 协作剧场（任务流水线）
│   │   │   ├── contacts/        # 左侧会话列表
│   │   │   ├── cards/           # 产物卡片（Diff/File/Preview）
│   │   │   └── plans/           # DAG 编辑器
│   │   ├── hooks/               # useWebSocket 等
│   │   ├── stores/              # Zustand 状态管理
│   │   └── lib/                 # 工具函数
│   ├── package.json
│   └── Dockerfile
├── docs/                        # 产品/技术文档
├── ai-collaboration/            # AI 协作开发记录
├── demo/                        # 演示视频
└── docker-compose.yml
```

### 主要功能

- **IM 聊天交互**：群聊/单聊、多会话并行、消息引用、Pin 上下文、流式响应
- **Orchestrator 编排**：自动需求澄清 → 方案对比 → 任务分解为 DAG → 并发执行
- **@Agent 指定**：群聊中 @Agent 指定执行者，未指定时自动匹配（技术标签 + 能力语义 + 名称）
- **多平台接入**：DeepSeek、Anthropic Claude、OpenAI Codex、OpenCode，统一适配器层
- **产物内联**：代码 Diff 卡片、网页预览卡片、文件附件，聊天流中直接预览和操作
- **协作剧场**：任务流水线可视化，实时展示 DAG 执行进度，完成即点亮
- **自建 Agent**：用户自定义 System Prompt、能力标签、选择底层模型

### 任务编排流程

```
用户发送需求
    ↓
Clarify（Critic Agent 澄清需求）
    ↓
Comparison（Planner 给出多方案对比）
    ↓
Confirmed（分解为任务 DAG，分配 Agent）
    ↓
Executing（并发执行就绪任务，自动重试失败）
    ↓
Done（全部完成）
```

### 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 14, React 18, TypeScript, Tailwind CSS, Zustand, Framer Motion |
| 后端 | FastAPI, SQLAlchemy (async), SQLite, WebSocket |
| AI 接入 | DeepSeek API, Anthropic Claude API, OpenAI Codex CLI, OpenCode CLI |
| 部署 | Docker Compose |

### 环境变量

后端 `backend/.env`：

```env
SECRET_KEY=your-secret-key-for-api-encryption
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
ANTHROPIC_API_KEY=sk-ant-xxx
```

## 比赛信息

本项目为「AgentHub - 多 Agent 协作平台」参赛作品，详见 `docs/AgentHub- 多Agent协作平台设计.md`。

AI 协作开发记录见 `ai-collaboration/`，包含与 Claude Code 协作的完整过程、Spec 规范、Skills 定义、问题追踪等。
