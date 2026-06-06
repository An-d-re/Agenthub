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


async def _migrate_existing_tables(conn):
    """为已有表补全缺失列，防止模型变更后 create_all 不更新已有表。"""
    import sqlite3
    # Agent: is_temp, encrypted_api_key (added after initial schema)
    existing = {r[1] for r in (await conn.execute(text("PRAGMA table_info(agents)"))).fetchall()}
    if "is_temp" not in existing:
        await conn.execute(text("ALTER TABLE agents ADD COLUMN is_temp BOOLEAN DEFAULT 0"))
    if "encrypted_api_key" not in existing:
        await conn.execute(text("ALTER TABLE agents ADD COLUMN encrypted_api_key TEXT"))
    # Plan: clarify_round (added after initial schema)
    existing_plans = {r[1] for r in (await conn.execute(text("PRAGMA table_info(plans)"))).fetchall()}
    if "clarify_round" not in existing_plans:
        await conn.execute(text("ALTER TABLE plans ADD COLUMN clarify_round INTEGER DEFAULT 0"))


async def init_db():
    """Create all tables on startup, seed default agents if empty."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # 确保 WAL 模式已启用（兜底，即使 connect 事件未触发）
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA busy_timeout=30000"))
        await _migrate_existing_tables(conn)

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
            ]
            db.add_all(defaults)
            await db.commit()
            import logging
            logging.getLogger(__name__).info("Seeded %d default agents", len(defaults))


async def get_db() -> AsyncSession:
    """Dependency: yield an async database session."""
    async with async_session() as session:
        yield session
