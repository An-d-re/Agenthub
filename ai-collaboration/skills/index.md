# AI Manager Skill Library

> 不是"给 AI 用的技能"。这是**你管理 AI 时可复用的协作模式**。每个 skill 定义了什么场景触发、输入给 AI 什么、期望 AI 产出什么、用什么规则约束。

---

## S1. independent-review — 独立评审

```yaml
触发: 需要客观评价完成度 / 代码质量 / 方案优劣
输入:
  - 评审标准（如 req.md 的评分维度）
  - "派生独立子 Agent，不要受主对话上下文影响"
输出:
  - 评分表（按维度的得分 + 理由）
  - 短板清单（具体到文件/功能）
  - 综合评价（≤500 字）
规则:
  - 子 Agent 不与主 Agent 共享上下文
  - 必须给出具体分数而非模糊评价
  - 短板的描述必须可操作（"XX 文件 XX 行有 XX 问题"）
```

## S2. batch-parallel-fix — 批量并行修复

```yaml
触发: 有多个独立 bug 列表需要修复
输入:
  - 问题列表（如"短板1、2、5、6"）
  - 优先级
输出:
  - 每个问题的修复 commit
  - 修复验证结果
规则:
  - 先并行探索所有相关文件，再顺序执行
  - 简单问题先做，复杂问题后做
  - 每完成一项立即标记完成（不批量标记）
  - 错误判断的项立即跳过（如"已挂载"就不动）
```

## S3. systematic-debug-loop — 系统性调试循环

```yaml
触发: 修复后 bug 仍存在，用户反馈"还是有问题"
输入:
  - 用户具体的症状描述（如"不仅没置顶，群聊全出来了"）
  - 上一轮修复的方案
输出:
  - 完整数据流追踪（前端→API→后端→返回）
  - 根因分析（不是表象修复）
  - 最小 diff 修复
规则:
  - 不相信上一次修复一定正确
  - 先追踪数据流，不局部改代码
  - 用 curl 直接调 API 排除前端/后端责任
  - 超过 3 轮无进展 → 换策略（写测试脚本 / 浏览器验证）
```

## S4. qa-driven-fix — QA 驱动的原子修复

```yaml
触发: 需要验证功能是否正常工作
输入:
  - 目标 URL
  - 测试范围（页面/功能列表）
输出:
  - QA 报告（健康评分 + 问题清单 + before/after 截图）
  - 每个 bug 一个 atomic commit（fix(qa): ISSUE-NNN — desc）
  - 修复后的健康评分
规则:
  - 工作区必须干净（先 commit 或 stash）
  - 每个 bug 一个 commit
  - 浏览器实际验证，不只读代码
  - 有 regression 立即 revert
```

## S5. incremental-fix-with-feedback — 增量修复 + 迭代反馈

```yaml
触发: 复杂功能需要多轮迭代
输入:
  - 每轮只给 1-2 条最关键的反馈
  - 启动服务让用户看效果
输出:
  - 最小可行版本 → 用户验证 → 精确定位 → 再修复
  - 每轮记录：尝试了什么 / 为什么失败 / 正确做法
规则:
  - 不做一揽子修复（改 5 个地方容易引入新 bug）
  - 用户反馈是最高优先级信号
  - 不要防御性解释，直接查问题
```

## S6. explore-before-build — 先探索再动手

```yaml
触发: 任何需要修改代码的请求
输入:
  - 需求文档（req.md / overview.md）
  - 相关代码区域
输出:
  - 上下文理解（已读的文件列表）
  - 实现方案（1-2 句话）
  - 代码修改
规则:
  - 先 Read/Grep/Glob 建立完整上下文
  - 简述方案等用户确认再动手
  - 不做"盲写"代码（没读过相关文件就改）
```

## S7. atomic-git — Git 操作原子化

```yaml
触发: 每次修改代码后
输入:
  - 修改的文件列表
  - 变更说明
输出:
  - 最小化 commit（只含相关文件）
  - commit message: type(scope): description
规则:
  - git add <specific-files>，永远不用 -A
  - 一个 commit 只做一件事
  - 破坏性操作必须用户确认
  - 测试脚本等不提交的文件尊重用户决策
```

---

## S8. run-tests — 自动化回归测试

