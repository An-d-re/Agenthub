# AI 协作日志

## 项目背景

- **赛事**: 字节跳动 AI 全栈开发挑战赛（20 天）
- **角色**: 用户 = 产品经理 + 架构师；AI = 全部代码实现者
- **AI 协作分**: 占总分 30%（最高），考察 prompt 工程 + AI 协作规范 + 迭代过程

## 架构演进

### v1（初始方案）
- socket.io，Redis Pub/Sub，Orchestrator 在 services/ 下
- **否决原因**: 比赛单机部署不需要 Redis；socket.io 多余；Orchestrator 应是中枢

### v2（精简后）
- FastAPI 原生 WS，asyncio.Queue 替代 Redis，Orchestrator 提升到 core/
- @角色体系 (@planner/@coder/@reviewer)，Adapter 层支持 DeepSeek + Anthropic + OpenCode
- **问题**: 用户需求直接拆解执行，无确认环节；无上下文管理；无防御机制

### v3（当前版本）
- **四阶段交互模型**: 需求澄清 → 方案对比 → 计划确认 → 迭代执行
- **Middleware 链**: ContextSummarizer → LoopDetector → SubagentLimiter
- **反驳机制**: Coder 可反驳 Planner 分配，Coder 可反驳 Reviewer 意见，Agent 可质疑用户错误决策
- **砍掉**: Codex 桩、一键部署按钮、Web Preview

## 关键决策记录

### 2026-05-22

