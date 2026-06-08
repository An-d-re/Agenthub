# Spec System

> 核心发现：直接说"帮我做 X"效果很差。AI 需要结构化的上下文才能一次做对。

## S1. Feature Spec 模板

每当我们开始一个新功能，先用此模板生成 Spec，然后 AI 严格按 Spec 实现。

```yaml
Feature:
  name: "<功能名称>"
  goal: "<一句话描述用户能做什么>"
  motivation: "<为什么需要这个功能>"

Scope:
  in: ["<包含的子功能>"]
  out: ["<明确不做的边界>"]

Constraints:
  tech: ["<技术约束，如 TypeScript only / FastAPI>"]
  design: ["<设计约束，如 Apple HIG / Tailwind CSS>"]
  perf: ["<性能约束，如 <100ms 响应>"]
  security: ["<安全约束，如输入校验 / XSS 防护>"]

Acceptance:
  - "<验收条件1：可观测的结果>"
  - "<验收条件2>"
  - "<验收条件3：异常路径>"

Dependencies:
  - "<依赖的功能或模块>"

Risks:
  - "<已知风险 + 缓解措施>"
```

**实测案例**: 置顶功能在无 Spec 时经历了 4 轮调试。如果一开始有 Spec，字段命名一致性、初始化加载、排序策略都会被提前定义。

## S2. Bug Fix Spec 模板

```yaml
Bug:
  symptom: "<用户看到的现象>"
  actual: "<实际发生了什么>"
  expected: "<应该发生什么>"
  repro: "<复现步骤>"

Root Cause:
  file: "<问题文件>"
  line: "<问题行号>"
  reason: "<为什么出错>"

Fix:
  approach: "<修复思路>"
  files_changed: ["<文件列表>"]
  test: "<如何验证修复>"

Prevention:
  rule: "<新增或更新的规则，防止同类问题>"
```

**实测案例**: ISSUE-001（会话列表不加载）的 Bug Spec 产出了 `rules/contract-safety.md` 中的"初始化副作用检查"规则。

## S3. AI 工作规范

以下规范已写入 `CLAUDE.md`，每次对话自动加载：

```yaml
AI_Contract:
  before_code:
    - read_related_files   # 先理解上下文
    - state_approach       # 简述方案
    - wait_confirmation    # 等用户确认方向
  
  during_code:
    - prefer_edit_over_create  # 优先编辑现有文件
    - single_responsibility    # 一个 commit 做一件事
    - no_speculative_code      # 不做"以后可能用到"的抽象
  
  after_code:
    - build_verify         # 编译通过
    - self_review          # AI 自查一遍
    - report_changes       # 汇报改了什么
  
  when_stuck:
    - escalate_after_3     # 3 轮无进展 → 停止并请求指导
    - switch_strategy      # 理论分析无效 → 写测试脚本实测
```

## 为什么 Spec 有效

| 没有 Spec | 有 Spec |
|-----------|---------|
| AI 猜测需求范围 → 做多或做少 | AI 知道确切边界 → 不多不少 |
| 每轮澄清 2-3 个问题 | Acceptance Criteria 提前定义 |
| 验收靠"看着差不多" | 验收有明确条件 |
| bug 修了又坏 | Prevention 规则防止同类问题 |
