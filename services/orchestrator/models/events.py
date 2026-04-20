"""WebSocket event type definitions and payload structures."""

from __future__ import annotations

from typing import Any, Optional


class EventType:
    """Event type constants for WebSocket broadcasts."""

    # Job lifecycle events
    JOB_CREATED = "job.created"
    JOB_QUEUED = "job.queued"
    JOB_PREPARING = "job.preparing"
    JOB_STARTED = "job.started"
    JOB_UPDATED = "job.updated"
    JOB_CONCATENATING = "job.concatenating"
    JOB_COMPLETED = "job.completed"
    JOB_FAILED = "job.failed"
    JOB_CANCELLED = "job.cancelled"
    JOB_CLEANUP_SCHEDULED = "job.cleanup_scheduled"
    JOB_CLEANUP_COMPLETED = "job.cleanup_completed"

    # Segment lifecycle events
    SEGMENT_STARTED = "segment.started"
    SEGMENT_SPLITTING = "segment.splitting"
    SEGMENT_UPLOADING = "segment.uploading"
    SEGMENT_SUBMITTED = "segment.submitted"
    SEGMENT_PROGRESS = "segment.progress"
    SEGMENT_COMPLETED = "segment.completed"
    SEGMENT_FAILED = "segment.failed"

    # System events
    SYSTEM_ERROR = "system.error"


def make_event(event_type: str, data: Any = None) -> dict:
    """Create a well-formed event payload."""
    from datetime import datetime, timezone

    return {
        "type": event_type,
        "data": data or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# Convenience constructors for common events


def job_event(event_type: str, job_id: str, **extra) -> dict:
    """Create a job-level event."""
    data = {"jobId": job_id, **extra}
    return make_event(event_type, data)


def segment_event(
    event_type: str, job_id: str, segment_id: str, index: int, **extra
) -> dict:
    """Create a segment-level event."""
    data = {"jobId": job_id, "segmentId": segment_id, "index": index, **extra}
    return make_event(event_type, data)


def progress_event(
    job_id: str, segment_id: str, index: int, value: int, max_value: int, node: Optional[str] = None
) -> dict:
    """Create a segment progress event."""
    data = {
        "jobId": job_id,
        "segmentId": segment_id,
        "index": index,
        "progress": {"value": value, "max": max_value},
    }
    if node:
        data["currentNode"] = node
    return make_event(EventType.SEGMENT_PROGRESS, data)
