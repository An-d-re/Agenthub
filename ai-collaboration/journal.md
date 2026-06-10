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

### 2026-05-29（架构升级 + 深度思考 + 14 bug 修复）

70. **Phase 1 — Phase Handler 架构**: 将 1206 行 `orchestrator.py` 拆分为 `core/phases/` 目录。`BasePhaseHandler` 基类包含所有共享工具方法，每个阶段独立 Handler（clarify / comparison / confirmed / executing）。Registry 模式路由：`PHASE_REGISTRY[phase].execute(ctx)`。Orchestrator 精简为 ~250 行的路由层（锁管理 + 中间件 + 事件发布）

71. **Phase 2 — 任务状态机正式化**: 10 个正式状态（pending → ready → running → reviewing → done，加 retrying / failed / blocked / dispute / cancelled 分支）。`ALLOWED_TRANSITIONS` 字典定义合法转换，`validate_transition()` 校验。前端 TaskPipeline + chatStore 类型同步

72. **Phase 3 — 双层 Reviewer**: Layer 1 静态规则（Python AST 语法 / JS 括号 / JSON 解析 / CSS 括号 / HTML 结构 / SQL 危险操作 / 硬编码密钥 / eval exec / 命令注入），零 token 成本。Layer 2 LLM 审架构/逻辑/可读性。静态失败直接返回具体错误，不动用 LLM

73. **Phase 4 — Agent 能力路由**: `TECH_CAPABILITY_MAP` 从任务描述自动提取 15 个技术标签。Agent 选择优先级：@mention → 能力匹配 → 索引回退。前端 AgentEditor 新增手动能力标签输入

74. **Phase 5 — Sandbox 执行层**: 5 个注册工具（write_file / read_file / run_command / install_deps / list_files），per-session 独立 workspace `workspaces/{session_id}/`。Agent 生成代码后自动写入沙箱运行，结果（✅/❌ + 输出摘要）出现在完成消息中

75. **Phase 6 — CI Pipeline 卡片**: TaskPipeline 从简单列表升级为分段进度条 + 连接线 + 可展开卡片。每卡展示 Agent 名称、耗时、重试次数、错误信息（红色代码块）、输出预览（等宽，最多 1000 字符）

76. **群聊流式响应**: 三个 phase handler 从阻塞 `adapter.send_message()` 改为 `_stream_agent_response()`，逐 token 实时推送。阶段进度消息 `publish_now=True` 绕过 pending_events 直接发布，不等 DB commit。停止信号在每 token 循环中检查

77. **深度思考可视化**: DeepSeek `extra_body={"thinking": {"type": "enabled"}}` 开启推理模式。`StreamToken` 区分 `reasoning`（推理链）和 `content`（回复）。新增 `chat.stream.reasoning` 事件类型。前端 `ReasoningBlock` 折叠式面板，回复完成后仍可展开

78. **14 bug 系统性审计**: 并发 Explore Agent 审前后端，按严重程度分类（4 Critical + 4 High + 6 Medium）。关键 fix：无限重试 dispute guard、文本确认不执行任务（executing 直接调 execute_tasks）、路径穿越（_safe_path）、isThinking 60s 超时、_finalizedIds 防 token 覆盖、信号量只包 API 调用

79. **第二条消息无响应根因**: 写 WS 模拟脚本定位 — DeepSeek API 延迟 ~15s，期间锁被持有，第二条消息的 orchestrator 排队等锁。修复：检测锁状态，立即发"消息已排队"通知。关键教训：AI 理论分析 10 轮不如写 30 行模拟脚本

80. **前端打磨**: 流式 token 时 instant 滚动（防抖动）、标签页指示器 硬编码像素 → useRef + getBoundingClientRect、移动端汉堡菜单（md 断点以下侧边栏 fixed + 遮罩）、深色模式 transition 0.3s、selection 颜色定制、滚动条 hover 状态

81. **Anthropic/OpenCode/Codex Adapter 降级策略**: 所有 adapter 初始化时检查 API key，无 key 时自动降级为 DeepSeekAdapter。不阻塞启动，不影响已有功能。OpenCodeAdapter 和 CodexAdapter 均继承 DeepSeekAdapter

