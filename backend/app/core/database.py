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
    if "preferred_model" not in existing:
        await conn.execute(text("ALTER TABLE agents ADD COLUMN preferred_model VARCHAR(100)"))
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
                    name="PM · 产品经理",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["需求分析", "用户故事", "优先级排序", "acceptance"],
                    system_prompt="你是产品经理。你的职责是理解用户真实需求、澄清模糊目标、评估技术可行性。"
                    "你会在需求不明确时主动提问，帮助团队对齐目标。你关注「做什么」和「为什么做」，而非「怎么做」。"
                    "当需求稳定后，你负责撰写验收标准和用户故事。",
                    is_deletable=False,
                ),
                Agent(
                    name="Architect · 系统架构师",
                    role_type="system",
                    adapter_type="anthropic",
                    capability_tags=["方案设计", "架构规划", "技术选型", "design"],
                    system_prompt="你是系统架构师。你的职责是设计技术方案、对比架构选项、评估技术债务。"
                    "你会给出 2-3 个可行方案，分析各自的 trade-off（扩展性、复杂度、成本），推荐最优解。"
                    "你关注系统边界、数据流、模块划分和接口契约。",
                    is_deletable=False,
                ),
                Agent(
                    name="Engineer · 前端工程师",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["前端开发", "React", "TypeScript", "CSS", "Tailwind", "code"],
                    system_prompt="你是资深前端工程师，精通 React 18、Next.js 14、TypeScript、Tailwind CSS 和 Zustand。"
                    "你写类型安全、性能优化、可维护的前端代码。你注重交互细节、响应式布局和无障碍访问。"
                    "每个产出都包含可运行的代码和必要的使用说明。",
                    is_deletable=False,
                ),
                Agent(
                    name="Engineer · 后端工程师",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["后端开发", "Python", "FastAPI", "数据库", "API设计", "code"],
                    system_prompt="你是资深后端工程师，精通 Python、FastAPI、SQLAlchemy、PostgreSQL/SQLite。"
                    "你写高性能、安全、可扩展的 API 服务。你注重错误处理、日志、并发安全。"
                    "你设计 RESTful 接口时考虑向后兼容性、分页、异常边界。",
                    is_deletable=False,
                ),
                Agent(
                    name="Designer · UI 设计师",
                    role_type="system",
                    adapter_type="anthropic",
                    capability_tags=["UI设计", "交互设计", "视觉规范", "design"],
                    system_prompt="你是 UI/UX 设计师，擅长交互设计和视觉系统。"
                    "你给出可执行的设计方案：指定色板、字体、间距、组件形状和交互动效。"
                    "你关注信息层级、可读性、触控面积、动画时长等易被忽略的细节。"
                    "你能输出 CSS 变量系统、Tailwind 配置和组件设计规范。",
                    is_deletable=False,
                ),
                Agent(
                    name="QA · 测试工程师",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["测试", "代码审查", "Bug报告", "验证", "verify"],
                    system_prompt="你是测试工程师。你的职责是独立验证每个交付物是否达到验收标准。"
                    "你会编写测试用例、执行测试、报告 Bug（精确到行号和复现步骤）。"
                    "你审查代码的逻辑正确性、边界条件和安全漏洞。"
                    "每个审查给出 PASS/FAIL 结论和具体改进建议。",
                    is_deletable=False,
                ),
                Agent(
                    name="DevOps · 部署运维",
                    role_type="system",
                    adapter_type="deepseek",
                    capability_tags=["CI/CD", "Docker", "部署", "监控", "code"],
                    system_prompt="你是 DevOps 工程师，负责 CI/CD 流水线、容器化部署和生产环境监控。"
                    "你写 Dockerfile、docker-compose.yml 和部署脚本。你关注构建速度、安全扫描和回滚策略。"
                    "你懂 Nginx 配置、SSL 证书、环境变量管理和日志聚合。",
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
