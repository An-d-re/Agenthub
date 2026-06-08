# AI 协作演化记录

> 核心发现：每次踩坑都是系统性问题。记录下来 → 提炼规则 → 下次不再犯。12 天 89 条决策记录提炼如下。

## 阶段一：建立基础协作范式（Day 1-3）

### 发现 #1：AI 容易漏需求，理解偏差大

**现象**: "帮我写个登录页面" → AI 产出无验证、无错误处理、无响应式的代码

**根因**: 自然语言需求太模糊，AI 会填补空白但填补的不对

**解决**: 引入 Feature Spec 模板。每个功能开始前必须填写 goal/scope/constraints/acceptance
→ 文件: `specs/index.md`

**结果**: AI 首次输出可用率从 ~40% 提升到 ~70%。减少了"少了验证逻辑"和"没做移动端"类问题

### 发现 #2：AI 生成代码风格不统一

**现象**: 同样的 React 组件，有时用 class component 有时用 function，有时用 CSS module 有时用 Tailwind

**根因**: 没有明确编码规范约束 AI

**解决**: 建立 `rules/coding-standards.md`，写入 CLAUDE.md 自动注入每次对话
→ 文件: `rules/coding-standards.md`

**结果**: AI 输出风格一致性显著提升。Review 中"风格问题"类 comment 从 40% 降到 5%

### 发现 #3：AI 总是想用大炮打蚊子

**现象**: 一个简单功能 AI 建议上 Redis + Celery + Docker Swarm

**根因**: AI 训练数据偏向企业级方案，不了解比赛单机部署的约束

**解决**: 建立 `rules/architecture.md`，明确"不引入的依赖"清单
→ 文件: `rules/architecture.md`

**结果**: AI 不再提议引入 Redis/Kafka/Celery 等比赛不需要的中间件

## 阶段二：提升复杂任务协作效率（Day 4-6）

### 发现 #4：AI 干了一半发现方向不对

**现象**: 复杂任务（如架构升级）AI 直接写代码，写了 200 行后发现方法行不通

**根因**: AI 急于执行，用户没给方向确认的机会

**解决**: 引入 Plan Mode —— 复杂任务先出计划，用户批准后再执行
→ 工作流: "需求 → AI 探索 → 方案选项 → 用户选择 → AI 实现"

**结果**: 架构升级（God Object → Phase Handler）一次成功，零回退

### 发现 #5：重复描述同类任务浪费大量 token

**现象**: 每次部署、每次 code review、每次 QA 测试都要从头描述需求

**根因**: 没有把高频协作模式封装成可复用的"技能"

**解决**: 建立 Skill Library，利用 Claude Code 的原生 skill 机制
→ 文件: `skills/index.md`

**结果**: `/review` `/qa` `/investigate` 等 skill 一键触发，不再需要每次描述怎么做

### 发现 #6：同一类型的 bug 出现多次

**现象**: 字段名不匹配（snake_case vs camelCase）先后出现 3 次（agent_count/pinned_at/last_message_preview）

**根因**: 没有规则在 AI 写新字段时自动检查前后端一致性

**解决**: 新增 `rules/contract-safety.md`，将"每次加字段必须两头检查"固化为规则
→ 文件: `rules/contract-safety.md`

**结果**: 之后同类型 bug 零发生

## 阶段三：质量闭环 + 独立评审（Day 7-12）

### 发现 #7：代码审查很难发现"初始化遗漏"

**现象**: `useContacts` hook 定义完整但从未被调用，`refreshSessions` 存在但未在 mount 时执行。代码审查看了 3 遍都没发现

**根因**: 人类审代码看"逻辑正确性"，容易漏"调用关系完整性"

**解决**: 引入 QA 浏览器测试作为代码审查的补充。`/qa` 自动打开浏览器验证
→ 方法: `skills/index.md` S4

**结果**: 浏览器一跑就暴露了"37 条历史会话完全不显示"的 P1 bug

### 发现 #8：AI 会陷入"理论分析死循环"

**现象**: 排查"第二条消息无响应"bug 时，AI 花了 10 轮分析锁机制、事件循环调度，无结论

**根因**: AI 擅长逻辑推理但不擅长"这可能是环境/时序问题"的判断

**解决**: 建立"3 轮无进展 → 换策略"规则。写 30 行 WS 模拟脚本，15 秒定位根因（DeepSeek API 延迟 + 锁排队）
→ 规则: `specs/index.md` S3 "when_stuck"

**结果**: 建立了"理论分析 vs 写测试脚本"的切换判断标准

### 发现 #9：AI 自己的评价不可靠

**现象**: AI 修完 bug 后自评"应该没问题了"，但实际还在

**根因**: AI 缺乏真正的客观性，同一个 AI 既写代码又审代码有盲区

**解决**: 引入独立 Agent 评审模式 —— 派生全新子 Agent 独立探索代码库并打分
→ Skill: `skills/index.md` S1

**结果**: 子 Agent 独立给出 89/100 评分，指出了主 Agent 没发现的 6 个短板

## 演化趋势图

```
协作效率
  │
  │                    ┌─ Spec System
  │              ┌─ Plan Mode
  │        ┌─ Rules
  │   ┌─ CLAUDE.md
  │  /
  │ /
  │/
  └──────────────────────────── 时间
  Day1    Day3    Day5    Day7    Day12
```

每次引入新方法都在上一个阶段的基础上叠加，形成累积效应。
