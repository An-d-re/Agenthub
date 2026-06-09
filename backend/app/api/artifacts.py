"""Artifact REST API — fetch artifact content and session artifacts."""

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.artifact import Artifact

router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])

WORKSPACES_DIR = Path(__file__).resolve().parent.parent.parent / "workspaces"


@router.get("/{artifact_id}")
async def get_artifact(artifact_id: str, db: AsyncSession = Depends(get_db)):
    artifact = await db.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    return {
        "id": artifact.id,
        "task_id": artifact.task_id,
        "session_id": artifact.session_id,
        "file_path": artifact.file_path,
        "original_content": artifact.original_content,
        "modified_content": artifact.modified_content,
        "language": artifact.language,
        "artifact_type": artifact.artifact_type,
        "created_at": artifact.created_at.isoformat(),
    }


@router.get("/{artifact_id}/download")
async def download_artifact(artifact_id: str, db: AsyncSession = Depends(get_db)):
    artifact = await db.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    content = artifact.modified_content or ""
    file_name = artifact.file_path.split("/")[-1] or "artifact.txt"
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{file_name}"',
            "Content-Length": str(len(content.encode("utf-8"))),
        },
    )


@router.get("")
async def list_session_artifacts(
    session_id: str, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Artifact)
        .where(Artifact.session_id == session_id)
        .order_by(Artifact.created_at.desc())
    )
    artifacts = result.scalars().all()
    return [
        {
            "id": a.id,
            "task_id": a.task_id,
            "file_path": a.file_path,
            "language": a.language,
            "artifact_type": a.artifact_type,
            "content_preview": a.modified_content[:200] if a.modified_content else "",
            "created_at": a.created_at.isoformat(),
        }
        for a in artifacts
    ]


@router.post("/{artifact_id}/apply")
async def apply_artifact(artifact_id: str, force: bool = False, db: AsyncSession = Depends(get_db)):
    """将 artifact 的代码写入 workspaces 目录。

    - force=false: 冲突时返回已有内容供对比
    - force=true: 直接覆盖已有文件
    """
    artifact = await db.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if not artifact.modified_content:
        raise HTTPException(400, "Artifact has no modified content to apply")

    session_dir = (WORKSPACES_DIR / artifact.session_id).resolve()
    raw_path = artifact.file_path.lstrip("/")
    target_path = (session_dir / raw_path).resolve()

    # 防止路径遍历攻击
    if not str(target_path).startswith(str(session_dir) + os.sep) and target_path != session_dir:
        raise HTTPException(403, "路径访问被拒绝")

    if target_path.exists() and not force:
        existing = target_path.read_text(encoding="utf-8")
        return {
            "ok": False,
            "conflict": True,
            "file_path": artifact.file_path,
            "existing_content": existing[:10000],
            "modified_content": artifact.modified_content[:10000],
            "hint": "文件已存在。传 force=true 直接覆盖，或手动合并。",
        }

    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(artifact.modified_content, encoding="utf-8")

    return {
        "ok": True,
        "file_path": artifact.file_path,
        "full_path": str(target_path),
    }
