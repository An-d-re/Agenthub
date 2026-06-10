# 架构约束

> 来源：CLAUDE.md 架构章节 + 实际目录结构。这些约束在架构升级（God Object → Phase Handler）后固化。

## 项目结构

- Orchestrator 在 `backend/app/core/orchestrator.py`，不在 services 下
- EventBus 在 `backend/app/core/event_bus.py`，全局单例
- Phase 处理器在 `core/phases/`，通过 `PHASE_REGISTRY` 字典注册
- 所有 Adapter 在 `backend/app/services/adapters/`，继承 `base.py`
- SQLAlchemy 模型在 `backend/app/models/`
- Pydantic schema 在 `backend/app/schemas/`

## 通信约束

- 前后端实时通信：FastAPI 原生 WebSocket（`/ws/{session_id}`），不用 socket.io
- 后端内部事件：`asyncio.Queue`（全局单例 EventBus，per-session 隔离），不引入 Redis/RabbitMQ/Kafka
- REST 用于：会话 CRUD、历史消息查询、Agent 配置等非实时数据

## 不引入的依赖

这些是比赛单机部署明确不需要的：

- Redis / RabbitMQ / Kafka（asyncio.Queue 单机足够）
- Celery / 外部任务队列
- socket.io（FastAPI 原生 WS 已覆盖）
- 任何认证库（平台无登录设计）

## Middleware 链

执行阶段三层中间件，顺序不可变：

1. **ContextSummarizer** — 上下文超阈值时 LLM 压缩（>50 条或 >8K tokens），LLM 不可用时降级规则摘要
2. **LoopDetector** — MD5 签名追踪重复任务（≥3 次同签名标记 blocked）
3. **SubagentLimiter** — `asyncio.Semaphore(3)` 控制并行 Agent 数

## Adapter 降级链

所有 Adapter 初始化时检查 API key，无 key 自动降级 DeepSeekAdapter：

```
AnthropicAdapter → DeepSeekAdapter（降级）
OpenCodeAdapter → DeepSeekAdapter（降级，继承）
CodexAdapter → DeepSeekAdapter（空桩，完全继承）
```
