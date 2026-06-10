# AI Manager 协作体系 —— AgentHub

> 字节跳动 AI 全栈开发挑战赛 · AI 协作分项
>

## 体系架构

```
需求描述
  ↓
grill-with-docs（需求澄清，结构化反问）          ← OpenSpec 规格层
  ↓
Plan Mode + Superpowers（方案对比 + TDD 执行）   ← Superpowers 执行层
  ↓
Claude Code 编写（子 Agent 并行 + Review）
  ↓
run-tests（浏览器自动化回归）                   ← gstack 交付层
  ↓
debug-session（故障诊断 + 根因修复）
  ↓
演化沉淀（每次踩坑 → 提炼规则 → 下次不再犯）
```

## 四大支柱

| 支柱 | 文件 | 解决的问题 |
|------|------|-----------|
| **Spec System** | [specs/](specs/) | AI 漏需求、理解偏差、反复澄清 |
| **Rule System** | [rules/](rules/) | AI 风格不统一、引入不合适的依赖、架构偏离 |
| **Skill Library** | [skills/](skills/) | 重复描述同类任务、AI 执行质量不稳定 |
| **可执行 Skill** | [skills/](skills/) (S8-S10) | 测试/诊断/需求澄清的自动化封装 |
| **演化记录** | [evolution.md](evolution.md) | 同样的问题反复出现、协作效率无法量化提升 |

## 业界框架映射

我们的方法论与"AI 增强开发三件套"（OpenSpec / Superpowers / gstack）吻合：

| 层级 | 业界工具 | 我们的实践 | 自定义 Skill |
|------|---------|-----------|-------------|
| **规格层** | OpenSpec | 需求→结构化反问→可审查询规格 | grill-with-docs |
| **执行层** | Superpowers | Plan Mode + TDD + 子 Agent 并行 | — |
| **交付层** | gstack | 浏览器 QA + 诊断 + Retro | run-tests, debug-session |

核心理念：**不是用工具替代思考，是用工具约束 AI 的生成过程。** 从 Vibe Coding 拉回到工程交付。

## 量化成效

| 指标 | 初期（Day 1-3） | 后期（Day 4-12） | 提升 |
|------|----------------|-----------------|------|
| AI 首次输出可用率 | ~40% | ~85% | +113% |
| 单任务平均对话轮数 | 5.2 轮 | 2.1 轮 | -60% |
| Review 发现的问题数/千行 | 14 个 | 3 个 | -79% |
| 上下文漂移发生率 | 每 3 个任务 1 次 | 每 15 个任务 1 次 | -80% |
| 测试覆盖率 | 0% | 核心模块 100% | — |

> 数据来源：`evolution.md` 中的 10 个关键发现和 `journal.md` 中的 99 条决策记录。

## 评委阅读路径

按优先级：
1. **[evolution.md](evolution.md)** — 最重要的文件。展示 20 天协作过程中 10 个关键发现和解决方案
2. **[success-cases.md](success-cases.md)** — 5 个具体的"用了这套体系 vs 没用"对比案例
3. **[skills/index.md](skills/index.md)** — 7 个 AI Manager 方法论 + 3 个可执行 Skill（S8-S10）
4. **[skills/grill-with-docs.md](skills/grill-with-docs.md)** — 需求深挖 skill 定义（OpenSpec 层）
5. **[skills/run-tests.md](skills/run-tests.md)** — 自动化测试 skill 定义（gstack QA 层）
6. **[skills/debug-session.md](skills/debug-session.md)** — 故障诊断 skill 定义（gstack Debug 层）
7. **[rules/index.md](rules/index.md)** — 自动注入 AI 的约束规则
8. **[specs/index.md](specs/index.md)** — Spec 模板和 AI 工作规范
