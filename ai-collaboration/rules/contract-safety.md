# 前后端契约安全

> 来源：置顶功能 4 轮调试 + 字段命名不一致导致的静默 bug。这是项目中踩坑最多的一类问题。

## 命名一致性

**规则**: 后端 Pydantic schema 字段名 = 前端 interface 字段名，统一 snake_case。

**真实案例**: `SessionListItem` 返回 `pinned_at`/`agent_count`，前端 `SessionItem` 定义 `pinnedAt`/`agentCount`。JavaScript 静默返回 `undefined`，置顶功能和人数显示全坏，无任何错误提示。排查耗时 ~30 分钟。

## 初始化副作用检查

**规则**: 每个使用了 `useEffect(fn, [])` 或类似初始化逻辑的组件，必须验证：
1. 数据是否在 mount 时真正被加载？
2. 是否依赖了定义了但未被调用的函数？
3. 是否有"孤儿 hook"（定义了但没被任何组件 import）？

**真实案例**: `useContacts` hook 定义完整但未被任何组件导入。`refreshSessions()` 存在但只在 `handleAddMember`/`handleRemoveMember` 中调用，未在 mount 时执行。结果：API 返回 38 条会话，前端只显示 1 条。代码审查 3 轮没发现（逻辑看起来都对），浏览器一跑秒暴露。

## 状态更新策略

**规则**: 前端状态更新优先级：
1. **API-first**: 调 API → 用响应更新 store
2. **乐观更新**: 先更新 UI → 调 API → 失败回滚（仅低延迟场景）
3. **禁用**: 乐观更新 + 全量重拉（两个操作竞争导致闪烁和状态回退）

**真实案例**: `handleTogglePin` 同时做乐观更新 + `setSessions(全部重拉)`，两个操作竞争 → 会话列表闪烁、新会话突然全部出现。改为 API-first 单条更新后正常。

## API 响应约定

- Optional 字段序列化为 `null`，前端检查用 `!= null`
- 数组字段永远返回 `[]`，不返回 `null`
- datetime 序列化为 ISO 8601 字符串
