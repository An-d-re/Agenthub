# 架构约束

> 这些规则供 AI 编码时遵循。偏离需在 PR 描述中说明理由。

## 项目结构约束

- Orchestrator 在 `backend/app/core/orchestrator.py`，不在 services 下
- EventBus 在 `backend/app/core/event_bus.py`，全局单例
- 所有 Adapter 在 `backend/app/services/adapters/`，继承 `base.py`
- 所有 SQLAlchemy 模型在 `backend/app/models/`
- 所有 Pydantic schema 在 `backend/app/schemas/`

## 通信约束

- 前端 → 后端实时: 原生 WebSocket (ws://)，不使用 socket.io
- 后端内部事件: `asyncio.Queue`，不使用 Redis/RabbitMQ
- REST 仅用于: 会话 CRUD, 历史消息查询, Agent 配置, 非实时数据

## 不引入的依赖

- Redis / RabbitMQ / Kafka（比赛单机部署）
- Celery / 任何外部任务队列（asyncio.Queue 足够）
- socket.io（FastAPI 原生 WS 已够用）
- 任何认证库（无登录设计）

## Middleware 链

执行阶段三层中间件，按序调用，顺序不可变:

1. **ContextSummarizer** — 上下文超阈值压缩
2. **LoopDetector** — 重复任务签名检测
3. **SubagentLimiter** — 并行 Agent 数 ≤ 3

## 反驳机制上限

- Coder ↔ Reviewer: 最多 1 轮 rebuttal
- Coder → Planner: 拒绝任务时必须给出具体理由 + 替代建议
- Agent → User: 仅安全/性能层面可拒绝，需解释并提供正确方案
- 任何不一致最终交用户裁决（`dispute` 状态 + 系统消息）
