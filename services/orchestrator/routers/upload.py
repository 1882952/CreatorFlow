"""File upload router for the CreatorFlow Orchestrator."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException

from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["upload"])


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)) -> dict:
    """Upload a file to the work directory.

    Returns the local file path on success.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="File must have a filename")

    dest = Path(settings.work_dir) / file.filename
    dest.parent.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    dest.write_bytes(content)

    logger.info("File uploaded: %s (%d bytes)", dest, len(content))
    return {"path": str(dest), "filename": file.filename, "size": len(content)}
