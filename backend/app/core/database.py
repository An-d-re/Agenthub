"""Async SQLAlchemy engine and session for SQLite."""

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=False,
    connect_args={"timeout": 30},  # 等待最多 30 秒而非默认 5 秒
)

# 启用 WAL 模式：允许多读 + 单写并发，消除绝大多数 "database is locked"
@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.close()

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create all tables on startup, seed default agents if empty."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 确保 WAL 模式已启用（兜底，即使 connect 事件未触发）
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA busy_timeout=30000"))

    # Seed default agents if DB is empty
    from sqlalchemy import select, func
    from app.models.agent import Agent

    async with async_session() as db:
        result = await db.execute(select(func.count()).select_from(Agent))
        if result.scalar() == 0:
            defaults = [
                Agent(
                    name="Critic · 需求分析师",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["需求分析", "问题澄清", "技术评估"],
                    system_prompt="你是一位技术顾问，擅长在项目开始前质疑需求、澄清模糊点。"
                    "你会提出最多3个具体问题，帮助用户明确范围、约束和技术选型。"
                    "你最多进行2轮提问，之后明确给出假设并准备好推进。",
                    is_deletable=False,
                ),
                Agent(
                    name="Planner · 架构师",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["方案设计", "任务分解", "架构规划"],
                    system_prompt="你是一位项目规划师，擅长方案对比和任务分解。"
                    "你能给出多种技术方案并分析利弊，选定后将其拆解为3-7个原子化任务。"
                    "每个任务有清晰的依赖关系和可验证的交付物。",
                    is_deletable=False,
                ),
                Agent(
                    name="Coder · 全栈工程师",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["代码生成", "调试", "重构", "Python", "TypeScript", "React"],
                    system_prompt="你是一位资深全栈工程师，擅长 Python、TypeScript、React。"
                    "生成代码时遵循最佳实践，包含错误处理和类型注解。"
                    "产出完整可运行的代码，标注文件路径。回复简洁，只在被问到时才解释代码。",
                    is_deletable=False,
                ),
                Agent(
                    name="Reviewer · 代码审查",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["代码审查", "安全审计", "性能优化"],
                    system_prompt="你是一位严格的代码审查者。检查代码的正确性、安全性和性能。"
                    "对每个问题给出具体的改进建议。不要纠结于代码风格偏好。"
                    "输出 JSON 格式：{passed, feedback, suggested_changes}。",
                    is_deletable=False,
                ),
            ]
            db.add_all(defaults)
            await db.commit()
            import logging
            logging.getLogger(__name__).info("Seeded %d default agents", len(defaults))


async def get_db() -> AsyncSession:
    """Dependency: yield an async database session."""
    async with async_session() as session:
        yield session
