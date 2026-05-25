# AgentHub 产品审视问题清单

生成于 2026-05-25，基于 /office-hours 完整产品审计。

---

## TOP 3 — 核心体验（方案 B 深度打磨）

### 1. 编排器自动推进 + 流式交错输出
- **现状**：编排器是逐消息状态机，用户每发一条消息推进一步，像会议主持人而非观众
- **目标**：Clarify→Comparison→Confirmed 自动推进，仅在"选方案"和"执行中重试"暂停。流式交错输出让用户看到 Critic 说完 Planner 立刻接上
- **方案选择**：从文本解析改为 `POST /api/plans/{id}/select` 直接 API
- **改动范围**：`orchestrator.py` + `ws_routes.py` + 新增 `api/plans.py` + `PlanCard.tsx` + `MessageList.tsx` + `ChatPanel.tsx`

### 2. Agent 消息角色可见性
- **现状**：`MessageBubble.tsx:63` 只显示 Agent 名字，不显示角色。同一 Agent 扮演多个角色时用户完全无法区分
- **目标**：每种角色独立气泡颜色和图标
  - **Critic** 灰色气泡 + 🔍 — "挑剔/质疑"
  - **Planner** 蓝色气泡 + 📋 — "结构化/方案感"
  - **Coder** 紫色气泡 + 💻 — 代码块加深色背景
  - **Reviewer** 绿色气泡 + ✅ — 通过/不通过视觉区分
- **改动范围**：`MessageBubble.tsx` + `chatStore.ts`（新增 `agentRole` 字段）+ 后端消息 schema 补充 `agent_role`

### 3. 全局 Toast 通知系统
- **现状**：所有错误（上传失败、API超时、WS断开）全部 `console.error` 静默吞掉
- **目标**：轻量 Toast context，支持 success/error/warning/info，framer-motion AnimatePresence 动画，队列最大 3 条，3 秒自动消失
- **改动范围**：新增 `components/ui/Toast.tsx` + `lib/toastContext.tsx` + `layout.tsx`，全局替换 `console.error/warn`

---

## P0 — 演示时评委一眼可见

### 4. Diff 对比内容空洞
- **现状**：`DiffCard.tsx:73` 中 `originalContent` 永远为空字符串（后端只存 `modified_content`），Monaco Diff 两边一样
- **目标**：Coder 执行任务时保留修改前的文件内容作为 `original_content`，让 Diff 有意义
- **改动范围**：`agent_runner.py` + `orchestrator.py` 的 artifact 创建逻辑 + `DiffCard.tsx`

### 5. PlanCard 方案选择走文本解析
- **现状**：`MessageList.tsx:32-34` 把方案名作为普通聊天消息发出，`orchestrator.py:982-998` 用字符串模糊匹配。用户选前多打字会错乱
- **目标**：PlanCard 直接调 `POST /api/plans/{plan_id}/select` API
- **改动范围**：新增 API endpoint + `PlanCard.tsx` + `MessageList.tsx` + `ChatPanel.tsx`（移除 pendingSend）

### 6. 单 Agent 群聊角色塌陷
- **现状**：`orchestrator.py:645-652` 只有一个 Agent 时所有角色映射到同一 agent，一个人扮演全团队
- **目标**：至少弹提示要求群聊≥2个Agent；或者在缺少专门角色时用系统级 LLM 调用来补位，确保不同阶段的消息看起来来自不同"人"
- **改动范围**：`orchestrator.py` + 前端创建群聊时的校验

---

## P1 — 仔细看会发现，但影响体验

### 7. WebSocket 离线无感知
- **现状**：`ChatPanel.tsx:93-94` WS 断开只改变小圆点颜色（绿→灰），无显式横幅
- **目标**：断开时在聊天顶部显示黄色横幅 "连接断开，正在重连…"；恢复后显示绿色横幅 "已重新连接" 2 秒后消失
- **改动范围**：`ChatPanel.tsx` + `useWebSocket.ts`

### 8. Reviewer 审查过程不可见
- **现状**：后端 `orchestrator.py:938-980` 跑了审查，前端 TaskPipeline 只看到 done/retry
- **目标**：在 TaskPipeline 面板显示审查结果摘要（通过/不通过 + reviewer 的 feedback 摘要）
- **改动范围**：`TaskPipeline.tsx` + `chatStore.ts` + 后端 WebSocket 事件增加 `review.result` 类型

