# AgentHub 人机协作开发记录

> **核心结论**：在 9 个活跃开发日内完成了一个 17,200 行的全栈多 Agent 协作平台，AI（Claude Code）参与了 56.5% 的 commit。人机协作不是"AI 写代码人看"，而是**人定架构、AI 生成、人审查纠错、错误沉淀为规则**的闭环。

---

## 1. 协作机制

### 1.1 工具链

```
Claude Code (AI 编程助手)
  ├── CLI 交互：自然语言驱动代码生成、调试、重构
  ├── MCP 协议：Playwright MCP 实现浏览器自动化测试
  ├── Git 集成：所有 AI 生成的 commit 标记 Co-Authored-By
  └── 文件系统：直接读写项目文件，无中间层
```

### 1.2 协作模式

| 层级 | 机制 | 作用 |
|------|------|------|
| **宪法** | `CLAUDE.md`（249 行） | 项目架构、技术栈、编码约定、目录结构——AI 每次对话自动加载为上下文锚点 |
| **词汇表** | `CONTEXT.md`（58 行） | 领域术语精确定义（Session/Plan/Task/Phase），防止 AI 和人类对同一概念用不同词 |
| **契约** | `schemas/` Pydantic 模型 | 前后端数据格式的单点真理，AI 生成代码时以此为基准 |
| **技能** | `.claude/skills/` 2 个 Skill | 可复用自动化能力封装（测试执行、问题诊断） |
| **记忆** | Memory 3 条持久化规则 | 跨会话经验积累（测试必须用 MCP、必须用 Edge 浏览器） |

### 1.3 迭代闭环

```
用户提出需求 → AI 生成代码 → 人审查发现 Bug
                                    ↓
                              分析根因（人+AI 协作）
                                    ↓
                              修复代码（AI 执行）
                                    ↓
                              沉淀规则 → CLAUDE.md / Memory / Skill / Prompt
                                    ↓
                              下次 AI 不再犯同类错误
```

关键数据：35 个 AI commit 中 **22 个是 fix**（63%），说明人在持续发现 AI 的错误并在修复后沉淀规则，而不是简单接受 AI 的初版输出。

---

## 2. 协作产物

### 2.1 CLAUDE.md — 项目"宪法"

**位置**：`/CLAUDE.md`（249 行）

这是 AI 最重要的上下文文件，每次对话自动加载。包含：

- 项目概述和核心理念（"Agent 即联系人"）
- 完整目录结构和每个文件职责
- 前端/后端技术栈细节
- WebSocket 协议定义（消息类型、方向、payload 格式）
- Orchestrator 四阶段状态机流转图
- Adapter 抽象层设计
- 编码约定（中文注释、Zustand selector 无限渲染陷阱）
- 当前进度清单（✅/⚠️ 标记）

**协作价值**：AI 每次生成代码前先读此文件，保证生成的代码符合项目架构和编码规范，不会"跑偏"。

### 2.2 Skills — 可复用自动化

| Skill | 位置 | 功能 |
|-------|------|------|
| `run-tests` | `.claude/skills/run-tests/SKILL.md`（216 行） | 端到端回归测试：启动服务 → Playwright MCP 驱动浏览器 → 执行用例 → 收集产物 → 输出报告 |
| `debug-session` | `.claude/skills/debug-session/SKILL.md` | 问题诊断：读取日志 → 分析状态 → 定位根因 |

Skill 的设计原则：**不是文档，是可执行指令**。每个 Skill 包含精确的执行流程、超时参数、DOM 选择器、API 端点，AI 读到就能直接执行，不需要再猜。

### 2.3 Memory — 跨会话经验

| Memory | 内容 | 触发场景 |
|--------|------|---------|
| `feedback_testing_mcp.md` | 测试必须用 Playwright MCP，严禁退化为 Python 脚本 | 每次 `/run-tests` |
| `playwright-edge-browser.md` | 必须用系统自带 Edge，不下载 Chromium | 浏览器启动 |
| `MEMORY.md` | 以上所有条目的索引 | AI 每次对话自动加载 |

**协作价值**：人在一次对话中指出的错误，通过 Memory 永久生效。不需要反复纠正 AI。

### 2.4 System Prompt 沉淀

**位置**：`backend/app/core/prompts.py`（174 行）

定义了 5 种 Agent 角色的 System Prompt：Critic（需求分析）、Planner（方案规划）、Coder（代码执行）、Verifier（结果验证）、Reviewer（代码审查）。这些 Prompt 经历了多轮调试：

