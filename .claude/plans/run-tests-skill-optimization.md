# run-tests SKILL.md 优化方案

## 目标

1. 降低每次 `/run-tests` 调用的 token 消耗（预计降低 60-70%）
2. 保持（甚至提升）测试执行可靠性
3. 为前端 UI 改版后的快速适配做准备

## 修改方案

### 改动 1：浏览器操作从 MCP 切换到 gstack browse 二进制

**原因**：MCP `browser_snapshot` 返回完整 DOM 树，每次调用消耗数千 token。gstack `$B snapshot -i` 只返回可交互元素 + @e 短引用，每次只需几十到几百 token。

**具体变更**：
- Phase 1.1（MCP 检查）→ 替换为 gstack browse 可用性检查（运行 `$B` 路径解析 + `$B status`）
- Phase 2.2/2.3 中的 `browser_navigate`/`browser_click`/`browser_type`/`browser_snapshot`/`browser_take_screenshot` → 替换为对应的 `$B` 命令
- 交互流程变更为：`$B snapshot -i` → Claude 读 @e 引用 → `$B click @eN` → `$B snapshot -D` 验证变化 → `$B screenshot`
- 封面页处理：`$B snapshot -i` → 检测 "开始使用" 按钮 → `$B click @eN`
- button:has-text() CSS 查询 → 改为 `$B snapshot -i` 输出文本匹配

**风险点**（已在方案讨论中识别并写入 SKILL.md）：
| 风险 | 防护措施（写入 SKILL.md） |
|------|------------------------|
| @e 引用在页面导航后失效 | 每次 `$B goto` 后强制 `$B snapshot -i` 刷新引用 |
| 二进制不可用 | Phase 1 新增 `$B` 路径检测 + 启动失败诊断 |
| 浏览器状态残留 | 每个用例执行前 `$B storage` 检查 + `$B restart` 清空 |
| snapshot 文本中找不到目标按钮 | 降级策略：用 `$B js` 遍历 button 文本查找 |

### 改动 2：SKILL.md 大幅精简（目标 216 行 → ~80 行）

**原因**：当前 SKILL.md 充满冗余和常识性描述，每次调用全部加载到上下文。

**具体删减**：

| 区域 | 当前行数 | 精简后 | 删减策略 |
|------|---------|--------|---------|
| Phase 1.1 MCP 检查（3 层回退） | ~25 行 | ~8 行 | 替换为 gstack status 检查 + 重连尝试 |
| Phase 1.2 启动服务 | ~8 行 | ~5 行 | 保留关键命令，删除多余说明 |
| Phase 2.1 解析用例 | ~8 行 | ~5 行 | 合并 frontmatter 说明 |
| Phase 2.3 步骤表（8 种全部展开） | ~12 行 | ~6 行 | 只保留 3 种有坑的类型，其余 5 种用一句话概括 |
| Phase 2.4 自动截图节点 | ~10 行 | ~4 行 | 精简为事件→截图映射 |
| Phase 3 产物收集（展开目录树） | ~8 行 | ~4 行 | 目录结构压缩为一行路径模式 |
| Phase 4/5/6 清理+关闭+摘要 | ~18 行 | ~8 行 | 去重、合并 |
| 步骤解析规则（独立章节） | ~8 行 | 合并到 Phase 2.1 | 消除重复 |
| 对话记录格式（独立章节） | ~35 行 | ~12 行 | 模板精简 |
| 注意事项 | ~10 行 | ~4 行 | 只保留非直觉项 |
| 概述/何时使用/执行流程标题 | ~10 行 | ~3 行 | 合并 |
| **新增：按钮文本常量区** | 0 行 | ~4 行 | 集中定义，替代读源码 |

**必须保留的非直觉逻辑**（4 条）：
1. 任务完成判断必须先查 API 拿期望任务总数
2. 单方案时后端不发送 plan.comparison，按钮直接从选择变为确认
3. 新浏览器上下文需处理封面页
4. Zustand store 在浏览器重开时为空但 DOM 已渲染

**必须保留的 MCP 血泪教训**（浓缩为 1 行警告）：
> 所有浏览器操作必须通过 `$B` 二进制执行，禁止退化写 Python/Node 脚本（脚本固定逻辑无法应对多分支场景，会导致空转）

### 改动 3：按钮文本常量区（替代读源码）

在 SKILL.md 顶部新增：

```
## UI 常量（UI 改版时修改此区域）
- 封面开始按钮:    "开始使用"
- 方案选择按钮:    "选择方案" 前缀匹配
- DAG 确认按钮:    "确认执行" 精确匹配
- 已选择标记:      "✓ 已选择"
- 已确认标记:      "已确认 ✓"
```

消除 Phase 2.3 中的"执行前先读 PlanCard.tsx/DAGEditor.tsx"指令。

### 改动 4：产物收集精简（方案 B）

**决定**：砍掉冗余产物，只保留 `conversation.md` + `screenshots/`。

| 产物 | 决定 | 原因 |
|------|------|------|
| conversation.md | ✅ 保留 | 主审阅材料，Agent 输出含代码 |
| screenshots/ | ✅ 保留 | 视觉验证必需品 |
| artifacts/ | ❌ 砍掉 | 代码已在 Agent 消息中，单独拉取重复且当前有 bug |
| raw_messages.json | ❌ 砍掉 | 与 conversation.md 同一份数据 |
| console.log | ⚠️ 仅出错时 | 正常情况下无用 |
| network.json | ❌ 砍掉 | 几乎没被查看过 |

Phase 3 从原来收集 6 项 → 变为 2 项（+ 出错时加 console.log），大幅降低执行时间和 token 消耗。

### 改动 5：风险项防护措施写入 SKILL.md

| 风险 | SKILL.md 中的防护指令 |
|------|---------------------|
| @e 引用失效 | 导航后必须重跑 snapshot |
| debug-session 二进制不可用 | Phase 1 一步检查，失败则报告退出 |
| 浏览器状态残留 | 每个用例前 `$B restart` |
| 超时策略不一致 | 保留超时常量定义（60s/120s/用例timeout） |
| 清理容错 404 | "清理失败继续不中断"指令保留 |
| 步骤解析歧义（Critic 检测） | 精简但保留：DOM 出现 `.agent-role-critic` 元素 = Critic 已发言 |

## 不变的部分

- 测试用例 Markdown 格式不变
- 产物目录结构不变
- 批次摘要格式不变
- 与 `/debug-session` 的联动关系不变
- curl 调用 REST API 的方式不变

## 不涉及的范围

- debug-session/SKILL.md（本次不修改）
- 测试用例文件
- 后端代码
- 前端代码
