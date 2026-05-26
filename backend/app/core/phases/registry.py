"""阶段处理器注册表。"""

from app.core.phases.clarify import ClarifyHandler
from app.core.phases.comparison import ComparisonHandler
from app.core.phases.confirmed import ConfirmedHandler
from app.core.phases.executing import ExecutingHandler

PHASE_REGISTRY = {
    "clarify": ClarifyHandler(),
    "comparison": ComparisonHandler(),
    "confirmed": ConfirmedHandler(),
    "executing": ExecutingHandler(),
}
