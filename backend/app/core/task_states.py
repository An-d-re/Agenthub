"""任务状态机 —— 正式状态定义与合法转换。

状态流转：
    pending → ready → running → reviewing → done
                         ↓          ↓
                      retrying ← ── failed
                         ↓          ↓
                      blocked    dispute
                         ↓
                     cancelled
"""

from enum import StrEnum


class TaskState(StrEnum):
    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    REVIEWING = "reviewing"
    DONE = "done"
    RETRYING = "retrying"
    FAILED = "failed"
    BLOCKED = "blocked"
    DISPUTE = "dispute"
    CANCELLED = "cancelled"


# 合法状态转换
ALLOWED_TRANSITIONS: dict[TaskState, set[TaskState]] = {
    TaskState.PENDING: {TaskState.READY, TaskState.RUNNING, TaskState.CANCELLED},
    TaskState.READY: {TaskState.RUNNING, TaskState.CANCELLED},
    TaskState.RUNNING: {TaskState.REVIEWING, TaskState.RETRYING, TaskState.FAILED, TaskState.BLOCKED, TaskState.CANCELLED},
    TaskState.REVIEWING: {TaskState.DONE, TaskState.RETRYING, TaskState.DISPUTE, TaskState.CANCELLED},
    TaskState.RETRYING: {TaskState.RUNNING, TaskState.FAILED, TaskState.CANCELLED},
    TaskState.FAILED: {TaskState.RETRYING, TaskState.CANCELLED},
    TaskState.BLOCKED: {TaskState.PENDING, TaskState.CANCELLED},
    TaskState.DISPUTE: {TaskState.RETRYING, TaskState.CANCELLED},
    TaskState.DONE: set(),  # 终态
    TaskState.CANCELLED: set(),  # 终态
}

# 终态集合
TERMINAL_STATES = {TaskState.DONE, TaskState.CANCELLED}

# 旧状态名 → 新状态名（向后兼容映射）
LEGACY_MAP = {
    "in_progress": TaskState.RUNNING,
    "retry": TaskState.RETRYING,
}


def validate_transition(from_state: str, to_state: str) -> bool:
    """验证状态转换是否合法。"""
    f = TaskState(from_state)
    t = TaskState(to_state)
    return t in ALLOWED_TRANSITIONS.get(f, set())


def normalize_state(state: str) -> str:
    """将旧状态名映射为新状态名。"""
    return LEGACY_MAP.get(state, state)
