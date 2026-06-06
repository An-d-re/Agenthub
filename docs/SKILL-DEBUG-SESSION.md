# debug-session：AgentHub 群聊会话诊断

## 这是什么？

`/debug-session` 是 AgentHub 的故障诊断 skill。当群聊测试跑出不符合预期的结果时（任务卡住、Agent 没回复、阶段异常），用它来快速定位根因。

## 何时使用

遇到以下情况时调用：

- 任务一直处在 `pending` 状态，没有执行
- Agent 没回复消息，对话卡在某一步
- Planner 的方案卡片没出现
- DAG 确认后任务没有开始
- 测试结果与预期不符，想看内部发生了什么

## 如何使用

### 1. 找到 Session ID

从 `conversation.md` 的文件头或测试输出里找到：

```
会话 ID：8af420f7-6c12-42be-a20c-1bec31db9df6
```

### 2. 触发诊断

在 Claude Code 对话中输入：

```
/debug-session 8af420f7-6c12-42be-a20c-1bec31db9df6
```

或者直接描述问题，Claude 会让你提供 session ID：

```
任务计算乘积一直卡在 pending，帮我看看为什么
```

### 3. 阅读诊断报告

诊断完成后你会得到一份报告：

```
## 诊断报告 — Session 8af420f7

**当前状态**: phase=executing, status=active
**任务进度**: 1/2 完成

**发现的问题**:
1. task-2 卡在 pending → agent_id 为 null → 匹配失败 → 建议检查 capability_tags
2. DAG 中有依赖 task-2 depends_on task-1，但 task-1 已完成，说明不是依赖问题

**日志关键事件**:
- 04:57:23 创建 temp Agent「计算Agent」
- 04:57:26 task-1 完成
- 04:57:26 task-2 调度失败：没有可用 Agent
```

## 诊断内容

skill 会检查 5 个维度：

| 维度 | 检查内容 |
|------|---------|
| **A. 阶段推进** | Plan 当前在哪个 phase（clarify/comparison/confirmed/executing/done），是否卡住 |
| **B. DAG vs TaskDB** | 任务计划里的任务和数据库里的任务记录数量是否一致 |
| **C. 依赖链** | 任务依赖关系是否正确，是否有死锁 |
| **D. Agent 分配** | 每个任务是否分配到了 Agent，临时 Agent 是否正确创建 |
| **E. 错误信号** | 日志中的异常关键词和错误模式 |

## 已知故障模式

这些是已经修过的 bug，如果症状匹配会直接提醒你检查修复是否部署：

| 症状 | 根因 | 
|------|------|
| task 卡在 pending，无错误提示 | `MissingGreenlet`：aiosqlite greenlet 错误 |
| `NoneType is not subscriptable` | LLM 返回了 null 元素 |
| 旧行为在修复后仍然出现 | Windows `__pycache__` 未清理 |
| "请添加 Agent" 不断重复 | No-agent 无限循环 |
| `task_dag` 类型混乱 | 字典/列表混合 |

## 与 run-tests 的关系

两个 skill 配合使用，形成测试闭环：

```
/run-tests 执行测试 → 产物保存 → 你审阅发现问题
                                       ↓
                               /debug-session 诊断
                                       ↓
                               定位根因 → 修复代码
                                       ↓
                               /run-tests 重新验证
```