1. **技术栈**: Next.js 14 + FastAPI + PostgreSQL + Docker Compose, 原生 WebSocket
2. **Orchestrator 在 core/**: 调度中枢,非 service 子模块
3. **Agent 角色屏蔽平台**: @planner/@coder/@reviewer/@architect, 会话内绑定适配器
4. **无登录**: 打开即用
5. **DeepSeek 主力 + Anthropic API (Claude 模型) + OpenCode 第二平台**（全部 HTTP API）
6. **砍 Redis**: asyncio.Queue 单机足够
7. **可观测性**: trace/span 贯穿全链路,前端瀑布图

### 2026-05-22（晚）

8. **四阶段交互模型**: 像 Claude Code 一样先思考再动手
9. **@critic 角色**: 拷打用户需求,防止盲从
10. **多方案对比**: 按需生成 (gate: 多种合理路线时触发)
11. **澄清终止条件**: 最多 2 轮追问,之后标注"假设"进入方案阶段
12. **用户介入粒度**: Session 级 (暂停/继续/停止) + Task 级 (重试/取消),不做内容编辑
13. **反驳上限**: 每轮辩论最多 1 次 rebuttal,不一致则交用户裁决
14. **Agent 产出文件存储**: workspaces/{session_id}/ 持久化, 支持 Diff
15. **Plan DAG 编辑**: 先做轻量 checklist,有时间再升级拖拽
16. **演示方式**: 录屏

### 2026-05-23（需求对齐）

17. **Agent = 联系人模型**: WeChat 式, 会话列表即联系人列表, 点即聊
18. **单聊透明 / 群聊可见**: 单聊后台调度无感, 群聊 Orchestrator 可见群主
19. **上下文管理**: Compact(LLM 摘要) + Pin(手动标记) + 最近 15 条原文
20. **OpenCode 为第二 Adapter**: 字节系, HTTP API
21. **自建 Agent**: 预置 Skill 库勾选 (5 个: 代码生成/审查/SQL/文档/Web) + 示例 SQLite
22. **群聊成员随时增删**: 移除时 task 退回 pending 重分配
23. **失败降级**: 自动重试 1 次 → 再败 Orchestrator 发消息问用户
24. **对话式局部修改**: P2→P1, 选中代码行 → 描述 → Agent 精准改 → Diff 卡片
25. **文件上传**: 做, workspaces/{session_id}/uploads/
26. **部署**: P2 不实现, 预留 /deploy 接口桩, 答辩讲设计思路; /preview 静态 serve 替代
27. **Smoke test**: 每个 Phase 交付后跑 curl + 浏览器手动验证
28. **预置 Skill 库**: 5 个, 含 system prompt 注入 + 标签推导
29. **会话并发上限**: Semaphore(3), 用户可配置
30. **Docker 砍掉**: SQLite + asyncio.Queue 单机零依赖
31. **砍掉 Claude Code CLI**: 改用 Anthropic HTTP API, 三个 Adapter 全部 HTTP, 省去 subprocess 管理

### 2026-05-23（评审修订，DeepSeek 反馈采纳）

32. **WS 断线恢复**: 重连后通过 REST 补齐完整消息，流式 token 不恢复，答辩说明
33. **Semaphore 作用域**: Session 级限制，内部 task 调度用 SubagentLimiter 独立控制
34. **Skill 合并规则**: 按勾选顺序拼接，冲突时后者覆盖，用户 System Prompt 最高优先级
35. **BaseAdapter 级重试**: 指数退避 3 次 (1s/2s/4s)，429/503 → 自动重试
36. **反驳 fallback**: 1 轮上限 + 用户裁决已足够，不加关键词规则
37. **Day5 减负**: 只做核心消息类型 (chat.send/message/stream/ping)
38. **Day14 最小化 demo**: 群聊→澄清→选方案→完成 1 task，锁死核心链路
39. **user_settings**: 仅运行时动态设置，静态配置走环境变量
40. **架构扩展**: 文档注明 asyncio.Queue 可替换为 Redis Pub/Sub

## Prompt 工程沉淀

### Critic Prompt 要点
- 角色: 质疑需求的技术顾问
- 最多 2 轮追问
- 关注: scope 是否合理 / 是否有更简单方案 / 用户是否真正需要
- 第 2 轮后仍有模糊点 → 标注"以下假设成立: ..."进入方案阶段

### Planner Prompt 要点
- Gate 判断: 只有一种最佳实践 → 直接解释；多种合理路线 → 出对比；用户要求 → 强制出
- 方案对比输出: A/B/C 方案 + 各自优劣 + 推荐理由
- 任务拆解要求: 原子性、可并行性标注、依赖声明

### Reviewer Prompt 要点
- 检查: 正确性、安全性、简洁性
- 对 Coder 的反驳: 重新评估,基于论据修正结论,不坚持己见
- 如仍不一致: 标记 `dispute` 交用户裁决

### Coder Prompt 要点
- 有义务指出不合理任务并给出拆解建议
- 对安全/性能层面的用户错误要求**必须拒绝并解释**
- 反驳 Reviewer 时必须给出具体技术依据，非主观偏好

### 2026-05-24（Phase 5: 产物 + 可观测性）

41. **制品提取策略**: 从 Agent 回复的 markdown 代码块中自动提取 Artifact，猜测文件路径（注释推断 + 语言扩展名映射）。不依赖 Agent 显式声明文件路径
42. **Diff 卡片设计**: Monaco DiffEditor 弹窗模式，`originalContent` vs `modifiedContent`，支持语法高亮。不做完整版本树（P2）
43. **Preview 卡片**: iframe sandbox 预览 HTML artifact，支持手机/平板/桌面三档设备尺寸切换。直接 serve workspaces 目录
44. **Trace 全链路埋点**: `Tracer.span()` 异步上下文管理器，自动记录起止时间 + 持久化到 Trace 表 + 发布 `trace.span` 事件。覆盖 Orchestrator 四阶段 + Adapter 调用
45. **TracePanel 瀑布图**: Jaeger 风格，按 trace_id 分组 span，按时间线展示 duration bar，支持 service 过滤和 trace 下拉选择
46. **Monaco 集成**: `@monaco-editor/react` 按需加载，仅用于 Diff 查看器，不用于代码编辑

### 2026-05-25（Phase 6: 打磨 + 部署）

47. **Docker 决策反转**: 虽然 journal Day 23 决定砍掉 Docker，但最终为答辩演示稳定性，补充了 Docker Compose（backend + frontend 独立容器，SQLite 数据挂载）
48. **一键部署**: `POST /api/deployments` 写入静态文件 + 返回访问 URL，`GET /deployments/{path}` serve。简单实用，演示效果足够
49. **framer-motion 动画**: MessageBubble spring-in 级联效果（stiffness: 400, damping: 30），延迟 index * 0.03s 产生波浪入场
50. **ErrorBoundary**: class 组件捕获渲染错误，fallback UI + 重试按钮，防止单点崩溃
51. **CodexAdapter 预留桩**: 继承 DeepSeekAdapter，使用 OpenAI 兼容协议。无 key 时自动降级 DeepSeek。为答辩展示架构扩展性

### 2026-05-26（功能打磨：并行执行 + 审查 + 反驳）

52. **并行任务执行**: `asyncio.gather` 并行分发就绪任务（依赖满足），每个任务独立 DB session 防竞争。SubagentLimiter 控制并发 ≤3
53. **Reviewer 审查机制**: 任务完成后自动调用 reviewer agent，JSON 格式审查结果。`passed: false` → 自动触发重试。审查意见注入后续 prompt 避免重复错误
54. **反驳机制优化**: Agent 回复以 `[AGREE]`/`[REJECT]` 开头时，系统直接按关键词解析。`[AGREE]` → 自动通过，`[REJECT]` → 自动标记 dispute。减少 LLM 二次判断调用成本 + 增加确定性
55. **orchestrator.py 重构**: 从 ~700 行拆分为逐消息状态机，每条群聊消息按 Plan.phase 路由处理。并发锁 `asyncio.Lock` 保证同 session 串行
56. **事件先缓存后发布**: 事务提交后再 `_flush_pending_events()`，避免幽灵数据被 WS 推送

### 2026-05-27（功能打磨：局部修改 + 文件上传 + 断线恢复）

57. **对话式局部修改**: 前端 CodeBlock 组件（行号点击选择 + 修改输入框），WS `chat.modify` 协议，后端构建修改专用 prompt（原始代码 + 行号范围 + 修改指示），流式返回 + Diff artifact。完整覆盖 overview Section 10 定义
58. **文件上传**: REST API `POST /api/sessions/{id}/upload` multipart，图片内联预览 + 文件附件卡片，10MB 限制，workspaces 存储
59. **WS 断线消息补齐**: 前端追踪 `lastMessageCreatedAt`，重连后调用 `GET /messages?since=` 补全断线期间完整消息。流式 token 不恢复（设计权衡）
60. **流式 token 前端支持**: `chatStore.appendStreamToken()` 渐进追加 token，消息气泡实时更新。避免等待完整回复的空白期
61. **LLM 上下文压缩升级**: `ContextSummarizer._summarize_old()` 从规则摘要改为 DeepSeek LLM 智能摘要（15s 超时）。输出四维度：关键决策 / 已生成文件 / 待解决问题 / 用户偏好。LLM 不可用时降级规则摘要

### 2026-05-28（打磨收尾）

62. **骨架屏**: LeftSidebar 首次加载显示 Skeleton 占位（圆形头像 + 文字条），TaskPipeline 连接中状态显示骨架。Skeleton 组件来自 shadcn/ui
63. **前端三栏响应式**: 左侧栏 240px `hidden md:flex`，右侧面板 340px `hidden xl:flex`，小屏逐步隐藏
64. **上下文压缩阈值调优**: 消息 >50 条或估算 >8K tokens 触发。保留最近 20 条完整消息 + LLM 摘要替代早期消息

### 2026-05-25（Post-P2 修复 + Edge 浏览器测试）

65. **默认 Agent 种子数据**: `init_db()` 检查 Agent 表为空时自动创建 3 个系统 Agent（DeepSeek Coder / Claude Reviewer / SQL Optimizer），含 system prompt 和能力标签。用户打开即用
66. **文件元数据持久化**: Message 表新增 `file_name`/`file_url`/`file_size` 列，`MessageResponse` schema 同步更新。WS 断线恢复时文件消息可正确渲染预览
67. **群聊 Agent 名称标签**: `MessageBubble` 从 `agentStore` 查找 `agentId` 对应名称显示，替代统一 "Agent" 标签
68. **uvicorn reload 优化**: 添加 `--reload-exclude "workspaces/*" --reload-exclude "data/*"`，避免上传文件触发不必要的热重载
69. **`.env.example` 模板**: 供协作者参考所需环境变量，保护 API key 不泄露

## 参考外部项目

- **DeerFlow 2.0**: 14 层中间件洋葱模型, Lead Agent + Sub-Agent, Plan 模式, 三层记忆
- **M3-Agent**: 双进程并行 (Memorization + Control), 实体中心化记忆图, 多轮迭代推理
- **TRAE SOLO**: Plan 模式先出作战图, Agentic Edit, Sub Agent 并行, DiffView