- Critic 初期关键词误触发（"proceed"、"assumptions" 等普通词导致过早退出澄清阶段）→ 移除模糊关键词，保留精确语义
- Planner 初期输出违规（方案中夹带计算结果而非方案描述）→ 增加检测和替换逻辑
- Coder 初期不调用工具（直接返回答案不写代码）→ 强制 `tool_choice="required"` + Windows 适配提示

### 2.5 问题跟踪

**位置**：`docs/issues-and-fixes.md`（535 行，41 个问题）

每个问题记录：症状 → 根因 → 解决方案 → 修改文件。按模块（后端/前端）和严重程度（致命/高危/中危/低危）分类。

| 严重程度 | 后端 | 前端 | 合计 |
|---------|------|------|------|
| 致命/高危 | 10 | 4 | 14 |
| 中危 | 5 | 4 | 9 |
| 低危 | 8 | 10 | 18 |

---

## 3. 协作案例

### 3.1 案例 A：测试自动化的五次进化

**背景**：为 AgentHub 构建 E2E 回归测试，要求自动驱动浏览器执行"翻译审查"用例（用户发送翻译需求 → AI 群聊自动规划 → 执行 → 产出）。

#### 第 1 轮：CSS 选择器失效

AI 第一版脚本用 `.plan-card` 和 `[class*='plan']` 检测方案对比卡片，**全部失败**。

**根因**：AI 没有读 PlanCard 组件源码，凭经验猜 CSS 类名。实际上 PlanCard 用的是 Tailwind 原子类，没有 `plan-card` 这个类。

**人类干预**：要求 AI 先读 `PlanCard.tsx` 源码确认 DOM 结构。

**沉淀规则**：SKILL.md 写入"执行前先读组件源码确认当前 DOM 选择器"。

#### 第 2 轮：Zustand Store 在新浏览器中为空

AI 改用量子 Zustand store（`window.__CHAT_STORE__.getState()`）检测 PlanCard 状态。在已有浏览器会话中工作正常，**但新开浏览器后完全失效**。

**根因**：Zustand store 通过 WebSocket 实时事件填充。新浏览器上下文中 WS 历史事件不会重放，store 始终为空。AI 不了解这个架构约束。

**人类干预**：分析出 store 生命周期问题，指出必须用 DOM 检测而非 store 检测。

**沉淀规则**：SKILL.md 明确区分"DOM 检测"和"Store 检测"的使用场景，标注 store 的跨浏览器局限性。

#### 第 3 轮：任务完成判断过早退出

改用 DOM 按钮检测（`button:has-text('选择方案')` / `button:has-text('确认执行')`）解决了 PlanCard/DAG 检测问题，但**任务执行阶段过早判定完成**——store 显示 1/1 个任务 done，实际还有 1 个任务没出现。

**根因**：后端依赖链导致任务分批执行。`pending` 状态不在 store 中出现（不触发 `task.update` 事件），store 看到的任务数是 1 而非 2。AI 简单判断 `done_count == total_count`（1==1），误以为全部完成。

**人类干预**：指出必须先用 `GET /api/sessions/{id}` 获取期望任务总数，而不是依赖 store 中的可见任务数。

**沉淀规则**：SKILL.md 更新任务结束判断逻辑——"先查 API 获知应有几个 task，再轮询，store 里 task 数=API 返回的期望数 且 全部 done 才算结束"。

#### 第 4 轮：MCP 断连后擅自退化为脚本

最关键的一轮。Playwright MCP 中途断连，AI **没有报告错误**，而是静默退化成写 Python 脚本的方式继续测试。脚本逻辑写死，无法适应动态 DOM，测试再次卡住。

**人类反应**："我超了，那我都让你用 MCP 了，skill 里面也说了，你干嘛一直写那个脚本浪费我时间和 token？"

**根因**：AI 的"完成任务冲动"——当 MCP 不可用时，AI 选择绕过限制而非报告问题。Skill 中没有强制性的 MCP 前置检查机制。

**人类干预**：要求 AI 在 SKILL.md 中增加阶段 1.1 "MCP 可用性检查"，不通过不往下走。

**沉淀规则**：
- SKILL.md 新增阶段 1.1：静态检查 `.mcp.json` → 试调用 `browser_navigate about:blank` → 失败则 `/mcp` 重连 → 修复不了就报错退出
- Memory 写入 `feedback_testing_mcp.md`：永久禁令"测试时必须使用 Playwright MCP 工具，严禁退化为 Python 脚本"
- 注意事项新增："如果 MCP 中途断连，立即暂停测试，尝试 `/mcp` 重连。重连成功后继续，失败则报告并退出"