### 2026-06-06（独立评审 + 短板修复 + QA 测试）

82. **独立 Agent 评审**: 用户要求"派生一个独立的不相干的子 agent 来评判我们的项目并打分"。AI 派出 Explore Agent 深度探索代码库，对照 req.md 的 5 个评分维度给出 89/100 评分，指出 6 项短板。其中 4 项随后被修复。

83. **批量短板修复**: 用户说"你把短板的1、2、5、6实现了"。AI 创建 4 个 task，并行探索 4 个相关文件，逐一实现：置顶功能前端入口、33 个后端测试用例（从 0 到 33）、static_reviewer 集成到执行流、ErrorBoundary 确认已挂载。

84. **前后端字段命名一致性**: 发现 `SessionItem` 使用 camelCase（`pinnedAt`/`agentCount`）但 API 返回 snake_case（`pinned_at`/`agent_count`）。JavaScript 静默返回 `undefined` 而不报错。统一为 snake_case。沉淀为 `rules/contract-safety.md`。

85. **置顶功能 4 轮调试**: 
  - 第1轮：字段名不匹配 → 统一 snake_case
  - 第2轮：乐观更新 + 全量重拉冲突 → 改为 API-first 单条更新
  - 第3轮：QA 发现 `refreshSessions` 未在 mount 调用 → 37 条历史会话完全不显示（这才是根因）
  - 第4轮：最终验证通过
  - 教训：不要相信上一次修复一定正确。追踪完整数据流而非局部代码。沉淀为 `skills/index.md` S3。

86. **QA 驱动的开发流程**: 用户使用 `/qa` skill 进行浏览器测试。发现 P1 bug（会话列表不加载）→ atomic commit → 重启验证。健康分从 85 → 95。QA 报告写入 `.gstack/qa-reports/`。

87. **Git 协作纪律**: 用户明确指示"测试脚本不需要提交到仓库"、"/qa 需要干净的工作区"。AI 在每次修改前检查 `git status --porcelain`，给用户选择 commit/stash/abort。每个 bug 一个 commit（`fix(qa): ISSUE-NNN — description`）。

88. **AI 协作沉淀文档化**: 用户要求"沉淀出 spec、skill 和 rules，体现我指挥 AI 干活的能力"。AI 将整个协作过程中的模式系统化：7 个 skill 定义（含实测案例）、新增 `rules/contract-safety.md`、追加 journal 决策记录、更新 report 协作指标。

89. **Skill 路由发现**: 用户熟练使用 `/review`、`/investigate`、`/debug`、`/qa` 等 skill，根据问题类型选择合适的工具。例如：置顶有问题 → `/investigate` 而非直接让 AI "修一下"；需要全面测试 → `/qa` 而非逐条手工测试。

### 2026-06-06（补充：自动化测试体系建立）

90. **run-tests skill 创建 —— 从 0 到 1 的 E2E 测试体系**: 用户要求"写一个自动化测试的 skill"。AI 设计了一套完整的测试框架：Markdown 驱动的测试用例格式（frontmatter + 自然语言步骤）、MCP Playwright 浏览器驱动、4 阶段执行流程（前置检查→执行→收集→清理摘要）。首次实现支持 8 个测试用例（001-008），覆盖群聊计算任务、单聊澄清、方案对比等核心链路。测试产物包括 conversation.md + 截图，可供人工审阅。

91. **debug-session skill 创建 —— 系统化故障诊断**: 用户要求"做一个诊断工具"。AI 设计了 Step 1 并行采集（diagnostics API + orchestrator log grep）→ Step 2 交叉校验清单（Phase 推进/DAG 一致性/任务依赖链/Agent 分配/错误信号）→ Step 3 输出根因报告。内置已知故障模式表（5 种 pattern：MissingGreenlet/NoneType DAG/Stale pyc/No-agent loop/Type mixing），每种标注了症状、根因和修复 commit。这是"每次踩坑→固化为诊断规则"的典型实践。