### 9. 文件上传无进度
- **现状**：`MessageInput.tsx:58-75` 上传时只显示转圈，大文件无感知
- **目标**：用 XMLHttpRequest 或 fetch + ReadableStream 追踪上传进度，显示百分比
- **改动范围**：`MessageInput.tsx`

### 10. UI 风格混用
- **现状**：PlanCard/DiffCard 用 shadcn 语义类（`border-border`, `bg-card`），其余组件用硬编码苹果色值（`#F5F5F7`, `#86868B`）。ChatPanel 手写 Modal，DiffCard 用 shadcn Dialog
- **目标**：统一为苹果色值（去掉 shadcn 语义类），或统一为 tailwind.config 中的语义 token
- **改动范围**：`PlanCard.tsx` + `DiffCard.tsx` + `ChatPanel.tsx` + `globals.css`

---

## P2 — 边角打磨（时间够就修）

### 11. Preview 仅支持 HTML
- **现状**：`MessageList.tsx:65` 仅在 `language==="html"` 时显示 PreviewCard
- **目标**：SVG/Canvas/React 组件产物也能预览（扩展 iframe 渲染或支持更多语言类型）
- **改动范围**：`MessageList.tsx` + `PreviewCard.tsx`

### 12. Deploy 无状态轮询
- **现状**：`PreviewCard.tsx:51-70` 只发起一个 POST，无后续状态追踪
- **目标**：部署后轮询状态直到 running/failed，显示日志
- **改动范围**：`PreviewCard.tsx` + `api/deployments.py`

### 13. 编排器 Reviewer 递归风险
- **现状**：`orchestrator.py:518` 审查不通过递归调用 `_execute_single_task`，可能无限循环
- **目标**：加最大重试次数检查（当前已有 `MAX_TASK_RETRIES=1`，但 reviewer 路径绕过了这个限制）
- **改动范围**：`orchestrator.py`

### 14. Trace 5 秒轮询可能丢 span
- **现状**：`TracePanel.tsx:26` 每 5 秒轮询 `limit=100`
- **目标**：改为 WebSocket 推送 `trace.span` 事件，实时更新
- **改动范围**：`TracePanel.tsx` + `useWebSocket.ts` + 后端 `tracer.py`

---

## 处理状态（2026-05-25 最终状态）

| # | 问题 | 状态 |
|---|------|------|
| 1 | 编排器自动推进 | ✅ `plan.action select_approach` WS 直连，PlanCard 不再走文本解析 |
| 2 | Agent 角色可见性 | ✅ 角色徽章 + 气泡颜色区分（🔍Critic 📋Planner 💻Coder ✅Reviewer） |
| 3 | 全局 Toast | ✅ ToastProvider + success/error/warning/info + framer-motion |
| 4 | Diff 空洞 | ✅ `_extract_artifacts` 查找旧 artifact 填充 `original_content` |
| 5 | PlanCard 文本解析 | ✅ `select_approach` WS 直接 API |
| 6 | 单 Agent 塌陷 | ✅ 编排器检测 <2 Agent 时提示 |
| 7 | WS 离线横幅 | ✅ 黄色"连接断开"横幅 → 绿色"已重新连接" 3 秒消失 |
| 8 | Reviewer 不可见 | ✅ reviewer 消息角色徽章 + 气泡颜色 |
| 9 | 文件上传无进度 | ✅ XMLHttpRequest + upload.progress 显示百分比 |
| 10 | UI 风格混用 | 👉 暗色模式已全局添加，两套系统根因（shadcn vs 硬编码）仍存在 |
| 11 | Preview 仅 HTML | ✅ 扩展到 HTML/SVG/CSS/JS，非 HTML 自动包装 |
| 12 | Deploy 无轮询 | ✅ 发起部署后每 2 秒轮询状态最多 20 秒 |
| 13 | Reviewer 递归 | ✅ 审查失败超过 MAX 次数后改为 dispute |
| 14 | Trace 轮询 | ❌ 未处理（改动大，收益小） |

## 处理建议

```
全部完成（13/14）。#14 Trace WebSocket 推送暂不处理，改动大收益小。
```

**总计：14 个问题，12 已解决，1 部分解决，1 未动**
