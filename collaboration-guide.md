# AgentHub 双人协作指南

> 两人都用 Claude Code 开发 | 目标：避免 AI 生成代码冲突，保持架构一致

---

## 分工策略

**按「接口契约」解耦，不按模块平均分。**

| 阶段 | 人 A（架构驱动） | 人 B（功能驱动） |
|------|-----------------|-----------------|
| Day 1-3 | DB 模型 + REST API 骨架 + WS 协议定义 | 前端脚手架 + 组件目录 + Zustand store 骨架 |
| Day 4-6 | EventBus + WS Manager + 后端 WS 路由 | useWebSocket + 基础聊天 UI + 会话列表 |
| Day 7-9 | 三个 Adapter | Agent 联系人列表前端 + 能力标签 + 头像 |
| Day 10-14 | Orchestrator + Middleware + 反驳机制 | Plan 卡片 + DAG 编辑器 + TaskPipeline 面板 |
| Day 15-17 | DiffService + Trace 埋点 | Diff/Preview 卡片 + Monaco + 对话式修改 |
| Day 18-20 | 部署 + 文档 | UI 打磨 + 动画 + 录屏 |

每个 Phase 开始前，两人先一起用 Claude Code 生成接口契约文件，各自基于同一份契约开工。

---

## 接口契约（最重要的同步机制）

在 `backend/app/schemas/` 下维护 `contracts.py`，包含：

- WS 消息类型枚举（C→S 和 S→C 完整列表）
- 每个消息的 payload Pydantic model
- API 响应标准格式

**每个 Phase 开始前先一起更新这份文件，各自以此为单点真理。** Claude Code 读到同一份契约，生成的代码自然对得齐。

---

## Git 工作流

```
main
├── contracts/          # 共享契约，两人一起维护
├── backend/
└── frontend/
```

**分支策略：**

```
feature/ws-core          # A: 后端 WS + EventBus
feature/chat-ui          # B: 前端基础聊天 UI
```

**三条铁律：**

1. **同一时间不碰同一个文件** — AI 生成代码改动大，merge 基本没救
2. **每天结束时 merge 到 main** — 当天解决冲突，不积压
3. **`.gitignore` 排除 `.claude/`** — 各自独立配置

---

## CLAUDE.md 分工声明

项目根 `CLAUDE.md` 加入：

```markdown
## 分工
- @人A: backend/app/core/, backend/app/services/adapters/, backend/app/ws/
- @人B: frontend/src/, backend/app/schemas/contracts.py
- 共享（修改需同步通知）: backend/app/models/, backend/app/schemas/
```

每个人的 Claude Code 读到边界，避免越界生成代码。

---

## 每日同步清单（10 分钟）

1. **今天改了哪些文件？** → 确认没人越界
2. **契约有变化吗？** → 更新 `contracts.py`，两人都 pull
3. **有什么设计决策？** → 记到 `ai-collaboration/journal.md`（也是比赛评分项）
4. **今天的 smoke test 跑通了吗？** → 按 overview.md 里的 smoke test 表格逐项过

---

## Claude Code 协作技巧

- **共享 Prompt 模板**：`ai-collaboration/prompts/templates.md` 维护常用 prompt，两人同一套风格
- **契约变更用 AI 传播**：`contracts.py` 更新后，各自让 Claude Code 读一遍然后「根据新契约更新相关文件」
- **避免同时大范围重构**：谁先开始改一个模块，另一个人就先不动

---

## 执行节奏

```
每个 Phase 第 1 天上午  → 两人一起讨论 + 更新契约 + 更新 CLAUDE.md
Phase 中间              → 各自开发，git commit message 暴露进度
                         → 架构决策立即同步，不各自猜
每个 Phase 最后 1 天    → 联调 + 跑 smoke test + 修 bug
```

---

**总结：契约先行 → 分支隔离 → 每日同步 → 最后联调。** 最大风险不是写得慢，而是两人 AI 各自生成了对协议的不同理解 — `contracts.py` 就是唯一真理来源。
