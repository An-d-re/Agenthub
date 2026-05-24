"""AgentHub backend application."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agents import router as agents_router
from app.api.artifacts import router as artifacts_router
from app.api.sessions import router as sessions_router
from app.api.traces import router as traces_router
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
app.include_router(sessions_router)
app.include_router(traces_router)
app.include_router(ws_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
