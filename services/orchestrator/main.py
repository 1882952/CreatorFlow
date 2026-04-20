"""FastAPI entry point for the CreatorFlow Orchestrator."""

from __future__ import annotations

import logging
import sys

import uvicorn
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import init_db
from routers import health, jobs, upload
from services.event_manager import EventManager
from services.execution_engine import ExecutionEngine

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
    stream=sys.stdout,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Global services
# ---------------------------------------------------------------------------
event_manager = EventManager()
execution_engine = ExecutionEngine(event_manager)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize resources on startup and clean up on shutdown."""
    logger.info(
        "Starting CreatorFlow Orchestrator on %s:%d",
        settings.host,
        settings.port,
    )
    init_db()
    yield
    event_manager.close()
    logger.info("CreatorFlow Orchestrator shut down.")


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------
app = FastAPI(
    title="CreatorFlow Orchestrator",
    version="2.1.0",
    lifespan=lifespan,
)

# CORS — allow frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(upload.router, prefix="/api")


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Accept a WebSocket connection and keep it alive for control messages."""
    await websocket.accept()
    event_manager.add_client(websocket)
    logger.info("WebSocket client accepted.")
    try:
        while True:
            data = await websocket.receive_json()
            logger.debug("WebSocket received: %s", data)
            # Future: process control commands from the client
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected normally.")
    except Exception:
        logger.warning("WebSocket client disconnected with error.")
    finally:
        event_manager.remove_client(websocket)


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
