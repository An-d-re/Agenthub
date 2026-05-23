# AgentHub — 多 Agent 协作平台

> 字节跳动 AI 全栈开发挑战赛 | 20 天开发周期

## 项目概述

AgentHub 是一个 IM 聊天式的多 Agent 协作平台。核心理念：**Agent 即联系人**——像微信/飞书一样，每个 Agent 是独立联系人（有头像、名称、能力标签），单聊点击即聊，群聊拉多个 Agent 进群由 Orchestrator 可见地主持会议。平台支持用户对话式自建 Agent（设定 System Prompt + 从预置 Skill 库勾选能力 + 示例数据库连接），所有 Agent 产出以富媒体卡片内联在聊天流中预览。

### 评审权重

| 维度 | 权重 | 策略 |
|------|------|------|
| AI 协作能力 | 30% | ai-collaboration/ 目录沉淀 spec/skill/rules + prompt 迭代记录 |
| 功能完整度 | 25% | IM 核心体验 + 多 Agent 调度跑通 |
| 生成效果质量 | 20% | 聊天 UI 流畅度 + 产物内联预览卡片 |
| 代码理解度 | 15% | 答辩时讲清架构选型、设计决策 |
| 创新与产品感 | 10% | 四阶段交互模型、反驳机制、多方案对比、对话式局部修改 |

**交付物**：产品设计文档 + 技术文档 + 可运行 Demo + AI 协作开发记录 + 3 分钟 Demo 视频

### 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Next.js 14 + Tailwind + Shadcn UI |
| 状态管理 | React Hooks + Zustand |
| 后端 | FastAPI |
| 实时通信 | FastAPI 原生 WebSocket |
| 数据库 | SQLite + aiosqlite（零配置，单文件） |
| 内部事件 | asyncio.Queue（单进程，未来水平扩展可替换为 Redis Pub/Sub） |
| 主力模型 | DeepSeek API（对话 + 推理） |
| 代码生成 | Anthropic API（Claude 模型，HTTP API） |
| 第二 Agent | OpenCode（字节系，HTTP API） |
| 运行方式 | Python + Node.js 直跑，不用 Docker |
| 部署 | 阿里云轻量服务器（成都，2核2G Ubuntu 22.04）+ nginx 反代 |

---

## Agent 即联系人（核心交互模型）

```
左侧会话列表（= 联系人列表，WeChat 模式）

├── 🧠 Claude (Anthropic)   「代码生成 多文件重构」    最后消息: "已完成"
├── 📋 项目认证讨论群       (群聊 · 3 人)             最后消息: "审查通过 ✓"
├── 🔧 OpenCode           「轻量编程 Web开发」       最后消息: "函数优化完成"
├── 🗄️ SQL优化专家(自建)   「数据库 SQL 性能」       最后消息: "索引建议如下"
└── ＋ 新建群聊
```

- **单聊**：点击 Agent 联系人 → 直接进入 1v1 对话。单聊不走可见 Orchestrator——后台透明调度，用户感知不到
- **群聊**：[+] 拉起联系人选择器（勾选 2+ 个 Agent）→ 命名群聊 → Orchestrator 作为可见群主主持协作
- **自建 Agent**：对话式创建（起名 + 写 System Prompt + 勾选预置 Skill），创建完自动出现
- **系统 Agent 不可删除**（Claude / OpenCode / Orchestrator），自建 Agent 可增删改

### Agent 能力标签

小徽章样式，1-3 个标签。系统 Agent 预置，自建 Agent 从所选 Skill 自动推导：

```
🧠 Claude             [代码生成] [重构]
🔧 OpenCode           [轻量编程] [Web开发]
📋 Orchestrator       [任务协调] [多Agent调度]
🗄️ SQL优化专家(自建)   [数据库] [SQL] [性能]
```

### Agent 头像

