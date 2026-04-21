"""Execution engine: orchestrates segment-by-segment ComfyUI execution."""

import asyncio
import logging
import math
import pathlib
from typing import Optional

from config import settings
from models.events import EventType, job_event, segment_event, progress_event
from models.states import JobStatus, SegmentStatus
from services import job_service
from services.audio_splitter import AudioSplitter
from services.cleanup_manager import CleanupManager
from services.comfyui_client import ComfyUIClient
from services.frame_extractor import FrameExtractor
from services.video_concatenator import VideoConcatenator
from services.workflow_builder import load_template, build_workflow

logger = logging.getLogger(__name__)


class ExecutionEngine:
    """Orchestrates the full execution pipeline for a job.

    Pipeline:
    1. Load job and input files
    2. Analyze audio and create segments
    3. For each segment:
       a. Export segment audio
       b. Upload image + audio to ComfyUI
       c. Build and submit workflow
       d. Wait for completion with progress
       e. Extract output video
       f. Extract tail frame (for continuity)
    4. Concatenate all segments
    5. Clean up intermediates
    """

    def __init__(self, event_manager):
        self._event_manager = event_manager
        self._cleanup_manager = CleanupManager()
        self._running_jobs: set[str] = set()

    def is_running(self, job_id: str) -> bool:
        """Check whether a job is currently executing."""
        return job_id in self._running_jobs

    async def execute_job(self, job_id: str) -> None:
        """Execute a job to completion (or failure)."""
        if job_id in self._running_jobs:
            logger.warning("Job %s is already running", job_id)
            return

        self._running_jobs.add(job_id)
        comfyui = ComfyUIClient(settings.comfyui_url)

        try:
            await self._run_pipeline(job_id, comfyui)
        except Exception as e:
            logger.exception("Job %s failed", job_id)
            job_service.update_job_status(job_id, JobStatus.FAILED, last_error=str(e))
            await self._broadcast(job_event(EventType.JOB_FAILED, job_id, error=str(e)))
        finally:
            self._running_jobs.discard(job_id)
            await comfyui.close()

    async def _run_pipeline(self, job_id: str, comfyui: ComfyUIClient) -> None:
        """Run the full execution pipeline."""
        # Load job
        job = job_service.get_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        logger.info("Starting execution for job %s: %s", job_id, job["name"])

        # Phase 1: Preparing -- audio segmentation
        job_service.update_job_status(job_id, JobStatus.PREPARING)
        await self._broadcast(job_event(EventType.JOB_PREPARING, job_id))

        template = load_template()
        splitter = AudioSplitter(
            max_duration=job["max_segment_duration"],
            hard_max_duration=settings.hard_max_duration,
        )

        plan = splitter.analyze(job["input_audio_path"])
        plan = splitter.export_segments(
            job["input_audio_path"], plan,
            settings.work_dir, job_id,
        )

        # Create segment records in DB
        for seg_plan in plan.segments:
            seg_id = job_service.create_segment(
                job_id, seg_plan.index,
                seg_plan.start_seconds, seg_plan.end_seconds,
                seg_plan.duration_seconds, seg_plan.cut_reason,
            )
            if seg_plan.audio_path:
                job_service.update_segment(seg_id, audio_segment_path=seg_plan.audio_path)
            # Register segment audio as artifact
            if seg_plan.audio_path and plan.needs_split:
                job_service.create_artifact(
                    job_id, "segment_audio", seg_plan.audio_path,
                    segment_id=seg_id, source="ffmpeg_split",
                )

        await self._broadcast(
            job_event(EventType.JOB_PREPARING, job_id, segmentCount=plan.segment_count)
        )

        # Phase 2: Running -- execute segments sequentially
        job_service.update_job_status(job_id, JobStatus.RUNNING)
        await self._broadcast(job_event(EventType.JOB_STARTED, job_id))

        frame_extractor = FrameExtractor(settings.work_dir)
        segments = job_service.get_segments(job_id)
        prev_output_path = None

        for seg in segments:
            seg_id = seg["id"]
            index = seg["index"]

            try:
                # Determine reference image using FrameExtractor
                source_image_mode, source_image_path = frame_extractor.get_reference_image(
                    job, index, prev_output_path, job_id,
                )

                if source_image_mode == "previous_tail":
                    # Register tail frame artifact
                    job_service.create_artifact(
                        job_id, "tail_frame", source_image_path,
                        segment_id=seg_id, source="ffmpeg_extract",
                    )
                    job_service.update_segment(seg_id,
                        source_image_mode=source_image_mode,
                        source_image_path=source_image_path,
                        tail_frame_path=source_image_path,
                    )

                await self._execute_segment(
                    job_id, seg_id, index, seg,
                    source_image_path, template, job, comfyui,
                )

                # Update prev_output_path for next segment
                updated_segs = job_service.get_segments(job_id)
                for s in updated_segs:
                    if s["id"] == seg_id:
                        prev_output_path = s.get("comfy_output_path")
                        break

            except Exception as e:
                logger.error("Segment %d failed for job %s: %s", index, job_id, e)
                job_service.update_segment(seg_id, status=SegmentStatus.FAILED, last_error=str(e))
                await self._broadcast(
                    segment_event(EventType.SEGMENT_FAILED, job_id, seg_id, index, error=str(e))
                )
                raise RuntimeError(f"Segment {index} failed: {e}")

        # Phase 3: Concatenation
        await self._concatenate(job_id, job)

        # Phase 4: Cleanup
        await self._schedule_cleanup(job_id, job)

    async def _concatenate(self, job_id: str, job: dict) -> None:
        """Concatenate all segment videos into final output."""
        job_service.update_job_status(job_id, JobStatus.CONCATENATING)
        await self._broadcast(job_event(EventType.JOB_CONCATENATING, job_id))

        segments = job_service.get_segments(job_id)
        video_paths = []

        for seg in segments:
            if seg.get("comfy_output_path"):
                video_paths.append(seg["comfy_output_path"])

        if not video_paths:
            raise RuntimeError("No segment videos found for concatenation")

        output_dir = job.get("output_dir") or settings.output_dir
        concatenator = VideoConcatenator(output_dir)
        result = concatenator.concatenate(video_paths, job_id)

        # Update job with final video path
        job_service.update_job_status(
            job_id, JobStatus.COMPLETED,
            final_video_path=result["path"],
        )

        # Register final video as artifact (keep)
        job_service.create_artifact(
            job_id, "final_video", result["path"],
            source="ffmpeg_concat",
        )

        await self._broadcast(
            job_event(
                EventType.JOB_COMPLETED, job_id,
                finalVideoPath=result["path"],
                totalDuration=result["duration"],
                segmentCount=result["segment_count"],
            )
        )

        logger.info(
            "Job %s completed: %s (%.2fs, %d segments)",
            job_id, result["path"], result["duration"], result["segment_count"],
        )

    async def _schedule_cleanup(self, job_id: str, job: dict) -> None:
        """Schedule intermediate file cleanup."""
        delay = job.get("cleanup_after_seconds", settings.cleanup_default_delay_seconds)
        debug = job.get("cleanup_policy") == "debug"

        await self._broadcast(
            job_event(EventType.JOB_CLEANUP_SCHEDULED, job_id, cleanupAfterSeconds=delay)
        )

        await self._cleanup_manager.schedule_cleanup(
            job_id, delay_seconds=delay, debug_mode=debug,
        )

    async def _execute_segment(
        self, job_id: str, seg_id: str, index: int,
        seg: dict, image_path: str, template: dict, job: dict,
        comfyui: ComfyUIClient,
    ) -> None:
        """Execute a single segment through ComfyUI."""

        # Step 1: Upload image
        job_service.update_segment(seg_id, status=SegmentStatus.UPLOADING)
        await self._broadcast(
            segment_event(EventType.SEGMENT_UPLOADING, job_id, seg_id, index)
        )

        uploaded_image = await comfyui.upload_image(image_path)

        # Step 2: Upload audio
        audio_path = seg.get("audio_segment_path") or job["input_audio_path"]
        uploaded_audio = await comfyui.upload_image(audio_path)

        # Step 3: Build workflow
        duration = min(math.ceil(seg["duration_seconds"]), settings.hard_max_duration)
        prefix = f"creatorflow-dh-{job_id}-seg{index}"
        workflow = build_workflow(
            template, uploaded_image, uploaded_audio,
            job["prompt"], job["seed"], duration,
            job["fps"], job["max_resolution"], prefix,
        )

        # Step 4: Submit
        job_service.update_segment(seg_id, status=SegmentStatus.SUBMITTED)
        prompt_id = await comfyui.submit_prompt(workflow)
        job_service.update_segment(seg_id, comfy_prompt_id=prompt_id)
        await self._broadcast(
            segment_event(EventType.SEGMENT_SUBMITTED, job_id, seg_id, index, promptId=prompt_id)
        )

        # Step 5: Wait for completion
        job_service.update_segment(seg_id, status=SegmentStatus.RUNNING)
        await self._broadcast(
            segment_event(EventType.SEGMENT_STARTED, job_id, seg_id, index)
        )

        def on_progress(value, max_val, node):
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.ensure_future(self._broadcast(
                        progress_event(job_id, seg_id, index, value or 0, max_val or 1, node)
                    ))
            except RuntimeError:
                pass

        history = await comfyui.wait_for_execution(prompt_id, on_progress=on_progress)

        # Step 6: Extract output
        output_info = await comfyui.extract_output_video(history)
        if not output_info:
            raise RuntimeError(f"No output video found for segment {index}")

        # Step 7: Download output from ComfyUI to local work_dir
        local_path = await comfyui.download_output(
            output_info["filename"],
            settings.work_dir,
            subfolder=output_info.get("subfolder", ""),
            item_type=output_info.get("type", "output"),
        )
        logger.info(
            "Segment %d: downloaded %s -> %s",
            index, output_info["filename"], local_path,
        )

        job_service.update_segment(seg_id,
            status=SegmentStatus.COMPLETED,
            comfy_output_path=local_path,
        )

        # Register segment video as artifact (cleanable)
        job_service.create_artifact(
            job_id, "segment_video", local_path,
            segment_id=seg_id, source="comfyui_output",
        )

        await self._broadcast(
            segment_event(EventType.SEGMENT_COMPLETED, job_id, seg_id, index, outputPath=local_path)
        )

        logger.info(
            "Segment %d completed: %s (local: %s)",
            index, output_info["filename"], local_path,
        )

    async def _broadcast(self, event: dict) -> None:
        """Broadcast an event via the event manager."""
        await self._event_manager.broadcast(event["type"], event["data"])
