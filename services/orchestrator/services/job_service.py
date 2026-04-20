"""Job CRUD service for the CreatorFlow Orchestrator."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from database import get_connection
from models.schemas import JobCreate

logger = logging.getLogger(__name__)


def create_job(data: JobCreate, input_image_path: Optional[str] = None, input_audio_path: Optional[str] = None) -> str:
    """Create a new job and return its id."""
    job_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO jobs (
                id, name, status, prompt, seed, fps, max_resolution,
                segment_mode, max_segment_duration, input_image_path,
                input_audio_path, cleanup_after_seconds, created_at
            ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                data.name,
                data.prompt,
                data.seed,
                data.fps,
                data.max_resolution,
                data.segment_mode,
                data.max_segment_duration,
                input_image_path,
                input_audio_path,
                data.cleanup_after_seconds,
                now,
            ),
        )
        conn.commit()

    logger.info("Job created: id=%s name=%s", job_id, data.name)
    return job_id


def get_job(job_id: str) -> Optional[dict]:
    """Return a single job as a dict, or None if not found."""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if row is None:
        return None
    return dict(row)


def list_jobs() -> list[dict]:
    """Return all jobs as a list of dicts, newest first."""
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def update_job_status(job_id: str, status: str, **kwargs) -> bool:
    """Update the status (and optionally other fields) of a job.

    Returns True if the job was found and updated, False otherwise.
    """
    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if existing is None:
            return False

        sets: list[str] = ["status = ?"]
        values: list = [status]

        now = datetime.now(timezone.utc).isoformat()
        if status == "queued":
            sets.append("started_at = ?")
            values.append(now)
        elif status in ("completed", "failed", "cancelled"):
            sets.append("completed_at = ?")
            values.append(now)

        for key, value in kwargs.items():
            sets.append(f"{key} = ?")
            values.append(value)

        values.append(job_id)
        conn.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE id = ?", values)
        conn.commit()

    logger.info("Job updated: id=%s status=%s", job_id, status)
    return True


def get_segments(job_id: str) -> list[dict]:
    """Return all segments for a given job."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM segments WHERE job_id = ? ORDER BY index",
            (job_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def create_segment(
    job_id: str,
    index: int,
    start: float,
    end: float,
    duration: float,
    cut_reason: str,
) -> str:
    """Create a new segment and return its id."""
    segment_id = uuid.uuid4().hex

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO segments (
                id, job_id, index, status, start_seconds, end_seconds,
                duration_seconds, cut_reason
            ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
            """,
            (segment_id, job_id, index, start, end, duration, cut_reason),
        )
        conn.commit()

    logger.info("Segment created: id=%s job_id=%s index=%d", segment_id, job_id, index)
    return segment_id


def update_segment(segment_id: str, **kwargs) -> bool:
    """Update fields on a segment.

    Returns True if the segment was found and updated, False otherwise.
    """
    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM segments WHERE id = ?", (segment_id,)).fetchone()
        if existing is None:
            return False

        sets: list[str] = []
        values: list = []
        for key, value in kwargs.items():
            sets.append(f"{key} = ?")
            values.append(value)

        if not sets:
            return True

        values.append(segment_id)
        conn.execute(f"UPDATE segments SET {', '.join(sets)} WHERE id = ?", values)
        conn.commit()

    logger.info("Segment updated: id=%s fields=%s", segment_id, list(kwargs.keys()))
    return True


# ---------------------------------------------------------------------------
# Artifact CRUD
# ---------------------------------------------------------------------------


def create_artifact(
    job_id: str,
    artifact_type: str,
    path: str,
    segment_id: Optional[str] = None,
    source: Optional[str] = None,
) -> str:
    """Create an artifact record and return its id."""
    artifact_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO artifacts (id, job_id, segment_id, type, path, source, created_at, cleanup_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
            """,
            (artifact_id, job_id, segment_id, artifact_type, path, source, now),
        )
        conn.commit()

    logger.info("Artifact created: id=%s type=%s path=%s", artifact_id, artifact_type, path)
    return artifact_id


def get_artifacts(job_id: str) -> list[dict]:
    """Return all artifacts for a given job."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM artifacts WHERE job_id = ? ORDER BY created_at",
            (job_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def update_artifact(artifact_id: str, **kwargs) -> bool:
    """Update fields on an artifact."""
    with get_connection() as conn:
        existing = conn.execute(
            "SELECT id FROM artifacts WHERE id = ?", (artifact_id,)
        ).fetchone()
        if existing is None:
            return False

        sets: list[str] = []
        values: list = []
        for key, value in kwargs.items():
            sets.append(f"{key} = ?")
            values.append(value)

        if not sets:
            return True

        values.append(artifact_id)
        conn.execute(
            f"UPDATE artifacts SET {', '.join(sets)} WHERE id = ?", values
        )
        conn.commit()

    return True


def get_artifacts_by_cleanup_status(cleanup_status: str) -> list[dict]:
    """Return artifacts filtered by cleanup status."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM artifacts WHERE cleanup_status = ?",
            (cleanup_status,),
        ).fetchall()
    return [dict(r) for r in rows]