系统 Agent：emoji + 渐变色背景。自建 Agent：默认 emoji 占位 + 可上传自定义图片。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Frontend (Next.js 14)                       │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐  │
│  │SessionList│ │ ChatPanel │ │InlineCard│ │TaskPipeline  │  │
│  │=联系人列表│ │消息+@输入 │ │Diff/预览 │ │任务状态面板  │  │
│  └────┬─────┘ └─────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       └─────────────┴────────────┴─────────────┘            │
│                    原生 WebSocket                             │
├──────────────────────────────────────────────────────────────┤
│                      Backend (FastAPI)                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                     core/ (调度中枢)                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │ Orchestrator │  │  EventBus    │  │ Middleware    │  │ │
│  │  │ ①需求澄清    │  │ (asyncio.    │  │ PinContext    │  │ │
│  │  │ ②方案对比    │  │  Queue)     │  │ LoopDetect    │  │ │
│  │  │ ③计划确认    │  │              │  │ SubLimiter    │  │ │
│  │  │ ④迭代执行    │  │              │  │               │  │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │ │
│  └─────────┼─────────────────┼─────────────────┼──────────┘ │
│            │                 │                 │             │
│  ┌─────────┴─────────────────┴─────────────────┴──────────┐ │
│  │                    services/                            │ │
│  │  ┌────────────────┐  ┌──────────┐  ┌───────────────┐  │ │
│  │  │ AgentAdapter   │  │ Session  │  │ DiffService   │  │ │
│  │  │ ┌────────────┐ │  │ Service  │  │               │  │ │
│  │  │ │BaseAdapter │ │  └──────────┘  └───────────────┘  │ │
│  │  │ ├────────────┤ │  ┌──────────────┐                 │ │
│  │  │ │DeepSeek    │ │  │ AgentBuilder │ 自建Agent      │ │
│  │  │ │(主力)      │ │  └──────────────┘                 │ │
│  │  │ ├────────────┤ │  ┌──────────────────────────────┐ │ │
│  │  │ │Anthropic   │ │  │ ContextCompactor            │ │ │
│  │  │ │(Claude API)│ │  │ /compact → LLM 摘要         │ │ │
│  │  │ ├────────────┤ │  └──────────────────────────────┘ │ │
│  │  │ │OpenCode    │ │  ┌──────────────────────────────┐ │ │
│  │  │ │(HTTP API)  │ │  │ ObservabilityService         │ │ │
│  │  │ └────────────┘ │  └──────────────────────────────┘ │ │
│  │  └────────────────┘                                    │ │
│  └────────────────────────────────────────────────────────-┘ │
│  ┌────────────┐  ┌─────────────────────────────────────────┐ │
│  │ WS Manager │  │  models/  (SQLAlchemy + aiosqlite)     │ │
│  └────────────┘  │  Agent / Session / Message / Pin       │ │
│                  │  / Plan / Task / Artifact / Trace       │ │
│                  └─────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│         SQLite (aiosqlite, 零配置单文件)                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 核心交互流程

### 单聊（透明 Orchestrator）

```
用户点 🧠 Claude → 1v1 对话
User: "写个登录页面，React + Tailwind"
         ↓ Orchestrator 后台透明调度
[🧠 Claude]: 代码... [Diff 卡片]
```
无可见 Orchestrator。Critic/Planner 只在后台工作，消息流里只看到 Agent 回复。

### 群聊（可见 Orchestrator）

```
用户发需求 → Orchestrator 作为群主可见地主持会议

[User]: "帮我给项目加上用户认证"
[📋 Orchestrator]: "等一下。什么框架？JWT还是Session？只要登录还是全流程？"
[User]: "FastAPI, JWT, 登录+注册"
[📋 Orchestrator]: "A. fastapi-users库 (推荐, 50行) B. 手写JWT (灵活) C. OAuth2全套 (太重)。推荐A。"
[User]: "选A"
[📋 Orchestrator]: "拆成3步：① 安装配置 ② 注册API ③ 登录API。@Coder 执行①② @OpenCode ③"
[Coder]: "① ② 完成" [代码卡片]
[OpenCode]: "③ 完成" [代码卡片]
[📋 Orchestrator]: "@Reviewer 检查"
[Reviewer]: "③ 缺少错误处理，建议加 try/except"
[OpenCode]: "reviewer 说得对，已补充" [Diff 卡片]  ← 无反驳，直接修改
[📋 Orchestrator]: "全部完成 ✓"

[右侧 TaskPipeline 面板同步展示任务状态流转]
```