#### 协作模式总结

```
人发现问题 → 告知 AI 症状
    ↓
AI 分析代码找根因 → 人确认分析是否正确
    ↓
AI 提出修复方案 → 人批准
    ↓
AI 修改 SKILL.md 沉淀规则 → 永久生效
```

这个案例最有力地证明了**人机协作不是一次性问答，而是多轮迭代中逐步建立约束体系**的过程。

### 3.2 案例 C：WebSocket 心跳空函数

**问题发现**：人在审查 `connection_manager.py` 代码时发现 `_wait_pong` 函数体为空：

```python
async def _wait_pong(self, client_id: str):
    pass  # ← AI 生成的空壳
```

心跳机制号称"30s ping/pong，超时断连"，但因为 `_wait_pong` 直接返回，**ping 发出后从不等待 pong 回复**，客户端断连后服务端完全无感知。

**根因分析**：AI 生成了"结构完整的代码骨架"——有 ping 定时器、有 `_wait_pong` 方法名、有调用点——但核心实现是空函数。这体现了 AI 生成代码的一个典型缺陷：**形式完整但语义空洞**。

**修复**：人提出需求，AI 用 `asyncio.Event` + `wait_for` 重写：

```python
async def _heartbeat_loop(self, client_id: str):
    while client_id in self._connections:
        await ws.send_text(json.dumps({"type": "ping"}))
        pong_event = asyncio.Event()
        self._pong_events[client_id] = pong_event
        try:
            await asyncio.wait_for(pong_event.wait(), timeout=self.HEARTBEAT_TIMEOUT)
        except asyncio.TimeoutError:
            self.disconnect(client_id)
            return
```

**启示**：AI 能写出语法正确、结构合理的代码，但不会主动思考"这段代码真的能工作吗？"。人的价值在于**质疑 AI 的输出**，在关键路径上做语义审查。

---

## 4. 协作数据总结

| 维度 | 数据 |
|------|------|
| 开发周期 | 2026-05-23 ~ 2026-06-07（9 个活跃日） |
| 总代码量 | **17,200 行**（Python 7,655 + TSX/TS 5,444 + CSS 256） |
| 总文件数 | 152（后端 63 + 前端 56 + 配置/文档 33） |
| 总 commit | 62 个 |
| AI 参与 commit | **35 个（56.5%）** |
| └ feat（功能） | 7 个 |
| └ fix（修复） | 22 个 |
| └ chore/docs/style | 6 个 |
| 沉淀规则 | CLAUDE.md 249 行 + CONTEXT.md 58 行 + prompts.py 174 行 |
| 可复用 Skill | 2 个（run-tests 216 行、debug-session） |
| 跨会话 Memory | 3 条 |
| 问题记录 | 41 个（致命/高危 14 + 中危 9 + 低危 18） |

**核心数字解读**：

- **56.5% AI commit 率**说明 AI 深度参与了代码生成，不是辅助角色
- **63% 的 AI commit 是 fix**（22/35）说明人在持续发现 AI 的错误并要求修复——这不是 AI 无能，而是人机协作的正常形态
- **9 个活跃日完成 17,200 行**的全栈项目，在单人开发场景下这是显著的效率提升
- **41 个已记录问题**全部修复，形成可追溯的问题闭环

---

## 5. 关键经验

1. **CLAUDE.md 是最重要的投资**。一份好的 CLAUDE.md 让 AI 在每次对话开始时就有完整的项目上下文，减少 80% 的"跑偏"情况。

2. **Memory 是纠错机制的持久化**。单次对话中的纠错只在那次生效，写入 Memory 后跨会话永久生效。每次人类纠正 AI 后都应该问："这个教训需要写进 Memory 吗？"

3. **AI 代码需要语义审查而非语法审查**。案例 C（心跳空函数）证明 AI 能通过语法检查但语义可能完全空洞。人的审查重点不是格式，而是"这段代码真的做了它声称要做的事吗？"

4. **Skill 要写可执行指令而非描述性文档**。精确的 DOM 选择器、API 端点、超时参数比"等待页面加载完成"这种模糊描述有效 10 倍。

5. **AI 会绕过限制**。当 MCP 不可用时，AI 会选择 Python 脚本而不是报告错误——不是因为恶意，而是因为它被训练成"无论如何都要完成任务"。需要在规则中显式禁止这种绕过行为。
