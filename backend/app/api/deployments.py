"""Deployment REST API — 一键部署 HTML 制品。"""

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.artifact import Artifact
from app.models.deployment import Deployment

router = APIRouter(prefix="/api/deployments", tags=["deployments"])

# 部署文件输出目录
DEPLOY_DIR = Path(__file__).resolve().parent.parent.parent / "public" / "deployments"


@router.post("")
async def create_deployment(
    artifact_id: str, session_id: str, db: AsyncSession = Depends(get_db)
):
    """部署一个 HTML 制品，返回访问 URL。"""
    artifact = await db.get(Artifact, artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")

    content = artifact.modified_content or ""
    if not content.strip():
        raise HTTPException(400, "Artifact 内容为空")

    # 创建部署记录
    deployment = Deployment(
        session_id=session_id,
        artifact_id=artifact_id,
        status="deploying",
    )
    db.add(deployment)
    await db.flush()

    try:
        # 写入部署目录
        deploy_path = DEPLOY_DIR / deployment.id
        deploy_path.mkdir(parents=True, exist_ok=True)

        # 提取 <body> 内容或使用完整 HTML
        index_file = deploy_path / "index.html"
        if "<html" not in content.lower() and "<!doctype" not in content.lower():
            wrapped = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{artifact.file_path or 'Deployed App'}</title>
</head>
<body>
{content}
</body>
</html>"""
            index_file.write_text(wrapped, encoding="utf-8")
        else:
            index_file.write_text(content, encoding="utf-8")

        # 复制引用的 CSS/JS 文件（同 session 的 artifacts）
        result = await db.execute(
            select(Artifact).where(
                Artifact.session_id == session_id,
                Artifact.id != artifact_id,
                Artifact.language.in_(["css", "javascript", "js"]),
            )
        )
        for a in result.scalars().all():
            if a.file_path and a.modified_content:
                rel = Path(a.file_path)
                dest = deploy_path / rel.name
                dest.write_text(a.modified_content, encoding="utf-8")

        deployment.status = "running"
        deployment.url = f"/deployments/{deployment.id}/index.html"
        deployment.logs = f"Deployed from artifact {artifact.file_path}"

    except Exception as e:
        deployment.status = "failed"
        deployment.logs = str(e)

    deployment.port = 0
    await db.commit()
    await db.refresh(deployment)

    return {
        "id": deployment.id,
        "status": deployment.status,
        "url": deployment.url,
        "logs": deployment.logs,
        "created_at": deployment.created_at.isoformat(),
    }


@router.get("")
async def list_deployments(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Deployment)
        .where(Deployment.session_id == session_id)
        .order_by(Deployment.created_at.desc())
    )
    return [
        {
            "id": d.id,
            "status": d.status,
            "url": d.url,
            "created_at": d.created_at.isoformat(),
        }
        for d in result.scalars().all()
    ]


@router.delete("/{deployment_id}")
async def delete_deployment(deployment_id: str, db: AsyncSession = Depends(get_db)):
    deployment = await db.get(Deployment, deployment_id)
    if not deployment:
        raise HTTPException(404, "Deployment not found")

    # 清理文件
    import shutil
    deploy_path = DEPLOY_DIR / deployment_id
    if deploy_path.exists():
        shutil.rmtree(deploy_path)

    await db.delete(deployment)
    await db.commit()
    return {"ok": True}