### TaskPipeline 面板 UI Mockup（开发基准）

```
┌─ Task Pipeline ─────────────────────────────┐
│ Round 1              3/4 done                │
│                                              │
│ ● Task 1: 安装 fastapi-users   [done]  1.2s │
│ ● Task 2: 配置 User 模型       [done]  3.1s │
│ ● Task 3: 注册 API             [running] ⏳  │
│ ○ Task 4: 登录 API             [pending]     │
│                                              │
│ Round 2 (next)                               │
│ ○ Task 5: 测试用例             [pending]     │
└──────────────────────────────────────────────┘
```

每个任务一行，状态色块：🟢 done / 🔵 in_progress (脉冲动画) / 🟡 review / 🟠 retry / 🔴 blocked / ⚪ pending。依赖的任务用缩进或 `└─ depends: Task 2` 标注。

> **前端实现约束**：`TaskPanel` 组件严格按上述布局渲染（左对齐圆点 + 任务名 + 状态标签 + 耗时），用 Tailwind `table` 或 `flex` 实现，`div` 嵌套不超过 3 层。不做横向流水线/拖拽/Gantt 图。Day 14 以此 mockup 为验收标准。
```

---

## 关键设计决策

### 1. 群聊 vs 单聊的 Orchestrator 行为

| 模式 | Orchestrator | 行为 |
|------|-------------|------|
| 单聊 | 透明 | 后台调度，消息流不可见。用户感觉在跟 Agent 直接对话 |
| 群聊 | 可见群主 | 澄清需求、方案对比、任务分派、进度汇报，全在聊天流中可见 |

群聊里 Orchestrator 是"主持人"而非"midderware"。

### 2. 四阶段交互模型（群聊专用）

| 阶段 | 做什么 | 用户参与 |
|------|--------|----------|
| 需求澄清 | Critic 质疑需求，反问模糊点（最多2轮） | 用户回答 |
| 方案对比 | Gate判断：唯一最佳→跳过 / 多路线→出A/B/C对比 | 用户选择 |
| 计划确认 | 输出任务 DAG（轻量勾选+删除，确认后执行） | 用户确认 |
| 迭代执行 | 多轮分发（≤3并行），失败自动重试1次→再败问用户 | 随时暂停/停止/重试 |

### 3. Agent 反驳机制

- Coder 可反驳 Reviewer（最多1轮 rebuttal，需技术依据）
- Coder 可拒绝不合理任务（需给出理由 + 替代方案）
- Agent 在安全/性能层面拒绝用户错误要求（"MD5 不能存密码"）
- 不一致 → `dispute` 状态交用户裁决
- **规则兜底**：Agent 回复中若以 `[AGREE]` 或 `[REJECT]` 开头，系统直接按关键词解析（`[AGREE]` → 自动通过当前 task，`[REJECT]` → 自动标记 dispute），跳过 LLM 二次判断。减少调用成本 + 增加确定性

### 4. 上下文管理

```
上下文构建 = Compact 摘要 + Pinned 消息 + 最近 15 条原文

