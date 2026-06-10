"""Session CRUD + Message history + Pin management."""

from datetime import datetime, timezone

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.agent import Agent
from app.models.message import Message, PinnedMessage
from app.models.session import Session, SessionAgent
from app.models.plan import Plan
from app.models.task import Task
from app.schemas.message import MessageResponse, PinToggle
from app.schemas.session import SessionCreate, SessionListItem, SessionResponse, PlanResponse, TaskStatusResponse

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _utcnow():
    return datetime.now(timezone.utc)


def _session_to_item(s: Session, last_msg: str = "") -> SessionListItem:
    return SessionListItem(
        id=s.id,
        title=s.title,
        type=s.type,
        status=s.status,
        pinned_at=s.pinned_at,
        last_active_at=s.last_active_at,
        last_message_preview=last_msg,
        agent_count=len(s.agents) if s.agents else 0,
        agent_ids=[a.agent_id for a in s.agents] if s.agents else [],
    )


@router.get("", response_model=list[SessionListItem])
async def list_sessions(
    search: str | None = Query(None, description="搜索会话标题"),
    db: AsyncSession = Depends(get_db),
):
    q = select(Session).options(selectinload(Session.agents))
    if search:
        q = q.where(Session.title.ilike(f"%{search}%"))
    q = q.order_by(desc(Session.pinned_at), desc(Session.last_active_at))
    result = await db.execute(q)
    sessions = result.scalars().all()
    return [_session_to_item(s) for s in sessions]


@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(body: SessionCreate, db: AsyncSession = Depends(get_db)):
    session = Session(title=body.title, type=body.type)
    db.add(session)
    await db.flush()

    for agent_id in body.agent_ids:
        db.add(SessionAgent(session_id=session.id, agent_id=agent_id))

    if body.type == "group":
        await _ensure_system_agents(db, session.id, body.agent_ids)

    await db.commit()
    await db.refresh(session)
    return await _build_session_response(session.id, db)


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    return await _build_session_response(session_id, db)


@router.delete("/{session_id}")
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    await db.delete(session)
    await db.commit()
    return {"ok": True}


