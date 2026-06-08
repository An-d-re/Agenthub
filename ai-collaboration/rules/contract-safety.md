# 前后端契约安全

> 前端和后端通过 JSON API 通信。字段命名不一致是最常见的静默 bug —— 不抛错，但功能全坏。

## 命名一致性

- 后端 Pydantic schema 的字段名 = 前端 interface 的字段名
- 统一使用 snake_case（Python/JSON 原生），不要在前端做 camelCase 转换
- 新加字段时，同时检查后端 schema 和前端 interface 是否对齐

**真实案例**: `SessionListItem` 返回 `pinned_at`/`agent_count`，前端 `SessionItem` 定义 `pinnedAt`/`agentCount`。JavaScript 静默返回 `undefined`，置顶功能和人数显示全坏，无任何错误提示。

## API 响应类型检查

- Optional 字段序列化为 `null`，前端检查用 `s.field != null` 而非 `s.field ? ...`
- datetime 序列化为 ISO 8601 字符串，前端直接使用不需要额外解析
- 数组字段永远返回 `[]`，不返回 `null`

## 初始化副作用检查

每一个使用了 `useEffect(fn, [])` 或类似初始化逻辑的组件，必须验证：
1. 数据是否在 mount 时真正被加载？
2. 是否依赖了定义了但未被调用的函数？
3. 是否有"孤儿 hook"（定义了但没被任何组件 import）？

**真实案例**: `useContacts` hook 定义完整但未被任何组件导入。`refreshSessions()` 方法存在但未在 mount 时调用。37 条历史会话在数据库中但前端只显示 1 条。

## 状态更新策略

前端状态更新优先级：
1. **API-first**: 调 API → 用响应中的值更新 store（数据权威）
2. **乐观更新**: 先更新 UI → 调 API → 失败则回滚（仅用于低延迟场景）
3. **❌ 乐观更新 + 全量重拉**: 两个操作冲突，导致闪烁和状态回退

**真实案例**: `handleTogglePin` 同时做乐观更新 + `setSessions(全部重拉)`，两个操作竞争 → 会话列表闪烁、新会话突然出现。改为 API-first 单条更新后正常。

## 后端无过滤查询

GET 端点如有分页/过滤需求，必须在后端实现。前端不应假设后端返回的数据集大小。

**真实案例**: `GET /api/sessions` 无 status 过滤，返回包括 archived 在内的所有会话。如果未来引入软删除，必须在后端加 `WHERE status = 'active'`。
