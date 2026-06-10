# AI 协作演化记录

> 11 个工作日的真实演化过程。每条发现可追溯到 git commit 或对话记录。

## 阶段一：架构搭建（05-23 ~ 05-25，~20 commits）

### 项目从零起步

```
7eabe6f 搭建骨架 → 432440c 基础设施 → d0d36b3 消息流闭环
→ 7dbdbf1 四阶段交互模型 → f5e50b2 UI + 自建Agent + 群聊
```

### 发现 #1：轻量通信比引入中间件更合适

**最初考虑**: socket.io + Redis Pub/Sub + PostgreSQL（见 journal 05-22 决策记录）。

**实际落地**: FastAPI 原生 WebSocket + `asyncio.Queue` + SQLite。单机部署不需要 Redis，socket.io 对 FastAPI 多余，SQLite 零配置零运维。最终只用了 `uvicorn` 一个进程就撑起了整个后端。

→ 相关 commits: `d0d36b3` 消息流闭环, `7dbdbf1` Orchestrator

### 发现 #2：文本协议不可靠，结构化协议才能消除竞态

**现象**: 最初 PlanCard 选择方案是"把方案名当聊天文本发送，后端用正则匹配"（`a03d4b6` commit message）。用户多发一条消息就触发重新匹配，方案选择和普通聊天产生竞态。

**解决**: PlanCard 点击直接发送 `plan.action select_approach` WebSocket 消息，前端不再发聊天文本。后端新增 `select_approach()` 方法精确匹配方案名/序号。

→ commit: `a03d4b6` PlanCard 方案选择直连 WebSocket

### 发现 #3：批处理不是好模式——同一 commit 包含太多变更

05-24 ~ 05-25 的几个 commit（`0a00ecc`、`aabfc0f`、`3822db7`、`ab19442`）每个都包含 5+ 个不相关的功能改动。这在后来 06-02 的 QA 修复中被纠正为"一个 bug 一个 commit"。

→ 教训沉淀为 Git 纪律：`git add <specific-files>`，一个 commit 只做一件事

## 阶段二：架构升级（05-26 ~ 05-29）

### 发现 #4：God Object 拆分为 Phase Handler

**现象**: `orchestrator.py` 用 `if phase == "clarify" elif phase == "comparison" ...` 做路由，所有逻辑挤在一个文件里。新增 phase 要改主逻辑。

**解决**: 拆分为 `core/phases/` 目录，每个 phase 独立 Handler，`PHASE_REGISTRY` 字典注册路由。设计思想来自 gstack 的 "thin harness, fat skills"。

→ commit: `570c301` 6 个 Phase 全部实现

### 发现 #5：DeepSeek 思维链可以可视化

**现象**: 使用 DeepSeek API 时发现响应中有 `reasoning_content` 字段，但最初被丢弃了。

**解决**: 开启 `thinking: {type: "enabled"}`，新增 `chat.stream.reasoning` 事件类型，前端 `ReasoningBlock` 折叠式面板展示推理链。这让 Agent 的"思考过程"对用户可见，调试和理解都更方便。

→ commit: `fbe3590` 深度思考可视化

### 发现 #6：并行 Agent 审计发现人类 Code Review 的盲区

**方法**: 同时派出 2 个 Explore Agent，一个审后端 27 个文件，一个审前端 22 个文件，输出含文件路径 + 行号的 bug 清单。

**发现的 14 个 bug 覆盖 5 个维度**: 逻辑错误（无限重试、文本确认不执行）、安全问题（路径穿越）、并发问题（信号量泄漏、DB 锁竞争）、UX 问题（isThinking 卡死、token 覆盖）、运维问题（沙箱未清理）。

→ commit: `fbe3590` 14 个 bug 修复, `d04a690` 安全审计修复

**关键教训**: AI 审计能发现人类容易漏的"交互层"bug——状态机卡死、事件覆盖、初始化遗漏。但 14 个中有 1 个误判，需要人工交叉验证。

## 阶段三：QA 驱动密集修复（05-31 ~ 06-02）

### 发现 #7：同一类型 bug 反复出现——缺少预防规则

**现象**: 字段命名不一致（snake_case vs camelCase）先后在 `agent_count`、`pinned_at`、`last_message_preview` 三个字段上出现。JavaScript 静默返回 `undefined` 而不报错，功能全坏但无任何错误提示。

**根因**: AI 写新字段时没有自动检查前后端一致性。

