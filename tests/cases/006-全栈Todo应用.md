---
id: "006"
name: 全栈Todo应用 — 3个Agent并行完成后端、前端和文档
type: group
timeout: 900
---

## 设置
<!-- 3个Agent并行，测试并行调度和 SubagentLimiter 控制（≤3） -->

## 步骤

用户：请帮我创建一个简单的 Todo 网页应用，包含以下三个任务：
1. 一个Agent写后端 Python FastAPI，提供任务的增删改查（CRUD）接口，数据用内存列表存储即可
2. 一个Agent写前端 HTML 页面（单文件即可），调用后端接口展示任务列表、添加任务、删除已完成任务
3. 一个Agent写 README 说明文档，说明如何启动后端和前端，以及 API 接口说明

(Critic自行判断是否需要继续细问需求)

(Planner提供计划方案，应该是三个Agent并行执行：后端Agent、前端Agent、文档Agent)

(用户确认)

后端Agent：（FastAPI代码，包含 /tasks GET/POST/DELETE 接口）

前端Agent：（HTML页面代码，包含任务输入框、列表渲染、删除按钮、fetch调用后端）

文档Agent：（README.md内容，包含启动说明和API文档）

(任务结束)

## 重点截图
- DAG 编辑器中的 3 个并行任务
- TaskPipeline 中 3 个任务的并行执行状态
- 后端Agent 的代码输出
- 前端Agent 的代码输出
- Web Preview 预览效果

## 清理
删除创建的Agent
