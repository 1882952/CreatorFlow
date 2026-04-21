"""In-process job queue for serial orchestrator execution."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class JobQueueManager:
    """Runs queued jobs one by one on a single background worker."""

    def __init__(self, execution_engine) -> None:
        self._execution_engine = execution_engine
        self._queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
        self._queued_jobs: set[str] = set()
        self._worker_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the background worker if it is not already running."""
        if self._worker_task and not self._worker_task.done():
            return

        self._worker_task = asyncio.create_task(
            self._worker_loop(),
            name="creatorflow-orchestrator-job-queue",
        )
        logger.info("Job queue worker started")

    async def stop(self) -> None:
        """Stop the background worker gracefully."""
        if not self._worker_task:
            return

        await self._queue.put(None)
        await self._worker_task
        self._worker_task = None
        self._queued_jobs.clear()
        logger.info("Job queue worker stopped")

    async def enqueue(self, job_id: str) -> bool:
        """Queue a job unless it is already queued or running."""
        if job_id in self._queued_jobs or self._execution_engine.is_running(job_id):
            logger.info("Job %s already queued or running; skipping duplicate enqueue", job_id)
            return False

        await self._queue.put(job_id)
        self._queued_jobs.add(job_id)
        logger.info("Job queued: %s (queue depth=%d)", job_id, self._queue.qsize())
        return True

    def is_queued(self, job_id: str) -> bool:
        """Check whether a job is waiting in the queue."""
        return job_id in self._queued_jobs

    async def _worker_loop(self) -> None:
        """Continuously execute queued jobs in FIFO order."""
        while True:
            job_id = await self._queue.get()
            if job_id is None:
                self._queue.task_done()
                break

            self._queued_jobs.discard(job_id)
            try:
                logger.info("Dequeued job %s for execution", job_id)
                await self._execution_engine.execute_job(job_id)
            except Exception:
                logger.exception("Queued job %s crashed unexpectedly", job_id)
            finally:
                self._queue.task_done()
