# run-tests — AgentHub 自动化回归测试

## 概述

执行 `tests/cases/` 下的测试用例，用 Playwright MCP 驱动浏览器模拟真实用户操作，保存完整产物供人工审阅。审阅后发现的问题通过 `/debug-session` 诊断。

## 何时使用

用户输入 `/run-tests` 或 `/run-tests <用例名>...` 时触发。

## 执行流程

### 阶段 0：解析参数

- `/run-tests` → 执行 `tests/cases/` 下所有 `.md` 文件（跳过 `_TEMPLATE.md` 和 `_` 开头文件）
- `/run-tests flask-todo 计算任务` → 按 `id` 或文件名匹配，执行指定用例
- 创建批次目录 `tests/test-output/YYYY-MM-DD_HH-MM/`

### 阶段 1：启动服务

1. `taskkill //F //IM python.exe 2>/dev/null; taskkill //F //IM node.exe 2>/dev/null` 清理旧进程
2. 启动后端：`cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000`（后台运行）
3. 启动前端：`cd frontend && npm run dev`（后台运行）
4. 轮询 `curl -s http://localhost:8000/api/agents` 和 `curl -s http://localhost:3000` 等待就绪（每 2 秒一次，最多 60 秒）

### 阶段 2：执行测试用例

对每个用例，按以下子步骤执行：

#### 2.1 解析用例

读取 Markdown 文件，提取：
- **frontmatter**：`id`, `name`, `type`（group/single）, `timeout`（默认 600）
- **设置**：需要预创建的 Agent 列表
- **步骤**：混合格式（见下方"步骤解析"）
- **重点截图**：额外的截图节点（可选）
- **清理**：清理指令

#### 2.2 准备环境

- 如果"设置"中列出 Agent：通过 `POST /api/agents` 逐一创建，记录名称→id 映射
- 创建 Session：`POST /api/sessions`，type 取 frontmatter 的 `type` 字段，加入预创建的 Agent
- 用 Playwright MCP 打开 `http://localhost:3000`，通过 Zustand store 激活当前 session
- **封面页处理**：新浏览器上下文没有 sessionStorage，封面页（`.cover-container`）会自动显示。检测 `button:has-text('开始使用')` 是否可见，如可见则点击并等待 0.8s 消散动画完成。

#### 2.3 执行步骤

逐条解析步骤内容，按类型分发：

| 行模式 | 类型 | 操作 |
|--------|------|------|
| `用户：消息内容` | 发送消息 | 在输入框输入消息，点击发送。**第一条 `用户：` 消息触发测试正式开始。** |
| `(等待 PlanCard 出现后点击第一个方案)` | 等待+点击 | 轮询 DOM 中出现 `.plan-card` 或匹配的元素，点击第一个方案按钮 |
| `(等待 DAG 确认后点击确认)` | 等待+点击 | 等待 DAG 面板渲染，点击确认/执行按钮 |
| `(等待所有任务完成后截图)` | 等待+截图 | 轮询 task 状态直到全部 done/failed，然后截图 |
| `(Critic自行判断是否需要继续细问需求)` | 观察等待 | 等待 60 秒内是否有 Critic 消息，在摘要中标记"Critic 已发言/未发言" |
| `(Planner提供计划方案)` | 观察等待 | 等待 WS 收到 `plan.comparison` 或 Planner 消息，超时 120 秒 |
| `(用户确认)` | 执行动作 | `plan.comparison` 出现后点击第一个方案 |
| `(任务结束)` | 等待结束 | 轮询直到所有 task 状态为 done/failed/cancelled，超时用用例的 `timeout` |
| `Agent名：对话内容` | 纯记录 | **不做任何匹配**，由人工审阅。`xxxxx` 为用户标注的任意值占位 |
| 其他 `(描述)` | 自定义动作 | 按照自然语言描述执行 |

**超时处理**：每个等待操作有独立超时（观察等待 60s，计划等待 120s，整体不超过 `timeout`）。超时后标记跳过，继续下一步骤，不中断整个用例。

#### 2.4 自动截图节点

以下 WS 事件自动触发截图（无需用例声明）：

| WS 事件 | 截图命名 |
|---------|---------|
| `plan.comparison` 到达 | `screenshots/plan-comparison.png` |
| `plan.confirmed` 到达 | `screenshots/plan-confirmed.png` |
| 每个 `task.update`（status 变化） | `screenshots/task-{task_name}-{status}.png` |
| 每个 `artifact.created` | `screenshots/artifact-{artifact_name}.png` |
| 测试结束 | `screenshots/final.png` |