触发条件: 消息历史 > 30 条或估算 tokens > 阈值
Compact: 调 DeepSeek 快速总结 → {关键决策, 已生成文件, 待解决问题, 用户偏好}
效果: 200条对话 → ~500字摘要 + 15条原文 ≈ 2K tokens
```

Pin 消息手动设置，始终注入上下文。类似 Claude Code `/compact`。

### 5. Middleware 链（执行阶段）

| 顺序 | 中间件 | 行为 |
|------|--------|------|
| 1 | **PinContext** | 注入已 pin 消息到 system prompt |
| 2 | **LoopDetector** | 连续2轮相同(agent_role, task_signature) → 标记 blocked |
| 3 | **SubagentLimiter** | 同一轮并行 Agent 数 ≤ 默认3（用户可在设置中修改） |

> **Semaphore 作用域澄清**：`Semaphore(3)` 限制的是**同时活跃的 Session 数**（session 级，`Orchestrator._run_loop` 入口获取许可）。Session 内部的 task 并行调度（`asyncio.gather` 分发 Agent adapter 调用）不经过该 semaphore，由 SubagentLimiter 独立控制。两者分工避免死锁。

### 6. 三个 Adapter

| Adapter | 方式 | 定位 |
|---------|------|------|
| DeepSeek | HTTP API | 主力 LLM，对话 + 推理 + Compact 摘要 |
| Anthropic | HTTP API | Claude 模型（默认 `claude-sonnet-4-20250514`），复杂代码生成。API 不可用时自动降级为 DeepSeek 兜底 |
| OpenCode | HTTP API | 第二 Agent 平台（字节系），稳定保底 |

**BaseAdapter 级重试**：所有 HTTP adapter 内置指数退避（3 次，间隔 1s/2s/4s）。429/503 → 自动重试 → 仍失败 → 向上抛出 `AgentError` → 进入失败降级流程。

### 7. 失败降级

1. Task 失败 → 自动重试 1 次（同 Agent，静默）
2. 再失败 → Orchestrator 在聊天流发消息："Task X 失败（原因）。重试 / 换 @OpenCode / 跳过？"
3. 用户决策。评委看到"失败→自动重试→再次失败→问用户→换Agent成功"

### 8. 用户介入粒度

| 级别 | 操作 |
|------|------|
| Session 级 | 暂停 / 继续 / 停止 |
| Task 级 | 重试 / 取消 |

不做 task 内容编辑（Planner re-plan 已覆盖）。

### 9.5. WS 断线恢复

断线期间 Agent 可能已完成回复。前端重连后：
- 通过 `GET /api/sessions/{id}/messages?since={last_received_message_id}` 补齐丢失的完整消息
- 流式 token 不恢复（断线期间流失的中间 token 永久丢失）
- 答辩时主动说明此限制，体现对实时通信边界条件的理解

### 9. 会话管理

| 功能 | 行为 |
|------|------|
| 置顶 (P0) | `pinned_at` 字段，SQL `ORDER BY pinned DESC, last_active DESC` |
| 归档 | 软删除（从列表隐藏，数据保留，可找回） |
| 搜索 | 搜会话标题 + Agent 名称（SQLite LIKE，不建 FTS5） |
| 并发上限 | 默认 3 个 session 并行（用 `Semaphore(3)`），用户在设置中可改 |
| 群聊成员 | 随时增删（新增→之后生效，删除→当前 task 退回 pending 重分配） |

### 10. 消息操作

| 操作 | 实现 |
|------|------|
| 引用回复 | 轻量引用（微信式），输入框上方挂被引用片段缩略 |
| 重新生成 | 同 prompt 重调一次 Agent |
| Pin | 标记消息，始终注入上下文 |
| 一键应用 Diff | 写入 workspaces，冲突拒绝（同文件已有未应用 Diff → 提示先处理） |
| 对话式局部修改 (P1) | 用户选中代码行 → 描述修改 → Agent 精准改那几行 → Diff 卡片 |
| 重新生成 | 同 prompt 重调 Agent |

### 11. 富媒体消息

支持消息类型：文本、代码块、**图片上传**、**文件附件**、网页预览卡片、Diff 视图卡片。

- 文件上传存 `workspaces/{session_id}/uploads/`，元数据落 SQLite
- 网页预览：FastAPI `/preview/{session_id}/{file_path}` serve 静态文件 → 点击卡片新 tab 打开

### 12. 部署发布（P2）

**本次比赛不实现一键部署。** 在答辩时说明架构设计思路（Docker Compose + nginx 代理 + 动态端口分配 + 容器生命周期管理）。代码中预留 `POST /api/sessions/{id}/deploy` 接口桩，返回 `{"status": "planned", "design": "..."}`。

**替代方案**：`GET /preview/{session_id}/{file_path}` 静态 serve + 新 tab 打开（已在 Phase 5 实现），1 天成本，演示效果足以替代。

### 13. P2 功能标记

不做或降级：PPT 浏览、多端支持、完整版本树（每轮 Diff 卡片可点击"历史"按钮回看该文件历代 Diff，但本次不做完整版本分支图）、一键部署按钮

### 14. 部署

阿里云轻量服务器（成都，2核2G Ubuntu 22.04），nginx 反代：
- Next.js `next build && next start -p 3000`
- FastAPI `uvicorn main:app --host 0.0.0.0 --port 8000`
- nginx 代理 `/ws` → FastAPI，其余 → Next.js
- SQLite 文件在 `/data/agenthub.db`，workspaces 在 `/data/workspaces/`

---

## 数据库核心表

| 表 | 关键字段 |
|----|----------|
| **agents** | id, name, avatar_url, role_type(system\|custom), adapter_type, system_prompt, skills(JSON), capability_tags(JSON), is_deletable |
| **sessions** | id, title, type(single\|group), status(active\|archived), pinned_at, last_active_at, created_at |
| **session_agents** | session_id(FK), agent_id(FK) |
| **messages** | id, session_id(FK), agent_id(nullable FK), role(user\|agent\|system), content, message_type(text\|code\|image\|file\|card\|system), parent_id(self-FK), code_selection(JSON nullable), created_at |
| **pinned_messages** | session_id(FK), message_id(FK), pinned_at |
| **plans** | id, session_id(FK), phase(clarify\|comparison\|confirmed\|executing), approaches(JSON), selected_approach, task_dag(JSON), status |
| **tasks** | id, plan_id(FK), parent_task_id(self-FK), title, description, assigned_agent_id(FK), status(pending→in_progress→review→done\|blocked\|retry\|dispute), round, priority, retry_count, result, error_message |
| **task_dependencies** | id, task_id(FK), depends_on_task_id(FK) |
| **artifacts** | id, task_id(FK), session_id(FK), file_path, original_content, modified_content, language, artifact_type |
| **traces** | id, session_id(FK), trace_id, span_id, parent_span_id, operation_name, duration_ms, status, tags(JSON) |
| **user_settings** | key, value (JSON) — 如 `concurrent_session_limit: 3` |

> `user_settings` 仅用于运行时用户可动态修改的设置。静态配置（API Key、模型名等）通过环境变量注入，不走数据库。

---

## WebSocket 消息协议

所有消息信封：`{type, session_id, timestamp, payload}`

### C→S

| 类型 | 说明 |
|------|------|
| `chat.send` | 发送消息 |
| `chat.typing` | 输入状态 |
| `chat.modify` | 对话式局部修改 `{message_id, start_line, end_line, instruction}` |
| `pin.toggle` | pin/unpin 消息 |
| `task.action` | retry/cancel/approve/reject |
| `plan.action` | select_approach / edit_task / delete_task / confirm |
| `session.create_group` | `{title, agent_ids[]}` |
| `session.manage_members` | `{add[], remove[]}` |
| `agent.create` | 对话式自建 Agent `{name, system_prompt, skills[]}` |
| `agent.edit` | `{agent_id, name?, system_prompt?, skills?}` |
| `agent.delete` | `{agent_id}` |
| `ping` | 心跳 |

### S→C

| 类型 | 说明 |
|------|------|
| `chat.message` | 完整消息 |
| `chat.stream.token` / `chat.stream.end` | 流式 token |
| `agent.typing` | Agent 思考中 |
| `plan.clarify` | Critic 反问 |
| `plan.comparison` | 方案 A/B/C 对比 |
| `plan.confirmed` | 任务 DAG 待确认 |
| `task.update` / `task.pipeline.update` | 任务状态 / 流水线快照 |
| `task.dispute` | Agent 间意见不一致 |
| `task.failed` | 失败通知 + 用户选项 |
| `round.start` / `round.complete` | 轮次事件 |
| `orchestration.complete` / `orchestration.partial` | 编排结束 |
| `orchestrator.message` | Orchestrator 群聊可见发言 |
| `artifact.created` | 产物通知 |
| `card.inline` | 内联卡片 (diff/preview/file/image) |
| `trace.span` | 可观测性 span |
| `agent.created` / `agent.deleted` | Agent 联系人变更 |
| `session.archived` | 会话被归档 |
| `error` / `pong` | 错误 / 心跳回复 |

---

## 目录结构

```
agent-hub/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   │   ├── contacts/          # Agent 联系人/会话列表
│   │   │   ├── chat/              # ChatPanel / MessageList / Bubble / Input(@面板+文件上传)
│   │   │   ├── cards/             # InlineCard / DiffCard / PreviewCard / FileCard
│   │   │   ├── plans/             # PlanComparison (方案卡片) / DAGEditor (轻量勾选)
│   │   │   ├── tasks/             # TaskPipeline 面板 (CI风格)
│   │   │   └── trace/             # TracePanel 瀑布图
│   │   ├── hooks/                 # useWebSocket / useContacts / useSession
│   │   └── stores/                # Zustand stores
│   ├── tailwind.config.ts
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── api/                   # REST (Agent/联系人 CRUD, Session CRUD, Pin, 上传)
│   │   ├── ws/                    # WebSocket + ConnectionManager
│   │   ├── core/
│   │   │   ├── orchestrator.py    # 四阶段交互 + 迭代执行 + 反驳
│   │   │   ├── event_bus.py       # asyncio.Queue
│   │   │   └── middleware.py      # PinContext → LoopDetect → SubLimiter
│   │   ├── models/                # SQLAlchemy (SQLite)
│   │   ├── services/
│   │   │   ├── adapters/
│   │   │   │   ├── base.py
│   │   │   │   ├── deepseek.py
│   │   │   │   ├── anthropic.py
│   │   │   │   └── opencode.py
│   │   │   ├── agent_builder.py   # 对话式自建 Agent
│   │   │   ├── session.py
│   │   │   ├── compact.py         # /compact 上下文压缩
│   │   │   ├── diff.py
│   │   │   └── observability.py
│   │   └── schemas/               # Pydantic
│   ├── requirements.txt
│   └── Dockerfile                 # (可选，用于参考)
├── ai-collaboration/              # AI 协作沉淀 (30% 评分)
│   ├── journal.md
│   ├── rules/
│   │   ├── architecture.md
│   │   └── coding-standards.md
│   ├── prompts/
│   │   └── templates.md
│   └── skills/
│       └── index.md
├── workspaces/                    # Agent 代码工作目录 (持久)
│   └── {session_id}/
│       ├── uploads/               # 用户上传文件
│       └── {project_files}/       # Agent 生成的代码
└── data/
    └── agenthub.db                # SQLite 数据库文件