### 2026-06-07（产品打磨 + 测试扩展）

92. **封面页 + 会话持久化**: 新用户打开 AgentHub 时看到品牌封面页（聚焦穿透动画 + 渐变），点击"开始使用"后进入主界面。封面状态用 sessionStorage 持久化，浏览器重开不再展示。会话 URL 持久化：`?session=xxx` query param 恢复上次活跃会话，`fetchSessions` 补全历史列表。这两个改进让产品从"Demo 工具"向"可用产品"迈进。

93. **E2E 测试用例扩展至 8 个**: 在 run-tests 框架下新增测试用例 001-008，覆盖：群聊计算+验证（001）、单聊代码生成（002）、Clarify 阶段需求澄清（003）、多方案对比（004）、DAG 确认执行（005）、临时 Agent 自动创建（006）、会话导出（007）、错误处理降级（008）。测试用例格式统一为 Markdown frontmatter（id/name/type/timeout）+ 自然语言步骤。

94. **死代码清理**: 删除 `test-cases/`（旧测试记录）、`tests/run-script.py` 和 `run-script.js`（早期脚本时代残留）。这标志着测试体系从"临时脚本"向"结构化 skill"的彻底迁移。

### 2026-06-08（AI 协作体系文档化）

95. **AI Manager 协作体系重组**: 小伙伴将 12 天的协作经验系统化为四大支柱（Spec/Rules/Skills/演化记录），编写了 `report.md`（7 章完整报告）、`journal.md`（89 条决策）、`evolution.md`（9 个关键发现）、`success-cases.md`（5 个对比案例）。核心论点："我们不只在用 AI，我们形成了一套可复制的人机协作方法论"。

96. **文档按评委视角重新组织**: 参考比赛评分标准（AI 协作 30%），调整了 README.md 的评委阅读路径：evolution.md → success-cases.md → skills/ → rules/ → specs/。量化成效表（初期 vs 后期）覆盖 5 个关键指标：AI 首次输出可用率（40%→85%）、单任务对话轮数（5.2→2.1）、Review 问题数/千行（14→3）、上下文漂移率、测试覆盖率。

### 2026-06-09（测试体系优化 + 方法论完善）

97. **run-tests 从 MCP 切换到 gstack browse 二进制**: 分析发现 MCP `browser_snapshot` 每次返回完整 DOM 树消耗数千 token，是烧 token 的根因。gstack `$B snapshot -i` 只返回可交互元素 + @e 短引用，单次调用从数千 token 降到几十 token。重构 SKILL.md（216 行→103 行），新增按钮文本常量区（替代每轮读源码）、精简产物收集（6 项→2 项：conversation.md + screenshots/）。关键防护：@e 引用导航后失效（强制重跑 snapshot）、Zustand store 不可靠（用 DOM 检测替代）、每个用例前 `$B restart` 防污染。

98. **项目目录清理**: 删除 10+ 冗余文件（临时截图、早期设计 demo、旧 package.json、node_modules），将散落根目录的 4 个文档移入 `docs/`。根目录从杂乱变为仅保留 CLAUDE.md 和 CONTEXT.md。

99. **AI 协作记录补充自定义 skill**: 发现 `ai-collaboration/` 缺少我们自己设计的 run-tests 和 debug-session，以及常用的 grill-with-docs。补充这 3 个可执行 skill 到 skills/ 目录和 skills/index.md（S8-S10），并在 journal/evolution/report/README 中融入业界"AI 增强开发三件套"（OpenSpec/Superpowers/gstack）框架——grill-with-docs 对应 OpenSpec 层（需求澄清），Superpowers+Plan Mode 对应执行纪律层，run-tests+debug-session 对应 gstack 交付闭环层。

## 参考外部项目

- **DeerFlow 2.0**: 14 层中间件洋葱模型, Lead Agent + Sub-Agent, Plan 模式, 三层记忆
- **M3-Agent**: 双进程并行 (Memorization + Control), 实体中心化记忆图, 多轮迭代推理
- **TRAE SOLO**: Plan 模式先出作战图, Agentic Edit, Sub Agent 并行, DiffView
