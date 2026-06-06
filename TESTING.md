# AgentHub 群聊多 Agent 协作测试指南

## 前置准备

1. **确保 `backend/.env` 已配置 DeepSeek API Key：**
   ```
   DEEPSEEK_API_KEY=sk-your-key-here
   ```

2. **启动后端：**
   ```bash
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

3. **启动前端：**
   ```bash
   cd frontend
   npm run dev
   ```

4. **首次运行会自动创建 4 个 DeepSeek 角色 Agent：**
   - `Critic · 需求分析师` — 质疑需求、澄清模糊点
   - `Planner · 架构师` — 方案对比、任务分解
   - `Coder · 全栈工程师` — 编写代码
   - `Reviewer · 代码审查` — 审查代码质量

   如果之前已有旧数据库，删除 `backend/data/agenthub.db` 后重启即可。

## 测试流程

### Step 1：创建群聊

1. 打开 `http://localhost:3000`
2. 左侧栏点击 **「群聊」** 标签（中间那个）
3. 点击 **「+ 创建群聊」** 按钮
4. 将 4 个 Agent 全部选中，输入群名称
5. 点击创建

首次访问会自动创建 **「Demo 演示」** 群聊（含前 3 个 Agent），可直接使用。

### Step 2：发送需求，观察多 Agent 协作

在群聊输入框中发送一个开发需求，例如：

> 帮我写一个 Python Flask TODO 列表 API，支持增删改查和 SQLite 存储

预期看到四阶段自动化协作：

```
👤 用户: 帮我写一个 Python Flask TODO 列表 API...

🔍 [Critic·需求分析师]: 
   在开始前，我需要确认几个问题：
   1. API 的认证方式是什么？
   2. TODO 条目需要哪些字段？
   3. ...

👤 用户: 
   RESTful API 风格，TODO 项包含 id/title/completed/created_at，
   返回 JSON 格式，全部放在一个 app.py 文件里

📋 [Planner·架构师]:
   方案 A: Flask + SQLite 直接操作 (推荐)
   方案 B: Flask + SQLAlchemy ORM
   ...

📋 [Planner·架构师]:
   计划已生成，共 3 个任务：
   [task-1] 初始化 Flask 项目结构
   [task-2] 实现 CRUD API 路由
   [task-3] 添加错误处理和测试

💻 [Coder·全栈工程师]:
   执行 task-1: 创建 app.py...
   
💻 [Coder·全栈工程师]:
   执行 task-2: 实现增删改查...

✅ [Reviewer·代码审查]:
   审查 task-1: passed ✓
   代码结构清晰，错误处理完善。

✅ [Reviewer·代码审查]:
   审查 task-2: passed ✓
```

### Step 3：查看任务和追踪

- **右侧「任务」面板**：实时显示各任务状态（pending → running → reviewing → done）
- **右侧「追踪」面板**：Jaeger 风格瀑布图，显示每个 Agent 调用耗时
- **代码文件**：执行阶段生成的代码会以 Diff 卡片形式展示，可一键应用

### Step 4：交互操作

| 操作 | 方式 |
|------|------|
| **方案选择** | PlanCard 卡片上点击方案名 |
| **停止执行** | 群聊标题右侧红色停止按钮 |
| **引用回复** | 鼠标悬停消息 → 点击引用图标 |
| **重新生成** | Agent 消息旁的重试按钮 |
| **局部修改** | CodeBlock 选择行号 → 输入修改指令 |
| **@提及 Agent** | 输入 `@` 选择特定 Agent 对话 |

## 关键验证点

| 验证项 | 预期结果 |
|--------|---------|
| Agent 角色徽章 | 每条 Agent 消息旁显示 🔍Critic/📋Planner/💻Coder/✅Reviewer 角色标识 |
| 方案对比卡片 | Planner 阶段显示 PlanCard，包含多方案的优缺点对比 |
| DAG 任务图 | 确认方案后显示任务依赖图，可勾选/删除任务 |
| 代码生成 | Coder 阶段输出完整代码文件 |
| 审查结果 | Reviewer 输出 JSON `{passed, feedback, suggested_changes}` |
| Trace 追踪 | 右侧追踪面板实时显示 Agent 调用耗时瀑布图 |

## 故障排查

| 问题 | 解决方法 |
|------|---------|
| Agent 无回复 | 检查 `DEEPSEEK_API_KEY` 是否有效，查看后端 Terminal 日志 |
| WebSocket 断开 | 页面顶部会显示黄色/绿色横幅，刷新页面重连 |
| 角色徽章不显示 | 确认群聊至少有 3 个 Agent（编排器按索引分配角色） |
| 后端端口冲突 | `taskkill /F /IM python.exe` 后重启 |

## 原理说明

即使所有 Agent 都使用 DeepSeek API，多角色协作仍然有效，因为：

- **编排器每个阶段注入不同的 System Prompt**（`backend/app/core/prompts.py`），同一 API 在不同阶段扮演不同人格
- **Agent 按索引分配角色**：agent[0] 负责 Critic+Planner，agent[1] 负责 Coder，agent[2] 负责 Reviewer
- **Agent 的自身 system_prompt 被阶段 prompt 覆盖**，所以 Agent 名称只影响 UI 显示
