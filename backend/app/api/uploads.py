"""File upload API — store files in workspaces/{session_id}/uploads/ and create message records."""

import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FastAPIFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import async_session, get_db
from app.core.event_bus import event_bus
from app.models.message import Message
from app.models.session import Session

router = APIRouter(prefix="/api/sessions", tags=["uploads"])

ALLOWED_EXTENSIONS = {
    "image": {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"},
    "text": {".txt", ".md", ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".yml", ".yaml", ".html", ".css", ".sql", ".sh", ".env"},
}

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def _utcnow():
    return datetime.now(timezone.utc)


def _get_upload_dir(session_id: str) -> str:
    workspace_root = settings.workspace_root or "workspaces"
    upload_dir = os.path.join(workspace_root, session_id, "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    return upload_dir


def _is_image(ext: str) -> bool:
    return ext.lower() in ALLOWED_EXTENSIONS["image"]


@router.post("/{session_id}/upload")
async def upload_file(
    session_id: str,
    file: UploadFile = FastAPIFile(...),
    db: AsyncSession = Depends(get_db),
):
    # Validate session
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session not found")

    # Validate file
    if not file.filename:
        raise HTTPException(400, "No file selected")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS["image"] and ext not in ALLOWED_EXTENSIONS["text"]:
        raise HTTPException(400, f"不支持的文件类型: {ext}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "文件大小超过 10MB 限制")

    # Save file
    upload_dir = _get_upload_dir(session_id)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(upload_dir, stored_name)
    with open(file_path, "wb") as f:
        f.write(content)

    # Determine message type
    is_image = _is_image(ext)
    msg_type = "image" if is_image else "file"
    file_url = f"/api/sessions/{session_id}/files/{stored_name}"

    # Display content for text files
    preview = ""
    if not is_image and ext in ALLOWED_EXTENSIONS["text"]:
        try:
            text = content.decode("utf-8")[:500]
            preview = text
        except UnicodeDecodeError:
            pass

    # Create message record
    message = Message(
        session_id=session_id,
        role="user",
        content=preview or file_url,
        message_type=msg_type,
        file_name=file.filename,
        file_url=file_url,
        file_size=len(content),
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    # Broadcast
    await event_bus.publish(session_id, {
        "type": "chat.message",
        "session_id": session_id,
        "payload": {
            "id": message.id,
            "session_id": message.session_id,
            "role": message.role,
            "content": message.content,
            "message_type": message.message_type,
            "file_name": file.filename,
            "file_url": file_url,
            "file_size": len(content),
            "created_at": message.created_at.isoformat(),
        },
    })

    return {
        "id": message.id,
        "file_name": file.filename,
        "file_url": file_url,
        "file_size": len(content),
        "message_type": msg_type,
    }


@router.get("/{session_id}/files/{file_name:path}")
async def serve_file(session_id: str, file_name: str):
    """Serve uploaded files from workspaces."""
    from fastapi.responses import FileResponse

    workspace_root = settings.workspace_root or "workspaces"
    upload_dir = os.path.join(workspace_root, session_id, "uploads")
    file_path = os.path.normpath(os.path.join(upload_dir, file_name))

    # 防止路径遍历攻击
    if not file_path.startswith(os.path.normpath(upload_dir) + os.sep) and file_path != os.path.normpath(upload_dir):
        raise HTTPException(403, "路径访问被拒绝")

    if not os.path.isfile(file_path):
        raise HTTPException(404, "文件不存在")

    # Determine MIME type
    ext = _os.path.splitext(file_name)[1].lower()
    mime_map = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
        ".bmp": "image/bmp", ".ico": "image/x-icon",
        ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
        ".json": "application/json", ".txt": "text/plain", ".md": "text/markdown",
    }
    media_type = mime_map.get(ext, "application/octet-stream")
    return FileResponse(file_path, media_type=media_type)