```yaml
触发: /run-tests 或 /run-tests <用例名>
输入:
  - tests/cases/ 下的 Markdown 测试用例（frontmatter + 自然语言步骤）
  - gstack browse 二进制（浏览器驱动）
输出:
  - conversation.md（会话导出 + 执行摘要）
  - screenshots/（关键节点截图）
  - 批次摘要报告（用例×状态×产物路径）
规则:
  - 所有浏览器操作必须通过 gstack 二进制，禁止退化为 Python 脚本
  - 每个用例前 restart 浏览器防污染
  - 任务完成判断：先查 API 拿期望任务总数，不能只数 store
  - 单方案场景：后端不发 plan.comparison，按钮直接是"确认执行"
  - 一个用例失败不影响后续
```

**实测案例**: 在 AgentHub 项目中运行 8 个测试用例，覆盖群聊计算、方案对比、DAG 执行等核心链路。从 MCP Playwright 切换到 gstack browse 后，token 消耗降低约 70%。

→ 详细定义: [run-tests.md](run-tests.md)

## S9. debug-session — 群聊会话诊断

```yaml
触发: /debug-session <session_id>，用户反馈"任务没执行""卡住了"等异常
输入:
  - session_id（UUID）
  - diagnostics API + orchestrator log 并行采集
输出:
  - 根因报告：当前状态 + 任务进度 + 问题清单（问题→根因→修复建议）
  - 日志关键事件时间线
规则:
  - Step 1 并行采集两个数据源，不等串行
  - Step 2 按 5 维度交叉校验（Phase/DAG/依赖/Agent/错误信号）
  - Step 3 输出可操作的修复建议（含文件路径）
  - 内置已知故障模式表，每次踩坑后追加
```

**实测案例**: 置顶功能 4 轮调试——第 1 轮字段名匹配、第 2 轮乐观更新冲突、第 3 轮发现 refreshSessions 未在 mount 调用（真正根因）。每个阶段都靠诊断精确定位。

→ 详细定义: [debug-session.md](debug-session.md)

## S10. grill-with-docs — 需求深挖与设计对齐

```yaml
触发: /grill-with-docs，或"帮我分析需求""看看还有什么遗漏"
输入:
  - 用户的模糊需求描述
  - 项目已有文档（CONTEXT.md、ADR、specs）
  - 相关代码文件（可探索验证）
输出:
  - 完整的需求规格（术语统一、边界明确、场景覆盖）
  - 如有必要，更新 CONTEXT.md 术语表或 ADR
规则:
  - 一次只问一个问题，给出建议答案等用户确认
  - 代码库能回答的 → 直接探索，不问用户
  - 按术语→边界→场景→代码验证的顺序逐层深挖
  - AI 给建议但不替用户做决策
```

**实测案例**: 本次 run-tests 优化——通过 grill-with-docs 逐层确认：MCP 烧 token 根因 → gstack 切换可行性 → 风险防护措施 → 产物精简策略 → UI 常量提取方案。最终从 216 行 SKILL.md 精简到 103 行，同时提升可靠性。

→ 详细定义: [grill-with-docs.md](grill-with-docs.md)

---

## 业界框架映射

我们的 Skill 体系与业界"AI 增强开发三件套"（OpenSpec / Superpowers / gstack）吻合：

| 层级 | 业界工具 | 我们的 Skill | 解决的问题 |
|------|---------|-------------|-----------|
| **规格层** | OpenSpec | S10 grill-with-docs | 需求模糊、上下文不持久 |
| **执行层** | Superpowers | Plan Mode + Claude Code | Agent 急着写、流程缺纪律 |
| **交付层** | gstack | S8 run-tests + S9 debug-session | Review/QA/发布易跳过 |

我们不是简单地使用这些工具，而是在理解其设计思想后，针对 AgentHub 的具体场景定制了自己的 skill。这体现了"将 AI 纳入工程流程"而非"把 AI 当一次性代码生成器"的核心方法论。

## Skill 使用频率

| Skill | 使用次数 | 典型场景 |
|-------|---------|---------|
| grill-with-docs | 每次新任务 | 需求澄清第一步 |
| explore-before-build | 每次对话 | 所有任务的前置步骤 |
| atomic-git | 每次提交 | 每个 commit |
| run-tests | 4 次 | 06-07~06-09 测试执行 + 优化迭代 |
| qa-driven-fix | 3 次 | QA 测试、修复验证 |
| debug-session | 3 次 | 置顶功能、第二条消息无响应、clarify 误判 |
| systematic-debug-loop | 2 次 | 置顶功能、第二条消息无响应 |
| batch-parallel-fix | 2 次 | 4 短板修复、14 bug 修复 |
| incremental-fix-with-feedback | 贯穿全程 | 整个 12 天开发周期 |
| independent-review | 1 次 | 项目完成度评审 |
