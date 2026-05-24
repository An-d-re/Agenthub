"""Session CRUD + Message history + Pin management."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.agent import Agent
from app.models.message import Message, PinnedMessage
from app.models.session import Session, SessionAgent
from app.schemas.message import MessageResponse, PinToggle
from app.schemas.session import SessionCreate, SessionListItem, SessionResponse

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
    )


@router.get("", response_model=list[SessionListItem])
async def list_sessions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Session).options(selectinload(Session.agents)).order_by(desc(Session.pinned_at), desc(Session.last_active_at))
    )
    sessions = result.scalars().all()
    return [_session_to_item(s) for s in sessions]


@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(body: SessionCreate, db: AsyncSession = Depends(get_db)):
    session = Session(title=body.title, type=body.type)
    db.add(session)
    await db.flush()

    for agent_id in body.agent_ids:
        db.add(SessionAgent(session_id=session.id, agent_id=agent_id))

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


async def _build_session_response(session_id: str, db: AsyncSession) -> SessionResponse:
    """Fetch session with agents loaded."""
    result = await db.execute(
        select(Session).options(selectinload(Session.agents)).where(Session.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    agent_bindings = []
    for sa in session.agents:
        agent = await db.get(Agent, sa.agent_id)
        if agent:
            agent_bindings.append({
                "id": sa.id,
                "agent_id": agent.id,
                "session_id": session.id,
                "agent_name": agent.name,
                "agent_avatar": agent.avatar_url,
                "adapter_type": agent.adapter_type,
            })

    return SessionResponse(
        id=session.id,
        title=session.title,
        type=session.type,
        status=session.status,
        pinned_at=session.pinned_at,
        last_active_at=session.last_active_at,
        created_at=session.created_at,
        agents=agent_bindings,
    )
