"""Artifact REST API — fetch artifact content and session artifacts."""

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
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
async def apply_artifact(artifact_id: str, db: AsyncSession = Depends(get_db)):
    """将 artifact 的代码写入 workspaces 目录。若文件已存在则返回冲突。"""
    artifact = await db.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if not artifact.modified_content:
        raise HTTPException(400, "Artifact has no modified content to apply")

    session_dir = WORKSPACES_DIR / artifact.session_id
    target_path = session_dir / artifact.file_path.lstrip("/")

    if target_path.exists():
        raise HTTPException(
            409,
            f"文件 {artifact.file_path} 已存在，请先手动处理冲突后再应用新的 Diff",
        )

    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(artifact.modified_content, encoding="utf-8")

    return {
        "ok": True,
        "file_path": artifact.file_path,
        "full_path": str(target_path),
    }
