# run-tests — AgentHub 自动化回归测试

> **设计背景**: 项目进入打磨期后，每次代码修改都需要在浏览器中手动验证核心链路（群聊协作、方案对比、DAG 执行），耗时且容易遗漏。需要一个可一键触发的自动化回归测试体系。
>
> **核心决策**: 初期使用 Playwright MCP 工具驱动浏览器，发现 `browser_snapshot` 每次返回完整 DOM 树消耗数千 token。经过分析后切换到 gstack browse 二进制（`$B snapshot -i` 只返回可交互元素 + @e 短引用），单次调用 token 消耗降低约 70%。产物收集从 6 项精简为 2 项（conversation.md + screenshots），因为 Agent 代码输出已在对话消息中可见。
>
> **所属层级**: gstack 交付闭环（QA + Review）

---

## 触发

`/run-tests` 或 `/run-tests <用例名>...`

## UI 常量（改 UI 时只需改这里）

- 封面开始按钮: `"开始使用"`
- 方案选择按钮: `"选择方案"` 前缀匹配
- DAG 确认按钮: `"确认执行"` 精确匹配
- 已选择标记: `"✓ 已选择"` / 已确认标记: `"已确认 ✓"`

## 阶段 0：解析参数

`/run-tests` → `tests/cases/` 下所有 `.md`（跳过 `_TEMPLATE.md` 和 `_` 开头）。`/run-tests A B` → 按 id/文件名匹配。创建批次目录 `tests/test-output/YYYY-MM-DD_HH-MM/`。

## 阶段 1：前置检查 + 启动服务

### 1.1 gstack browse 可用性

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); B=""
[ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/browse/dist/browse" ] && B="$_ROOT/.claude/skills/gstack/browse/dist/browse"
[ -z "$B" ] && B="$HOME/.claude/skills/gstack/browse/dist/browse"
[ -x "$B" ] && $B status || echo "NEEDS_SETUP"
```
`NEEDS_SETUP` → `cd ~/.claude/skills/gstack && ./setup` 后重试。仍失败则报错退出。成功 → `$B restart` 清残留。

### 1.2 启动服务

```bash
taskkill //F //IM python.exe 2>/dev/null; taskkill //F //IM node.exe 2>/dev/null
cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 &
cd frontend && npm run dev &
```
轮询 `curl -s localhost:8000/api/agents` 和 `localhost:3000`（每 2s，≤60s）。任一超时则报错退出。

## 阶段 2：执行测试用例

### 2.1 解析用例 + 准备环境

读 Markdown 提取 frontmatter（`id/name/type/timeout` 默认 600）、设置、步骤、重点截图、清理。

步骤格式：**`用户：xxx`**=发送消息（第一条触发测试）、**`(指令)`**=行为指令、**`Agent名：xxx`**=仅记录不匹配（`xxxxx`=任意值）、**无前缀**=注释忽略。

准备：有预设 Agent → `POST /api/agents` 创建并记录映射。`POST /api/sessions` 创建 Session。`$B goto http://localhost:3000`，`$B snapshot -i` 检测 `"开始使用"` → 可见则 `$B click @eN` 等 0.8s。Zustand 激活 session：`$B js "window.__CHAT_STORE__.getState().setActiveSession('{id}')"`。

### 2.2 执行步骤

**所有浏览器操作必须通过 `$B` 二进制，禁止退化为 Python/Node 脚本。** 脚本固定逻辑无法应对 DOM 多分支，会导致空转。

通用模式：`$B snapshot -i` → 判断 → `$B click/fill/type @eN` → `$B snapshot -D` 验证。

以下 3 种步骤有**非直觉陷阱**，严格按此执行：

| 步骤 | 陷阱 & 正确做法 |
|------|----------------|
| `(等待 PlanCard 出现后点击...)` | **单方案时后端不发送 `plan.comparison`，按钮直接是"确认执行"**。用 `$B js` 同时检测 `"选择方案"` 前缀和 `"确认执行"`，不要死等选择方案按钮 |
| `(用户确认)` | 用 `$B js` 检测当前 DOM 按钮文本，有"选择方案"→点击第一个→等 DAG，有"确认执行"→直接点确认 |
| `(等待所有任务完成后截图)` | **task 依赖链导致分批出现，pending 状态不发 task.update，不能只数 store**。必须先 `GET /api/sessions/{id}` 拿期望任务总数，store 中 task 数=期望数且全部 done/failed/cancelled 才算完成 |

其余步骤（发消息、记录 Agent 发言、观察 Critic/Planner、等任务结束）按常识执行。**Critic 已发言检测**：`$B js` 查 DOM 中 `.agent-role-critic` 元素存在。

超时：观察 60s、计划 120s、整体≤`timeout`。超时跳过不中断。

### 2.3 自动截图

`plan.comparison`→`plan-comparison.png` / `plan.confirmed`→`plan-confirmed.png` / `task.update`→`task-{name}-{status}.png` / 结束→`final.png`。用例"重点截图"额外保存到 `screenshots/`。

## 阶段 3：收集产物

只收集两项——代码已在 Agent 消息中，无需单独拉 artifacts：

- **conversation.md**：`GET /api/sessions/{id}/export` + 末尾追加执行摘要
- **screenshots/**：所有截图

仅出错时额外保留 `$B console` 输出。

## 阶段 4：清理 + 关闭 + 摘要

清理：按用例指令执行（`删除创建的Agent`→`GET /api/agents` 找 `is_temp=true`+预创建；`删除session`→`DELETE`）。清理失败不中断。

关闭：`taskkill //F //IM python.exe 2>/dev/null; taskkill //F //IM node.exe 2>/dev/null`

摘要格式：

```markdown
## 测试批次 YYYY-MM-DD_HH-MM 执行完毕
| 用例 | 状态 | 产物路径 |
|------|------|---------|
| xxx | ✅/⚠️/❌ | tests/test-output/.../ |
```

执行摘要追加在 conversation.md 末尾：用例 ID、执行时间、总耗时、消息数、步骤/任务状态表、异常。

## 关键注意事项

- **@e 引用导航后失效**：每次 `$B goto` 后必须重跑 `$B snapshot -i`
- **Zustand store 不可靠**：浏览器重开时历史 WS 事件不重放，用 `$B js` 检测 DOM 而非 store
- **每个用例前 `$B restart`**：防 cookie/storage 污染
- **一个用例失败不影响后续**
- **REST API 用 curl**（已在白名单）

## 演进记录

| 日期 | 变更 | 决策理由 |
|------|------|---------|
| 06-06 | 首次创建，MCP Playwright 驱动 | 需要自动化回归测试 |
| 06-07 | 扩展至 8 个测试用例 | 覆盖核心链路 |
| 06-09 | MCP→gstack browse 二进制 | token 消耗降低 ~70% |
| 06-09 | 产物 6 项→2 项 | Agent 代码已在对话消息中 |
| 06-09 | SKILL.md 216 行→103 行 | 精简冗余，提取 UI 常量 |
