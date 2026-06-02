"""AgentHub backend application."""

from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.agents import router as agents_router
from app.api.artifacts import router as artifacts_router
from app.api.deployments import router as deployments_router
from app.api.models import router as models_router
from app.api.sessions import router as sessions_router
from app.api.traces import router as traces_router
from app.api.uploads import router as uploads_router
from app.core.config import settings
from app.core.database import init_db
from app.ws.ws_routes import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="AgentHub", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents_router)
app.include_router(artifacts_router)
app.include_router(deployments_router)
app.include_router(models_router)
app.include_router(sessions_router)
app.include_router(traces_router)
app.include_router(uploads_router)
app.include_router(ws_router)

# 部署文件的静态服务
_deploy_dir = Path(__file__).resolve().parent / "public" / "deployments"
_deploy_dir.mkdir(parents=True, exist_ok=True)
app.mount("/deployments", StaticFiles(directory=str(_deploy_dir), html=True), name="deployments")

# Workspace 静态文件服务 —— Agent 生成的文件可通过 URL 直接访问
_workspace_dir = Path(settings.workspace_root).resolve()
_workspace_dir.mkdir(parents=True, exist_ok=True)
app.mount("/workspace", StaticFiles(directory=str(_workspace_dir), html=True), name="workspace")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
