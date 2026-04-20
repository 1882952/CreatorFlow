"""Tail frame extraction for segment continuity.

Extracts the last stable frame from a segment video to use as the
reference image for the next segment.
"""

import logging
from pathlib import Path
from typing import Optional

from services.ffmpeg_utils import extract_frame, get_audio_duration

logger = logging.getLogger(__name__)


class FrameExtractor:
    """Extracts tail frames from segment videos for continuity."""

    def __init__(self, work_dir: str):
        """
        Args:
            work_dir: Directory for storing extracted frame images
        """
        self._work_dir = Path(work_dir)
        self._work_dir.mkdir(parents=True, exist_ok=True)

    def extract_tail_frame(
        self,
        video_path: str,
        job_id: str,
        segment_index: int,
        sseof: float = -0.1,
        quality: int = 2,
    ) -> str:
        """Extract a tail frame from a segment video.

        Args:
            video_path: Path to the segment video file
            job_id: Job ID for naming
            segment_index: Segment index for naming
            sseof: Seek offset from end (negative, default -0.1s)
            quality: JPEG quality (2=high, 31=low)

        Returns:
            Path to the extracted frame image

        Raises:
            RuntimeError: If extraction fails
        """
        output_path = str(
            self._work_dir / f"{job_id}_seg{segment_index}_tail.jpg"
        )

        try:
            extract_frame(video_path, output_path, sseof=sseof, quality=quality)
            logger.info(
                "Extracted tail frame for segment %d: %s",
                segment_index, output_path,
            )
            return output_path
        except Exception as e:
            logger.error(
                "Failed to extract tail frame from %s: %s",
                video_path, e,
            )
            raise RuntimeError(
                f"Tail frame extraction failed for segment {segment_index}: {e}"
            )

    def get_reference_image(
        self,
        job: dict,
        segment_index: int,
        prev_video_path: Optional[str],
        job_id: str,
    ) -> tuple[str, str]:
        """Determine the reference image for a segment.

        Args:
            job: Job dict from database
            segment_index: Current segment index (0-based)
            prev_video_path: Previous segment's video output path
            job_id: Job ID

        Returns:
            Tuple of (image_mode, image_path)
            image_mode: "original" or "previous_tail"
            image_path: Path to the reference image
        """
        if segment_index == 0 or not prev_video_path:
            return ("original", job["input_image_path"])

        tail_frame_path = self.extract_tail_frame(
            prev_video_path, job_id, segment_index
        )
        return ("previous_tail", tail_frame_path)
