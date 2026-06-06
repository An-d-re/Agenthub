# run-tests：AgentHub 自动化回归测试

## 这是什么？

`/run-tests` 是 AgentHub 的自动化回归测试 skill。你只需要用 Markdown 写好测试步骤（像写剧本一样），Claude Code 会自动启动项目、打开浏览器、按步骤操作、保存所有产物供你审阅。

## 快速开始

### 1. 写一个测试用例

在 `tests/cases/` 下创建 `.md` 文件，例如 `计算任务.md`：

```markdown
---
id: 000
name: 两个Agent分别计算和验证
type: group
timeout: 600
---

## 设置
<!-- 需要预创建的Agent写在这里，不写则由Planner自动创建 -->

## 步骤
用户：请计算 12345 × 6789，由一个Agent独立计算，另一个Agent独立验证结果

(Critic自行判断是否需要继续细问需求)

(Planner提供计划方案)

(用户确认)

计算Agent：（计算过程和结果），计算结果为：xxxxx

验证Agent：（根据planner的要求进行验算），计算结果为：xxxxx，与计算Agent一致/不一致

（任务结束）

## 重点截图
<!-- 额外需要截图的地方，可选 -->

## 清理
删除创建的Agent
```

### 2. 运行测试

在 Claude Code 对话中输入：

```
/run-tests 计算任务          # 跑指定用例
/run-tests                   # 跑 tests/cases/ 下所有用例
/run-tests 计算任务 flask-todo  # 跑多个指定用例
```

### 3. 审阅结果

测试完成后，产物保存在 `tests/test-output/<时间戳>/<用例名>/`：

```
计算任务/
├── conversation.md   # 完整对话记录 + 测试执行摘要
├── screenshots/      # 自动截图 + 你指定的重点截图
├── artifacts/        # Agent 生成的文件（如有）
├── console.log       # 浏览器控制台日志
└── store-snapshot.json  # 前端状态快照（备用）
```

打开 `conversation.md`，在末尾的「审阅备注」下标注不符合预期的地方，告诉 Claude Code。

## 步骤写法

步骤使用**混合格式**——括号是行为指令，无括号是对话记录：

| 写法 | 含义 | 示例 |
|------|------|------|
| `用户：消息` | 发送一条聊天消息 | `用户：帮我写一个 Flask API` |
| `(Critic自行判断...)` | 等待并观察 Critic 是否发言 | `(Critic自行判断是否需要细问)` |
| `(Planner提供计划方案)` | 等待 Planner 给出方案 | `(Planner提供计划方案)` |
| `(用户确认)` | 自动点击第一个方案/确认按钮 | `(用户确认)` |
| `(任务结束)` | 等待所有任务完成 | `（任务结束）` |
| `Agent名：内容` | 纯记录，不做匹配验证 | `Coder：xxxxx`（xxxxx = 任意值） |
| `(描述)` | 自定义操作 | `(等待 PlanCard 出现后截图)` |

**关键点**：`Agent名：xxxxx` 只记录对话，**不做自动判断**。是否符合预期由你人工审阅决定。

## 配置说明

| frontmatter 字段 | 说明 | 默认值 |
|------|------|--------|
| `id` | 用例唯一标识 | 必填 |
| `name` | 用例名称 | 必填 |
| `type` | `group`（群聊）或 `single`（单聊） | 必填 |
| `timeout` | 超时时间（秒） | `600`（10分钟） |

## 完整流程

```
你写测试用例 → /run-tests → Claude 自动执行：
  1. 清理旧进程 → 启动后端 :8000 → 启动前端 :3000
  2. 创建群聊 Session
  3. Playwright 打开 Edge 浏览器
  4. 按步骤执行操作（发消息 / 点按钮 / 等待 / 截图）
  5. 导出对话 + 截图 + 控制台日志 → 保存到 test-output/
  6. 清理临时 Agent 和 Session
  7. 关闭前后端 → 输出批次摘要
                        ↓
              你审阅 conversation.md
                        ↓
         有不符合预期？告诉 Claude Code
                        ↓
         Claude 用 /debug-session 定位根因
```

## FAQ

**Q: 测试时看到浏览器打开了文件选择窗口？**

检查测试用例的 `(用户确认)` 是不是在正确的位置。如果 PlanCard 只有一个方案，系统会自动选择，不需要手动点 PlanCard。

**Q: 10 分钟超时不够？**

在 frontmatter 加 `timeout: 1200` 调整为 20 分钟。

**Q: 多个测试用例并行？**

目前是顺序执行。一个用例失败不影响后续用例。
