"""Async SQLAlchemy engine and session for SQLite."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(settings.database_url, echo=False)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    """Create all tables on startup, seed default agents if empty."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed default agents if DB is empty
    from sqlalchemy import select, func
    from app.models.agent import Agent

    async with async_session() as db:
        result = await db.execute(select(func.count()).select_from(Agent))
        if result.scalar() == 0:
            defaults = [
                Agent(
                    name="DeepSeek Coder",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["代码生成", "调试", "重构"],
                    system_prompt="你是一位资深全栈工程师，擅长 Python、TypeScript、React。"
                    "生成代码时遵循最佳实践，包含错误处理和类型注解。"
                    "回复简洁，只在被问到时才解释代码。",
                    is_deletable=False,
                ),
                Agent(
                    name="Claude Reviewer",
                    role_type="system",
                    adapter_type="anthropic",
                    capability_tags=["代码审查", "安全审计", "性能优化"],
                    system_prompt="你是一位严格的代码审查者。检查代码的正确性、安全性和性能。"
                    "对每个问题给出具体的改进建议。不要纠结于代码风格偏好。",
                    is_deletable=False,
                ),
                Agent(
                    name="SQL Optimizer",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["数据库", "SQL优化", "数据建模"],
                    system_prompt="你是一位数据库专家，擅长 SQL 优化、索引设计和数据建模。"
                    "给出可执行的 SQL 语句，并解释优化原理。",
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
