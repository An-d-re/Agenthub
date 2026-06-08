# Rule System

> 核心发现：每次调 AI 都口头提醒规则 → 记不住。把规则写下来自动注入 → 一致性提升 5 倍。

## 规则注入机制

我们使用 `CLAUDE.md` 作为规则的自动注入载体。Claude Code 在每次对话启动时自动加载 `CLAUDE.md`，其中引用了以下规则文件：

```
CLAUDE.md (自动加载)
  ├── ai-collaboration/rules/architecture.md     # 架构约束
  ├── ai-collaboration/rules/coding-standards.md  # 编码规范
  └── ai-collaboration/rules/contract-safety.md   # 前后端契约安全
```

## R1. 架构约束

**来源**: 外部专家审计（`改进.md`）+ Phase Handler 架构升级

```yaml
ArchitectureRules:
  - "Orchestrator 在 core/ 下，不在 services/"
  - "所有 Adapter 继承 base.py，HTTP API only"
  - "内部事件用 asyncio.Queue，不引入 Redis/RabbitMQ"
  - "Middleware 链顺序不变：Summarizer → LoopDetector → Limiter"
  - "前端 Zustand store 一个 domain 一个文件"
  - "WebSocket 双协程模式 (ws↔eventbus)"
```

## R2. 编码规范

**来源**: 14 个 bug 审计 + coding review 反复出现的问题

```yaml
CodingRules:
  general:
    - "默认不写注释，只 WHY 加一行"
    - "不写多行 docstring"
    - "不做'以后可能用到'的抽象"
    - "三个相似行 > 一个过早抽象"
  
  python:
    - "所有 DB 操作通过 get_db 依赖注入"
    - "配置用 pydantic-settings .env"
    - "except Exception，不裸 except:"
  
  typescript:
    - "Zustand selector 不用 || []（导致无限渲染）"
    - "Monaco Editor 必须 dynamic import {ssr: false}"
    - "WebSocket 重连指数退避 1s→2s→4s→max 30s"
```

## R3. 前后端契约安全

**来源**: 置顶功能字段名不匹配导致的 4 轮调试

```yaml
ContractRules:
  naming: "后端 snake_case = 前端 field 名，不做 camelCase 转换"
  null_handling: "Optional 字段 → null，前端用 != null 检查"
  init_check: "每个 useEffect(fn,[]) 必须验证数据是否真正被加载"
  orphan_check: "每个 hook 必须被至少一个组件 import"
  state_strategy: "API-first 优于乐观更新；禁止乐观更新+全量重拉"
```

## R4. Git 操作纪律

**来源**: 用户明确要求"不提交测试脚本"

```yaml
GitRules:
  - "git add <specific-files>，不用 -A"
  - "一个 commit 只做一件事"
  - "destructive 操作前必须确认"
  - "commit message: type(scope): description"
```

## 规则成效

| 指标 | 规则引入前 | 规则引入后 |
|------|----------|----------|
| 字段命名不匹配 bug | 3 个 (agent_count/pinned_at/last_message_preview) | 0 |
| 不符合架构的代码 | 5 处 (socket.io/Redis/subprocess) | 0 |
| AI 过度抽象 | 频繁 ("可能要用的" 抽象层) | 几乎没有 |
| orphan hook/函数 | 1 个 (useContacts) | 0 |
