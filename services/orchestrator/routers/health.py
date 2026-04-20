"""Health-check router for the CreatorFlow Orchestrator."""

from __future__ import annotations

import asyncio
import logging
import shutil
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter

from config import settings
from database import get_connection
from models.schemas import HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


def _check_tool(name: str) -> str:
    """Return 'ok' if a CLI tool is on PATH, otherwise an error string."""
    if shutil.which(name):
        return "ok"
    return "not found"


async def _check_comfyui(url: str) -> str:
    """Check ComfyUI connectivity with a short timeout."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{url}/system_stats")
            resp.raise_for_status()
        return "ok"
    except Exception as exc:
        logger.warning("ComfyUI health check failed: %s", exc)
        return f"unavailable ({type(exc).__name__})"


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Perform a health check of all subsystems. Returns quickly even if deps are down."""

    # Run all checks concurrently to avoid blocking
    sqlite_status, comfyui_status, ffmpeg_status, ffprobe_status = await asyncio.gather(
        _check_sqlite(),
        _check_comfyui(settings.comfyui_url),
        asyncio.to_thread(_check_tool, "ffmpeg"),
        asyncio.to_thread(_check_tool, "ffprobe"),
    )

    all_ok = all(s == "ok" for s in [sqlite_status, comfyui_status, ffmpeg_status, ffprobe_status])

    return HealthResponse(
        status="ok" if all_ok else "degraded",
        sqlite=sqlite_status,
        comfyui=comfyui_status,
        ffmpeg=ffmpeg_status,
        ffprobe=ffprobe_status,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


async def _check_sqlite() -> str:
    """Check SQLite connectivity."""
    try:
        # Run in thread to avoid blocking the event loop
        def _query():
            with get_connection() as conn:
                conn.execute("SELECT 1").fetchone()
        await asyncio.to_thread(_query)
        return "ok"
    except Exception as exc:
        logger.error("SQLite health check failed: %s", exc)
        return f"error ({type(exc).__name__})"
