"""Cleanup manager: handles intermediate file cleanup after job completion."""

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from services import job_service

logger = logging.getLogger(__name__)


class CleanupManager:
    """Manages intermediate file cleanup for completed jobs."""

    # Artifact types that are safe to clean
    CLEANABLE_TYPES = {"segment_audio", "tail_frame", "segment_video"}

    # Artifact types to preserve
    PRESERVE_TYPES = {"input_image", "input_audio", "final_video"}

    def __init__(self):
        self._pending_tasks: dict[str, asyncio.Task] = {}

    async def schedule_cleanup(
        self,
        job_id: str,
        delay_seconds: int = 300,
        debug_mode: bool = False,
    ) -> None:
        """Schedule cleanup for a completed job.

        Args:
            job_id: Job ID to clean up
            delay_seconds: Delay before cleanup (default 5 minutes)
            debug_mode: If True, skip cleanup entirely
        """
        if debug_mode:
            logger.info("Cleanup skipped for job %s (debug mode)", job_id)
            return

        logger.info(
            "Scheduling cleanup for job %s in %d seconds",
            job_id, delay_seconds,
        )

        task = asyncio.create_task(
            self._delayed_cleanup(job_id, delay_seconds)
        )
        self._pending_tasks[job_id] = task

    async def _delayed_cleanup(self, job_id: str, delay_seconds: int) -> None:
        """Execute cleanup after delay."""
        try:
            await asyncio.sleep(delay_seconds)
        except asyncio.CancelledError:
            logger.info("Cleanup cancelled for job %s", job_id)
            return

        await self.execute_cleanup(job_id)

    async def execute_cleanup(self, job_id: str) -> dict:
        """Execute cleanup for a job immediately.

        Returns:
            Dict with {cleaned_count, failed_count, preserved_count}
        """
        logger.info("Executing cleanup for job %s", job_id)

        job = job_service.get_job(job_id)
        if not job:
            logger.warning("Job %s not found for cleanup", job_id)
            return {"cleaned_count": 0, "failed_count": 0, "preserved_count": 0}

        # Only clean completed jobs
        if job["status"] not in ("completed", "partially_cleaned"):
            logger.warning(
                "Skipping cleanup for job %s with status %s",
                job_id, job["status"],
            )
            return {"cleaned_count": 0, "failed_count": 0, "preserved_count": 0}

        artifacts = job_service.get_artifacts(job_id)
        cleaned = 0
        failed = 0
        preserved = 0

        for artifact in artifacts:
            artifact_type = artifact.get("type", "")
            artifact_path = artifact.get("path", "")
            cleanup_status = artifact.get("cleanup_status", "pending")

            # Skip already cleaned
            if cleanup_status == "cleaned":
                continue

            # Preserve important artifacts
            if artifact_type in self.PRESERVE_TYPES:
                preserved += 1
                job_service.update_artifact(artifact["id"], cleanup_status="keep")
                continue

            # Clean cleanable artifacts
            if artifact_type in self.CLEANABLE_TYPES:
                try:
                    path = Path(artifact_path)
                    if path.exists():
                        path.unlink()
                        logger.debug("Deleted: %s", artifact_path)
                    job_service.update_artifact(artifact["id"], cleanup_status="cleaned")
                    cleaned += 1
                except Exception as e:
                    logger.error("Failed to delete %s: %s", artifact_path, e)
                    job_service.update_artifact(artifact["id"], cleanup_status="failed")
                    failed += 1
            else:
                preserved += 1

        result = {
            "cleaned_count": cleaned,
            "failed_count": failed,
            "preserved_count": preserved,
        }

        # Update job status
        if failed == 0:
            job_service.update_job_status(job_id, JobStatus.COMPLETED)
        else:
            job_service.update_job_status(job_id, JobStatus.PARTIALLY_CLEANED)

        logger.info(
            "Cleanup complete for job %s: %d cleaned, %d failed, %d preserved",
            job_id, cleaned, failed, preserved,
        )

        return result

    def cancel_cleanup(self, job_id: str) -> None:
        """Cancel a pending cleanup task."""
        task = self._pending_tasks.pop(job_id, None)
        if task and not task.done():
            task.cancel()
            logger.info("Cleanup cancelled for job %s", job_id)


# Avoid circular import - import at function level
from models.states import JobStatus