**解决**: 沉淀为 `rules/contract-safety.md`：后端 snake_case = 前端字段名，加字段必须两头检查。之后同类 bug 零发生。

→ commits: `b1f340f` QA 5 bugs, `3b329d6` FINDING-2,3

### 发现 #8：工具注册的错误最难排查

**现象**: 文件写入功能完全不工作，但没有任何错误日志——Agent 调用 `write_file` 工具，实际执行的却是 `_safe_path` 函数（路径校验函数被错误注册为文件写入处理器）。

**根因**: `register_tool("write_file", self._safe_path)` 而非 `register_tool("write_file", self.write_file)`。函数名写错，Python 不报错（都是 callable），但行为完全不对。

→ commit: `2e5329c` CRITICAL — write_file tool registered wrong handler

**关键教训**: 工具注册表的 handler 映射无法靠类型系统校验。这类"静默替换"bug 只能靠端到端测试发现——恰好印证了 run-tests skill 的必要性。

### 发现 #9：不同模型对 OpenAI 兼容协议的实现有差异

**现象**: DeepSeek 在 `tool_choice="required"` 时表现异常，不调用工具就开始回复。最初不确定是 API 差异还是 prompt 问题。

**解决**: 经过 4 轮迭代——尝试 `tool_choice="required"` → 失败 → 加强 prompt → 仍失败 → 改为 `tool_choice="auto"` + 在 system prompt 中强制要求工具调用 → 成功。同时处理了 DeepSeek 特有的 DSML 格式 tool call（从 text content 中解析而非标准的 tool_calls 字段）。

→ commits: `64090b1` force tool_choice, `a148b3e` stronger tool-usage, `a2f4f4d` parse DSML, `86d199b` inject CODER_TASK_PROMPT

## 阶段四：测试体系 + 方法论沉淀（06-06 ~ 06-09）

### 发现 #10：测试从临时脚本演进到结构化 Skill

**第一代**（早期）: 临时 Python/Node 脚本，固定逻辑，DOM 一变就卡死。

**第二代**（06-06）: run-tests skill + MCP Playwright。交互式 DOM 操作，能根据实际状态决策。但 `browser_snapshot` 返回完整 DOM 树，每次调用消耗数千 token。

**第三代**（06-09）: 切换到 gstack browse 二进制。`$B snapshot -i` 只返回可交互元素 + @e 短引用，单次调用从数千 token 降到几十 token。SKILL.md 同步精简 216→103 行。

→ commits: `5f9bd0a` skill 创建, `152fb31` E2E 8 用例

### 发现 #11：故障诊断需要系统化

**问题**: 群聊协作涉及四阶段状态机 + 多 Agent 并行 + WS 实时通信 + 任务依赖链，bug 排查靠看日志和代码效率极低。置顶功能一个 bug 经历了 4 轮调试才找到根因。

**解决**: debug-session skill：Step 1 并行采集（diagnostics API + orchestrator log）→ Step 2 5 维度交叉校验（Phase/DAG/依赖/Agent/错误信号）→ Step 3 根因报告。内置已知故障模式表，每次踩坑追加新 pattern。

→ commit: `5f9bd0a` debug-session skill 创建

### 发现 #12：工具选择决定 AI 协作效率

**现象**: `/run-tests` 8 个用例跑下来上下文窗口频繁接近上限。

**分析**: 不是 SKILL.md 太长（216 行），而是每次 `browser_snapshot` 返回完整 DOM。完整 DOM 中 95% 的信息对测试无用。这和人看 dashboard 而非原始日志是同一个道理——好的工具应该预处理信息，把"完整数据"压缩为"可决策信号"。

**解决**: MCP Playwright → gstack browse 二进制。同时精简产物收集（6 项→2 项），因为 Agent 代码输出已在对话消息中。

**结果**: token 消耗降低约 70%。

→ 本日对话记录

## 演化趋势

```
协作效率
  │
  │                                   ┌─ gstack 优化 (06-09)
  │                          ┌─ 测试体系 (06-06)
  │                 ┌─ QA 驱动 (06-02)
  │        ┌─ 架构升级 (05-26)
  │   ┌─ 基础搭建 (05-23)
  │  /
  │ /
  │/
  └──────────────────────────────────────── 时间
  Day1    Day3    Day5    Day7    Day9   Day11
```

核心模式：**每次踩坑 → 沉淀为规则或 skill → 下次不再犯**。从临时脚本到 skill 体系，从 God Object 到 Phase Handler，从含糊需求到 grill-with-docs 反问——每一步都在上一阶段的基础上叠加。