```

---

## 20 天时间线

### Phase 1: 基础设施 (Day 1-3)
| Day | 交付 |
|-----|------|
| 1 | 项目脚手架 (Next.js 14 + FastAPI)，SQLite + aiosqlite，env 配置 |
| 2 | 全部 DB 模型 + Alembic 迁移 |
| 3 | REST API (Agent CRUD, Session CRUD, Pin 管理, 上传) + CORS |

### Phase 2: 实时通信 (Day 4-6)
| Day | 交付 |
|-----|------|
| 4 | EventBus + WS ConnectionManager (心跳30s) |
| 5 | WS 路由 + 核心消息协议 (`chat.send`/`chat.message`/`chat.stream`/`ping`)，其余消息类型 Day6+ 随功能补 |
| 6 | 前端 useWebSocket (断线重连) + 基础聊天 UI + 会话列表 (置顶/归档/搜索) |

### Phase 3: Agent 基础设施 (Day 7-9)
| Day | 交付 |
|-----|------|
| 7 | BaseAdapter + DeepSeekAdapter (完整，含 streaming) |
| 8 | AnthropicAdapter (Claude HTTP API，与 DeepSeek 类似) |
| 9 | OpenCodeAdapter (HTTP API) + Agent 联系人列表前端 + 能力标签 + 头像 |

### Phase 4: 核心交互 (Day 10-14)
| Day | 交付 |
|-----|------|
| 10 | 自建 Agent（对话式创建 + System Prompt + 预置 Skill 库勾选） |
| 11 | Critic 需求澄清 + Planner 方案对比 (gate判断) + 前端 Plan 卡片 |
| 12 | 计划确认 DAG (轻量勾选+删除) + Pin 消息机制 + ContextCompactor |
| 13 | Orchestrator 迭代执行 + Middleware 链 (PinContext→LoopDetect→SubLimiter) |
| 14 | 反驳机制 + 失败降级 + TaskPipeline 面板 (CI风格) + **Day14 结束时跑最小化 demo**（群聊→澄清→选方案→完成 1 个 task），锁死核心链路 |

### Phase 5: 产物 + 可观测性 (Day 15-17)
| Day | 交付 |
|-----|------|
| 15 | 产物内联卡片 (Diff 卡片 + Preview 卡片 + Image 卡片) + DiffService |
| 16 | Monaco Diff 查看器 (modal) + 对话式局部修改 (选中→修改→Diff) |
| 17 | Trace 全链路埋点 + TracePanel 瀑布图 (Jaeger 风格) |

### Phase 6: 打磨 + 部署 (Day 18-20)
| Day | 交付 |
|-----|------|
| 18 | 完整 demo 流程排练 + bug fix |
| 19 | UI 打磨 (framer-motion 动画 / 暗色模式 / 骨架屏 / ErrorBoundary) + 阿里云部署 |
| 20 | 产品设计文档 + 技术文档 + ADR + 3 分钟录屏 + ai-collaboration 整理 |

---

## Smoke Test（每个 Phase 交付后必跑）

每个 Phase 结束前执行，确保主线不崩：

| Phase | Smoke Test |
|-------|-----------|
| P1 (Day 3) | `curl :8000/api/health` → 200 + `curl :8000/api/agents` → 返回预置 Agent 列表 + 浏览器打开 `:3000` 看到空白会话页 |
| P2 (Day 6) | 浏览器点 Agent → 发"hello"→ WS 实时回显 → 置顶会话 → 归档会话 → 搜索能找到 |
| P3 (Day 9) | 点 Claude → 发"写一个 hello world 函数"→ 流式看到代码 → OpenCode 同理 → DeepSeek 同理 |
| P4 (Day 14) | 群聊发"加认证"→ 看到 Clarify 反问 → 选方案 → 确认 DAG → TaskPipeline 有卡片 → 至少完成 1 轮 |
| P5 (Day 17) | Agent 生成代码 → 聊天流出现 Diff 卡片 → 点击打开 Monaco → TracePanel 有 span 记录 |
| P6 (Day 20) | 从头跑完整流程 1 遍，录屏备用 |

## E2E 测试（时间允许）

```bash
# Day 19-20 如果提前完成，用 playwright 写一个最简 E2E:
# 1. 打开页面 → 看到联系人列表
# 2. 点击 Agent → 发送消息 "hello"
# 3. 等待 WS 回复 → 断言消息出现在聊天流
# 跑通即止，不做复杂断言。
```

## 验证方案

1. **Day 3**: `python main.py` + `npm run dev` → `curl :8000/api/health` → 200 → Agent CRUD 写入 SQLite
2. **Day 6**: 浏览器 → 联系人列表 → 点击 Agent → 发消息 → WS 实时回显 → 置顶/归档/搜索
3. **Day 9**: Claude (Anthropic API) 联系人 → 发"写快排" → 流式返回代码 → OpenCode 同理
4. **Day 14**: 群聊"加认证"→ Critic 反问 → 方案 A/B/C → 确认 DAG → TaskPipeline 展示迭代 → Agent 反驳
5. **Day 16**: 选中代码行 → "改成 default export"→ Diff 卡片展示精准修改
6. **Day 17**: TracePanel 追溯 LLM 调用延迟 + token 消耗
7. **Day 20**: 3 分钟录屏：联系人列表 → 群聊 → 澄清 → 对比 → 执行 → 反驳 → Diff → 完成


---

## 预置 Skill 库

> 用户自建 Agent 时从预置 Skill 库勾选能力，每个 Skill 注入对应 system prompt 片段。

### 1. 代码生成 (code-generation)

**标签**: [代码生成]

**注入 Prompt**:
```
You are a code generation specialist. When writing code:
- Output complete, production-ready files with file paths
- Use appropriate design patterns for the task
- Include necessary imports and type annotations
- Prefer standard library solutions over third-party dependencies
```

### 2. 代码审查 (code-review)

**标签**: [代码审查]

**注入 Prompt**:
```
You are a code reviewer. When reviewing code, check for:
1. Correctness — does it do what was asked?
2. Security — any vulnerabilities (injection, XSS, exposed secrets)?
3. Performance — unnecessary allocations, N+1 queries, blocking I/O?
4. Readability — clear naming, appropriate comments, consistent style?
Be constructive. For each issue, explain WHY it matters and suggest a fix.
```

### 3. SQL 优化 (sql-optimization)

**标签**: [数据库] [SQL] [性能]

**注入 Prompt**:
```
You are a SQL optimization expert. When analyzing queries:
- Identify missing indexes and suggest CREATE INDEX statements
- Detect anti-patterns (SELECT *, implicit conversions, correlated subqueries)
- Rewrite queries for better execution plans
- Consider data volume and access patterns
- Explain the reasoning behind each optimization

