# debug-session — AgentHub 群聊会话诊断

> **设计背景**: AgentHub 的群聊协作涉及四阶段状态机（clarify→comparison→confirmed→executing）、多 Agent 并行调度、WebSocket 实时通信、任务依赖链等多层复杂度。当用户反馈"任务没执行""Agent 没回复""卡在某个阶段"时，单靠看代码或日志很难快速定位。需要一个系统化的诊断工具，并行采集数据 + 交叉校验 + 给出根因。
>
> **核心决策**: 诊断分为三步——Step 1 并行采集（diagnostics API + orchestrator log grep），Step 2 按 5 个维度交叉校验（Phase 推进/DAG 一致性/任务依赖/Agent 分配/错误信号），Step 3 输出根因报告。内置已知故障模式表，每次踩坑后追加新 pattern，形成"经验积累→自动诊断"的正循环。
>
> **所属层级**: gstack 交付闭环（Debug + Retro）

---

## 触发

`/debug-session <session_id>`

用户反馈 AgentHub 群聊中出现意外行为时使用。如果用户未提供 session ID，先询问（可在测试用例 Markdown 文件头找到：`会话 ID：xxx`）。

## Step 1: 并行采集原始数据

```bash
# 1. Diagnostics API — 完整内部状态
curl -s "http://localhost:8000/api/sessions/{session_id}/diagnostics" | python -m json.tool

# 2. Orchestrator log — 仅该 session 的行
grep "{session_id_short}" "F:/AgentHub Project/agenthub/backend/logs/orchestrator.log" | tail -50
```

(session_id_short = UUID 前 8 字符)

## Step 2: 交叉校验清单

### A. Phase 推进

- `plan.phase` 是否匹配预期？
- 日志中找 `>>> 进入阶段` 和 `--> 自动推进` 行
- 卡在 `clarify` 且无 Agent → Bug C（no-agent loop），`clarify_round` 应在 2 轮后自动推进
- 卡在 `confirmed` → DAG 已发前端但用户未确认（或 confirm_plan 崩溃）

### B. DAG 与 TaskDB 一致性

- 对比 `plan.dag` items 与 `tasks` 数组
- 每个 DAG entry 应有对应 TaskDB 记录（按 title）
- `dag_length > 0` 但 `tasks` 为空 → DAG 已持久化但 Task 记录未创建（Bug A: `td is None`）
- DAG 中缺 `_db_id` → Task 创建部分失败

### C. 任务依赖链

- `dependencies` 数组中每个 `depends_on` 应匹配一个 task `db_id`
- 日志中关注：
  - `调度: 执行 N 个就绪任务` — 执行了几轮？
  - `not all done, re-running for next batch` — 递归调度是否工作？
  - 只有一轮执行但 tasks 有 pending → **MissingGreenlet bug**（递归调用崩溃）

### D. Agent 分配

- TaskDB 中 `assigned_agent_id = null` 的任务为孤儿
- 检查 `agents` 数组：临时 Agent 的 `capability_tags` 应与其任务匹配
- Agent 已创建（日志有 `Created temp agent`）但任务仍 `assigned: NONE` → confirm_with_assignments 未持久化

### E. 日志错误信号

| 信号 | 含义 |
|------|------|
| `MissingGreenlet` | aiosqlite/greenlet 崩溃（executing.py: ctx.plan refresh after commit） |
| `Task exception was never retrieved` | 后台 asyncio.Task 异常被吞 |
| `_decompose: 跳过非 dict` | LLM 返回 null/无效 JSON |
| `没有可用的 Agent` | session 无 Agent，自动创建失败 |

## Step 3: 输出根因报告

```
## 诊断报告 — Session {id}

**当前状态**: phase={phase}, status={status}
**任务进度**: {done_count}/{total_count} 完成

**发现的问题**:
1. [问题描述] → [根因] → [修复建议]

**日志关键事件**:
- HH:MM:SS 事件1
- HH:MM:SS 事件2
```

如发现代码 bug（非配置/用户错误），主动询问是否修复。

## 已知故障模式

| Pattern | 症状 | 根因 | 修复 |
|---------|------|------|------|
| **MissingGreenlet** | task-2 卡在 pending，UI 无错误 | `ctx.plan.session_id` 在 `commit()` 后访问，aiosqlite 惰性加载失败 | executing.py: cache session_id + commit 后 refresh plan |
| **NoneType DAG** | `'NoneType' object is not subscriptable` at confirmed.py | LLM 返回 `[null, {...}]`，`td is None` | 加 `isinstance(td, dict)` guard |
| **Stale pyc** | 修复已部署但旧行为仍存在 | Windows `pkill` 无法杀原生 Python；`.pyc` 残留 | `taskkill //F //IM python.exe` + 清 `__pycache__` |
| **No-agent loop** | "请添加 Agent" 无限重复 | `clarify_round` 存在 `task_dag` dict 中，无 Agent 时永不递增 | `clarify_round` 独立 Integer 列 |
| **Type mixing** | `task_dag` 有时是 dict 有时是 list | Clarify 存 `{"clarify_round": N}`，confirmed 存 `[{...}]` | `clarify_round` 移出 task_dag |

## 设计哲学

- **并行采集优先**：两个数据源同时拉取，不等串行
- **交叉校验而非单点判断**：API 状态和日志互相印证，避免盲区
- **经验持续积累**：每次踩坑 → 追加 pattern → 下次自动命中
- **输出可操作**：不只说"有问题"，给出文件路径 + 修复方向
