# Rule System

> AI 不会记住你昨天的口头提醒。把规则写下来，自动注入每次对话，一致性才有保障。

## 规则来源

项目没有独立的 rules 目录自动加载。实际生效的规则来自三层：

```
CLAUDE.md（每次对话自动加载，核心规则内联在"编码约定"章节）
  ├── 编码约定：注释/异常处理/Zustand 等 5 条
  ├── 架构约束：目录结构、Middleware 链、通信方式（详见"架构核心"章节）
  └── 技术栈约束：FastAPI 原生 WS / asyncio.Queue / SQLite

auto-memory（对话间持久化）
  ├── 修改代码前先询问用户
  └── 测试必须用 MCP/gstack，禁止 Python 脚本

Skill SKILL.md（调用 skill 时加载）
  ├── run-tests：@e 引用失效 / 单方案陷阱 / 任务完成判断 / restart 隔离
  ├── debug-session：并行采集 / 交叉校验 / 故障模式积累
  └── grill-with-docs：一问一答 / 代码可答不扰用户 / 不替用户决策
```

## 四类规则

| 类别 | 详细文件 | 来源 |
|------|---------|------|
| **R1. 架构约束** | [architecture.md](architecture.md) | CLAUDE.md 架构章节 + 实际代码结构 |
| **R2. 编码规范** | [coding-standards.md](coding-standards.md) | CLAUDE.md 编码约定 + 实际项目实践 |
| **R3. 契约安全** | [contract-safety.md](contract-safety.md) | 置顶功能 4 轮调试 + 字段命名 bug |
| **R4. 协作纪律** | 本文 | auto-memory + Skill 内置规则 |

## R4. 协作纪律

这些规则来自两个月协作中反复踩坑的经验，存储在 auto-memory 和 skill 定义中：

```yaml
CollaborationRules:
  修改权限: "修改项目代码前必须先询问用户，确认后再动手"
  测试纪律: "浏览器操作必须通过 gstack 二进制或 MCP，禁止退化为 Python/Node 脚本"
  Git: 
    - "git add <specific-files>，不用 -A"
    - "一个 commit 只做一件事"
    - "destructive 操作前必须确认"
    - "测试脚本等临时文件不提交"
```

### Skill 内置规则

每个 skill 的 SKILL.md 中定义了不可违反的约束。这些是"AI 不遵守就会出错"的硬规则：

| 来源 Skill | 规则 | 违反后果 |
|-----------|------|---------|
| run-tests | 每次 `$B goto` 后必须重跑 `snapshot -i` | @e 引用失效，找不到按钮 |
| run-tests | 任务完成判断必须先查 API 拿期望总数 | pending 状态不发 WS 事件，store 计数不可靠 |
| run-tests | 单方案场景直接等"确认执行"而非"选择方案" | 死等不存在的按钮，超时 |
| run-tests | 每个用例前 `$B restart` 清浏览器状态 | cookie/storage 污染导致用例间互相影响 |
| debug-session | 并行采集 API + log，不等串行 | 两个数据源各耗时 2s，串行翻倍 |
| debug-session | 交叉校验而非单点判断 | API 状态和日志任一有盲区 |
| grill-with-docs | 一次只问一个问题 | 信息过载，用户跳过关键决策 |
| grill-with-docs | 代码库能回答的直接探索，不问用户 | 浪费用户时间在 AI 能自己查到的问题上 |