You have access to a local SQLite database at {db_path} for EXPLAIN analysis.
```

### 4. 文档撰写 (documentation)

**标签**: [文档]

**注入 Prompt**:
```
You are a technical documentation writer. When creating docs:
- Write for the target audience (developer / end-user / ops)
- Include concrete examples, not just API signatures
- Structure with clear headings and tables where appropriate
- Use active voice and present tense
- State defaults, edge cases, and error conditions explicitly
```

### 5. Web 开发 (web-development)

**标签**: [Web开发] [全栈]

**注入 Prompt**:
```
You are a full-stack web developer. When building web applications:
- Frontend: prefer React + Tailwind CSS, ensure responsive design
- Backend: design RESTful APIs with proper status codes
- State management: keep it simple — useState until you need more
- Handle loading, empty, and error states explicitly
- Ensure keyboard accessibility and semantic HTML
```

### Skill 合并规则

1. 多个 Skill 的 prompt 片段按用户勾选顺序依次拼接
2. 拼接后追加：`"如果上述指令存在冲突，以最后勾选的 Skill 中的指令为准"`
3. 用户自定义 System Prompt 优先级最高（置于所有 Skill prompt 之前）

### Skill 使用示例

用户创建 "SQL 优化专家" Agent 时：
1. 起名 "SQL 优化专家"
2. 写 System Prompt "你专注于 MySQL 慢查询优化，擅长分析 EXPLAIN 输出"
3. 勾选 `sql-optimization` skill（自动注入 SQL 分析 prompt 片段） + `documentation` skill（生成优化报告用）
4. 创建完毕 → 出现在联系人列表，标签为 `[数据库] [SQL] [性能] [文档]`
