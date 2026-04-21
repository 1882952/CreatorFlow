"""Job management router for the CreatorFlow Orchestrator."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import settings
from models.events import EventType, job_event
from models.schemas import (
    ArtifactListResponse,
    ArtifactResponse,
    JobCreate,
    JobDetailResponse,
    JobListResponse,
    JobResponse,
    SegmentResponse,
)
from services import job_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["jobs"])


def _job_row_to_response(row: dict) -> JobResponse:
    """Convert a raw database row dict into a JobResponse."""
    return JobResponse(
        id=row["id"],
        name=row["name"],
        status=row["status"],
        prompt=row["prompt"] or "",
        seed=row["seed"],
        fps=row["fps"],
        max_resolution=row["max_resolution"],
        segment_mode=row["segment_mode"],
        max_segment_duration=row["max_segment_duration"],
        input_image_path=row.get("input_image_path"),
        input_audio_path=row.get("input_audio_path"),
        output_dir=row.get("output_dir"),
        final_video_path=row.get("final_video_path"),
        cleanup_policy=row.get("cleanup_policy", "auto"),
        cleanup_after_seconds=row.get("cleanup_after_seconds", 300),
        created_at=row["created_at"],
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
        last_error=row.get("last_error"),
    )


def _segment_row_to_response(row: dict) -> SegmentResponse:
    """Convert a raw database row dict into a SegmentResponse."""
    return SegmentResponse(
        id=row["id"],
        job_id=row["job_id"],
        index=row["index"],
        status=row["status"],
        start_seconds=row["start_seconds"],
        end_seconds=row["end_seconds"],
        duration_seconds=row["duration_seconds"],
        cut_reason=row.get("cut_reason"),
        source_image_mode=row.get("source_image_mode", "original"),
        source_image_path=row.get("source_image_path"),
        audio_segment_path=row.get("audio_segment_path"),
        comfy_prompt_id=row.get("comfy_prompt_id"),
        comfy_output_path=row.get("comfy_output_path"),
        tail_frame_path=row.get("tail_frame_path"),
        last_error=row.get("last_error"),
    )


async def _save_upload_file(upload: UploadFile, prefix: str) -> str:
    """Save an uploaded file to the work directory and return its path."""
    suffix = Path(upload.filename or "file").suffix
    filename = f"{prefix}_{upload.filename}"
    dest = Path(settings.work_dir) / filename
    dest.parent.mkdir(parents=True, exist_ok=True)

    content = await upload.read()
    dest.write_bytes(content)

    logger.info("Uploaded file saved: %s (%d bytes)", dest, len(content))
    return str(dest)


# ── POST /api/jobs ──────────────────────────────────────────────────────────


@router.post("/jobs")
async def create_job(
    name: str = Form("Untitled Job"),
    prompt: str = Form(""),
    seed: int = Form(42),
    fps: int = Form(24),
    max_resolution: int = Form(1280),
    segment_mode: str = Form("auto"),
    max_segment_duration: float = Form(8.0),
    cleanup_after_seconds: int = Form(300),
    image: Optional[UploadFile] = File(None),
    audio: Optional[UploadFile] = File(None),
) -> dict:
    """Create a new job with optional image and audio file uploads."""
    data = JobCreate(
        name=name,
        prompt=prompt,
        seed=seed,
        fps=fps,
        max_resolution=max_resolution,
        segment_mode=segment_mode,
        max_segment_duration=max_segment_duration,
        cleanup_after_seconds=cleanup_after_seconds,
    )

    input_image_path: Optional[str] = None
    input_audio_path: Optional[str] = None

    if image:
        input_image_path = await _save_upload_file(image, prefix="img")
    if audio:
        input_audio_path = await _save_upload_file(audio, prefix="audio")

    job_id = job_service.create_job(data, input_image_path=input_image_path, input_audio_path=input_audio_path)

    return {"jobId": job_id, "status": "draft"}


# ── GET /api/jobs ───────────────────────────────────────────────────────────


@router.get("/jobs", response_model=JobListResponse)
async def list_jobs() -> JobListResponse:
    """List all jobs."""
    rows = job_service.list_jobs()
    jobs = [_job_row_to_response(r) for r in rows]
    return JobListResponse(jobs=jobs, total=len(jobs))


# ── GET /api/jobs/{job_id} ─────────────────────────────────────────────────


@router.get("/jobs/{job_id}", response_model=JobDetailResponse)
async def get_job(job_id: str) -> JobDetailResponse:
    """Get detailed information about a job, including its segments."""
    row = job_service.get_job(job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    job_resp = _job_row_to_response(row)
    segment_rows = job_service.get_segments(job_id)
    segments = [_segment_row_to_response(s) for s in segment_rows]

    return JobDetailResponse(**job_resp.model_dump(), segments=segments)


# ── POST /api/jobs/{job_id}/start ──────────────────────────────────────────


@router.post("/jobs/{job_id}/start")
async def start_job(job_id: str) -> dict:
    """Queue a job for serial background execution."""
    from main import event_manager, job_queue

    updated = job_service.update_job_status(job_id, "queued")
    if not updated:
        raise HTTPException(status_code=404, detail="Job not found")

    await job_queue.enqueue(job_id)
    await event_manager.broadcast(
        EventType.JOB_QUEUED,
        job_event(EventType.JOB_QUEUED, job_id)["data"],
    )

    return {"jobId": job_id, "status": "queued"}


# ── POST /api/jobs/{job_id}/cancel ─────────────────────────────────────────


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str) -> dict:
    """Cancel a job."""
    updated = job_service.update_job_status(job_id, "cancelled")
    if not updated:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"jobId": job_id, "status": "cancelled"}


# ── POST /api/jobs/{job_id}/retry ──────────────────────────────────────────


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: str) -> dict:
    """Retry a failed job."""
    from main import event_manager, job_queue

    updated = job_service.update_job_status(job_id, "queued")
    if not updated:
        raise HTTPException(status_code=404, detail="Job not found")

    await job_queue.enqueue(job_id)
    await event_manager.broadcast(
        EventType.JOB_QUEUED,
        job_event(EventType.JOB_QUEUED, job_id)["data"],
    )

    return {"jobId": job_id, "status": "queued"}


# ── GET /api/jobs/{job_id}/artifacts ────────────────────────────────────────


@router.get("/jobs/{job_id}/artifacts", response_model=ArtifactListResponse)
async def list_artifacts(job_id: str) -> ArtifactListResponse:
    """List all artifacts for a job."""
    row = job_service.get_job(job_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    artifacts = job_service.get_artifacts(job_id)
    items = [
        ArtifactResponse(
            id=a["id"],
            job_id=a["job_id"],
            segment_id=a.get("segment_id"),
            type=a["type"],
            path=a["path"],
            source=a.get("source"),
            created_at=a["created_at"],
            cleanup_status=a.get("cleanup_status", "pending"),
        )
        for a in artifacts
    ]
    return ArtifactListResponse(artifacts=items, total=len(items))
