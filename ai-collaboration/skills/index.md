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

## Skill 使用频率

| Skill | 使用次数 | 典型场景 |
|-------|---------|---------|
| explore-before-build | 每次对话 | 所有任务的第一步 |
| atomic-git | 每次提交 | 每个 commit |
| qa-driven-fix | 3 次 | QA 测试、修复验证 |
| systematic-debug-loop | 2 次 | 置顶功能、第二条消息无响应 |
| batch-parallel-fix | 2 次 | 4 短板修复、14 bug 修复 |
| incremental-fix-with-feedback | 贯穿全程 | 整个 12 天开发周期 |
| independent-review | 1 次 | 项目完成度评审 |