@router.put("/{session_id}/archive")
async def toggle_archive(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    session.status = "archived" if session.status == "active" else "active"
    await db.commit()
    return {"status": session.status}


@router.put("/{session_id}/pin")
async def toggle_pin(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.pinned_at:
        session.pinned_at = None
    else:
        session.pinned_at = _utcnow()
    await db.commit()
    return {"pinned_at": session.pinned_at}


@router.get("/{session_id}/messages", response_model=list[MessageResponse])
async def list_messages(
    session_id: str,
    limit: int = Query(50, le=200),
    before: str | None = Query(None, alias="before"),
    since: str | None = Query(None, alias="since"),
    db: AsyncSession = Depends(get_db),
):
    q = select(Message).where(Message.session_id == session_id).order_by(desc(Message.created_at))
    if before:
        q = q.where(Message.created_at < before)
    if since:
        q = q.where(Message.created_at > since)
    q = q.limit(limit)
    result = await db.execute(q)
    return list(reversed(result.scalars().all()))


@router.post("/{session_id}/pin")
async def pin_message(session_id: str, body: PinToggle, db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    if body.pin:
        existing = await db.execute(
            select(PinnedMessage).where(
                PinnedMessage.session_id == session_id,
                PinnedMessage.message_id == body.message_id,
            )
        )
        if not existing.scalar_one_or_none():
            db.add(PinnedMessage(session_id=session_id, message_id=body.message_id))
    else:
        result = await db.execute(
            select(PinnedMessage).where(
                PinnedMessage.session_id == session_id,
                PinnedMessage.message_id == body.message_id,
            )
        )
        if pm := result.scalar_one_or_none():
            await db.delete(pm)

    await db.commit()
    return {"ok": True}


@router.get("/{session_id}/pins", response_model=list[MessageResponse])
async def list_pinned(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Message)
        .join(PinnedMessage, PinnedMessage.message_id == Message.id)
        .where(PinnedMessage.session_id == session_id)
        .order_by(desc(PinnedMessage.pinned_at))
    )
    return result.scalars().all()


@router.post("/{session_id}/agents/{agent_id}")
async def add_agent_to_session(session_id: str, agent_id: str, db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    existing = await db.execute(
        select(SessionAgent).where(
            SessionAgent.session_id == session_id,
            SessionAgent.agent_id == agent_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"ok": True, "detail": "already in session"}
    db.add(SessionAgent(session_id=session_id, agent_id=agent_id))
    await db.commit()
    return {"ok": True}


@router.delete("/{session_id}/agents/{agent_id}")
async def remove_agent_from_session(session_id: str, agent_id: str, db: AsyncSession = Depends(get_db)):
    agent = await db.get(Agent, agent_id)
    if agent and agent.role_type == "system":
        raise HTTPException(403, "系统 Agent 不可从群聊中移除")
    result = await db.execute(
        select(SessionAgent).where(
            SessionAgent.session_id == session_id,
            SessionAgent.agent_id == agent_id,
        )
    )
    if sa := result.scalar_one_or_none():
        await db.delete(sa)
        await db.commit()
    return {"ok": True}


@router.get("/{session_id}/plan")
async def get_session_plan(session_id: str, db: AsyncSession = Depends(get_db)):
    """返回会话的完整任务计划（DAG + 运行时状态），供前端刷新/切换会话时恢复协作剧场。"""
    plan_result = await db.execute(
        select(Plan).where(Plan.session_id == session_id)
        .order_by(Plan.created_at.desc()).limit(1)
    )
    plan = plan_result.scalar_one_or_none()

    if not plan or not plan.task_dag:
        return {"phase": plan.phase if plan else "no_plan", "tasks": [], "hint": ""}

    # 加载 DB Task 运行时状态
    task_result = await db.execute(select(Task).where(Task.plan_id == plan.id))
    db_tasks = {t.id: t for t in task_result.scalars().all()}

    dag_tasks = []
    for td in (plan.task_dag or []):
        if not isinstance(td, dict):
            continue
        db_id = td.get("_db_id", "")
        db_task = db_tasks.get(db_id)
        dag_tasks.append({
            "id": td.get("id"),
            "db_id": db_id,
            "title": td.get("title", ""),
            "description": td.get("description", "")[:200],
            "dependencies": td.get("dependencies", []),
            "required_capability": td.get("required_capability", "code"),
            "assigned_agent_id": td.get("assigned_agent_id"),
            "status": db_task.status if db_task else "pending",
            "agent_name": None,  # 前端会用 agentStore 匹配
        })

    return {
        "phase": plan.phase,
        "tasks": dag_tasks,
        "hint": plan.selected_approach or "",
    }


@router.get("/{session_id}/diagnostics")
async def get_diagnostics(session_id: str, db: AsyncSession = Depends(get_db)):
    """返回会话的完整诊断信息：Plan 阶段、DAG、Task 状态、Agent 清单。"""
    from app.models.plan import Plan
    from app.models.task import Task, TaskDependency

    plan_result = await db.execute(
        select(Plan).where(Plan.session_id == session_id)
        .order_by(Plan.created_at.desc()).limit(1)
    )
    plan = plan_result.scalar_one_or_none()

    if not plan:
        return {"session_id": session_id, "plan": {"phase": "no_plan"}, "tasks": [], "agents": []}

    task_result = await db.execute(select(Task).where(Task.plan_id == plan.id))
    tasks = list(task_result.scalars().all())

    dep_result = await db.execute(
        select(TaskDependency).where(
            TaskDependency.task_id.in_([t.id for t in tasks])
        )
    )
    deps = dep_result.scalars().all()

    agent_result = await db.execute(
        select(SessionAgent).where(SessionAgent.session_id == session_id)
    )
    session_agents = agent_result.scalars().all()

    agent_map: dict[str, Agent] = {}
    if session_agents:
        agents_result = await db.execute(
            select(Agent).where(Agent.id.in_([sa.agent_id for sa in session_agents]))
        )
        agent_map = {a.id: a for a in agents_result.scalars().all()}

    return {
        "session_id": session_id,
        "plan": {
            "id": plan.id if plan else None,
            "phase": plan.phase if plan else "no_plan",
            "status": plan.status if plan else None,
            "clarify_round": plan.clarify_round if plan else None,
            "selected_approach": plan.selected_approach if plan else None,
            "approaches": plan.approaches if plan else None,
            "dag_length": len(plan.task_dag) if (plan and plan.task_dag) else 0,
            "dag": [
                {
                    "id": td.get("id"),
                    "title": td.get("title", ""),
                    "required_capability": td.get("required_capability"),
                    "assigned_agent_id": td.get("assigned_agent_id"),
                    "dependencies": td.get("dependencies", []),
                    "_db_id": td.get("_db_id"),
                }
                for td in (plan.task_dag or [])
                if isinstance(td, dict)
            ] if plan else [],
        },
        "tasks": [
            {
                "db_id": t.id,
                "title": t.title,
                "status": t.status,
                "assigned_agent_id": t.assigned_agent_id,
                "error_message": t.error_message,
                "retry_count": t.retry_count,
                "result_preview": (t.result or "")[:200] if t.result else None,
            }
            for t in tasks
        ],
        "dependencies": [
            {"task_id": d.task_id, "depends_on": d.depends_on_task_id}
            for d in deps
        ],
        "agents": [
            {
                "id": agent.id,
                "name": agent.name,
                "role_type": agent.role_type,
                "is_temp": agent.is_temp,
                "capability_tags": agent.capability_tags,
            }
            for agent in agent_map.values()
        ],
    }


@router.get("/{session_id}/export", response_class=PlainTextResponse)
async def export_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """导出会话完整对话为 Markdown，保存到 test-cases/ 并返回下载。"""
    import os as _os
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at)
    )
    messages = result.scalars().all()

    # 构建 agent_id → Agent 对象映射（批量加载，避免 N+1）
    agent_map: dict[str, Agent] = {}
    all_ids: set[str] = {m.agent_id for m in messages if m.agent_id}
    if all_ids:
        agents_result = await db.execute(select(Agent).where(Agent.id.in_(all_ids)))
        agent_map = {a.id: a for a in agents_result.scalars().all()}

    # 生成 Markdown
    date_str = (session.created_at or _utcnow()).strftime("%Y-%m-%d")
    safe_title = "".join(c for c in session.title if c.isalnum() or c in " _-").strip()[:50] or "未命名"

    lines = [
        f"# {session.title}",
        f"- 日期：{date_str}",
        f"- 类型：{session.type}",
        f"- 会话 ID：{session.id}",
        f"- 消息总数：{len(messages)}",
        "",
        "## 会话 Agent 清单",
        "",
    ]
    for aid, agent in agent_map.items():
        tags = ", ".join(agent.capability_tags or [])
        lines.append(f"- **{agent.name}** (id=`{aid}`) role=`{agent.role_type}` adapter=`{agent.adapter_type}` tags=`{tags}`")
    lines.append("")
    lines.append("---")
    lines.append("")

    for m in messages:
        if m.message_type == "temp_progress":
            continue
        role_label = _role_label(m, agent_map)
        debug_parts = [f"role={m.role}"]
        if m.agent_id:
            debug_parts.append(f"agent_id=`{m.agent_id}`")
        if m.message_type and m.message_type != "text":
            debug_parts.append(f"msg_type={m.message_type}")
        lines.append(f"### {role_label}")
        lines.append(f"<!-- {' | '.join(debug_parts)} -->")
        lines.append("")
        lines.append(m.content)
        lines.append("")

    content = "\n".join(lines)
    filename = f"{date_str}-{safe_title}.md"

    # 保存到项目根目录 test-cases/
    backend_dir = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    test_cases_dir = _os.path.join(_os.path.dirname(backend_dir), "test-cases")
    _os.makedirs(test_cases_dir, exist_ok=True)
    filepath = _os.path.join(test_cases_dir, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    # HTTP 头仅支持 latin-1，非 ASCII 字符滤除后若为空则用回退名
    ascii_safe = "".join(c for c in safe_title if c.isascii()).strip(" -")
    ascii_filename = f"{date_str}-{ascii_safe}.md" if ascii_safe else f"{date_str}-export.md"
    return PlainTextResponse(
        content,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_filename}";'
                f" filename*=UTF-8''{quote(filename)}"
            ),
            "X-Saved-Path": quote(filepath, safe="/:\\"),
        },
    )