用例"重点截图"中指定的额外节点也保存在 `screenshots/` 下。

### 阶段 3：收集产物

执行完成后，收集以下产物到 `tests/test-output/<批次>/<case-id>/`：

```text
<case-id>/
├── conversation.md     # 导出 API 内容 + 末尾追加测试执行摘要
├── artifacts/          # GET /api/artifacts?session_id=xxx 拉取的文件
├── screenshots/        # 所有截图
├── console.log         # 浏览器 console 输出
├── network.json        # 关键 WS 和 HTTP 请求摘要
└── raw_messages.json   # GET /api/sessions/{id}/messages 原始消息（备用）
```

### 阶段 4：清理

按用例的"清理"指令执行：

- `删除创建的Agent`：删除"设置"中预创建的 Agent 以及执行过程中 Planner 创建的临时 Agent（通过 `GET /api/agents` 找 `is_temp=true` 的）
- `删除session`：`DELETE /api/sessions/{id}`
- 如用例未写清理指令，默认保留 session 和 agent 供后续人工检查

### 阶段 5：关闭服务

所有用例执行完毕后：

1. `taskkill //F //IM python.exe` 停止后端
2. `taskkill //F //IM node.exe` 停止前端

### 阶段 6：输出批次摘要

在聊天中报告：

```markdown
## 测试批次 2026-06-04_15-30 执行完毕

| 用例 | 状态 | 产物路径 |
|------|------|---------|
| 计算任务 | ✅ 完成 | tests/test-output/2026-06-04_15-30/000-计算任务/ |
| flask-todo | ⚠️ 超时（第 4 步） | tests/test-output/2026-06-04_15-30/flask-todo/ |
```

**状态定义**：
- ✅ 完成：全部步骤执行完毕
- ⚠️ 超时：某步骤超时但已跳过
- ❌ 崩溃：服务挂掉或浏览器异常，用例中断

## 步骤解析规则

测试用例的"步骤"节使用混合格式：

- **`用户：xxx`** — 用户发出的聊天消息。如果是该用例第一条，触发 Session 创建和测试开始。
- **`(指令)`** — 行为指令，skill 按指令描述执行（等待元素、点击、截图、观察等）。
- **`Agent名：xxx`** — 预期对话，**仅记录不匹配**。Agent 名按发言顺序对应（第一个发言 Agent → 计算Agent，第二个 → 验证Agent，以此类推）。对话中带 `xxxxx` 表示该处为任意值。
- **无前缀的文本** — 视为注释，忽略。

## 对话记录格式

conversation.md 中每条消息的格式：

```markdown
### [角色名]
<!-- role=agent | agent_id=`uuid` -->
消息内容
```

execution summary 追加在 conversation.md 末尾：

```markdown
---

## 测试执行摘要

- **用例 ID**：000
- **执行时间**：2026-06-04 17:55:00
- **总耗时**：3m42s
- **消息数**：12
- **步骤执行状态**：

| 步骤 | 类型 | 状态 | 备注 |
|------|------|------|------|
| 1. 用户发送消息 | 发送 | ✅ | |
| 2. Critic判断是否需要细问 | 观察等待 | ✅ Critic 未发言（正常） | |
| 3. Planner提供计划方案 | 观察等待 | ✅ Planner 已发言 | |
| 4. 用户确认 | 执行 | ✅ 已点击第一个方案 | |
| 5. 计算Agent发言 | 记录 | ✅ 已记录 | |
| 6. 验证Agent发言 | 记录 | ✅ 已记录 | |
| 7. 任务结束 | 等待 | ✅ 全部任务 done | |

- **任务状态**：

| 任务 | 最终状态 | 耗时 |
|------|---------|------|
| 计算任务 | done | 45s |
| 验证任务 | done | 52s |

- **Artifact 列表**：无
- **异常**：无
- **截图**：4 张
```

## 注意事项

- 使用 Playwright MCP 操作浏览器，优先用 `browser_click`、`browser_type`、`browser_snapshot` 等方法
- REST API 调用使用 `curl`（已在 settings.local.json 白名单中）
- 前端通过 Zustand store 切换 session（`window.__CHAT_STORE__.getState().setCurrentSessionId(id)`）
- 如果后端或前端启动失败（端口就绪超时 60 秒），报告错误并退出，不执行任何用例
- 一个用例失败不影响后续用例执行
- 清理阶段即使失败也继续（可能 Agent 已被删除等情况）