async def _ensure_system_agents(db, session_id: str, existing_ids: list[str]) -> None:
    """确保群聊中有 Critic 和 Planner 系统 Agent。已存在的跳过。"""
    result = await db.execute(
        select(Agent).where(Agent.role_type == "system")
    )
    for agent in result.scalars().all():
        if agent.id in existing_ids:
            continue
        already = await db.execute(
            select(SessionAgent).where(
                SessionAgent.session_id == session_id,
                SessionAgent.agent_id == agent.id,
            )
        )
        if already.scalar_one_or_none():
            continue
        db.add(SessionAgent(session_id=session_id, agent_id=agent.id))


def _role_label(msg: Message, agent_map: dict[str, "Agent"]) -> str:
    """生成含调试信息的消息角色标签。"""
    if msg.role == "user":
        return "👤 用户"
    if msg.role == "system":
        return "⚙️ 系统"
    agent = agent_map.get(msg.agent_id or "")
    agent_name = agent.name if agent else f"Unknown({msg.agent_id[:8] if msg.agent_id else 'no-id'})"
    return f"🤖 {agent_name}"


async def _build_session_response(session_id: str, db: AsyncSession) -> SessionResponse:
    """Fetch session with agents and active plan loaded."""
    result = await db.execute(
        select(Session).options(selectinload(Session.agents)).where(Session.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    # 批量加载所有 Agent，避免 N+1
    agent_ids = [sa.agent_id for sa in session.agents]
    agent_map: dict[str, Agent] = {}
    if agent_ids:
        agents_result = await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        agent_map = {a.id: a for a in agents_result.scalars().all()}

    agent_bindings = []
    for sa in session.agents:
        agent = agent_map.get(sa.agent_id)
        if agent:
            agent_bindings.append({
                "id": sa.id,
                "agent_id": agent.id,
                "session_id": session.id,
                "agent_name": agent.name,
                "agent_avatar": agent.avatar_url,
                "adapter_type": agent.adapter_type,
            })

    # 查询最新 Plan 及其任务（不限制 status，已完成会话也需展示）
    plan_data = None
    plan_result = await db.execute(
        select(Plan).options(selectinload(Plan.tasks)).where(
            Plan.session_id == session_id
        ).order_by(desc(Plan.created_at)).limit(1)
    )
    plan = plan_result.scalar_one_or_none()
    if plan:
        tasks_data = [
            TaskStatusResponse(
                task_id=t.id,
                title=t.title,
                status=t.status,
                assigned_agent_id=t.assigned_agent_id,
                started_at=t.started_at,
                completed_at=t.completed_at,
            )
            for t in plan.tasks
        ]
        plan_data = PlanResponse(
            phase=plan.phase,
            status=plan.status,
            selected_approach=plan.selected_approach,
            approaches=plan.approaches or [],
            tasks=tasks_data,
        )

    return SessionResponse(
        id=session.id,
        title=session.title,
        type=session.type,
        status=session.status,
        pinned_at=session.pinned_at,
        last_active_at=session.last_active_at,
        created_at=session.created_at,
        agents=agent_bindings,
        plan=plan_data,
    )
