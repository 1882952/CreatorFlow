"""Audio segmentation engine: split audio by silence points.

Produces a segmentation plan (list of segments with timing and cut reasons)
and exports individual segment audio files.
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from services.ffmpeg_utils import get_audio_duration, detect_silences, split_audio

logger = logging.getLogger(__name__)


@dataclass
class SegmentPlan:
    """A single segment in the segmentation plan."""
    index: int
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    cut_reason: str  # "silence", "forced", "end_of_audio", "single"
    audio_path: Optional[str] = None


@dataclass
class SegmentationPlan:
    """Complete segmentation plan for a job."""
    total_duration: float
    segment_count: int
    needs_split: bool
    segments: list[SegmentPlan] = field(default_factory=list)


class AudioSplitter:
    """Audio segmentation engine using silence detection."""

    def __init__(
        self,
        max_duration: float = 8.0,
        min_duration: float = 2.0,
        hard_max_duration: float = 10.0,
        noise_threshold_db: float = -30.0,
        min_silence_duration: float = 0.2,
        target_fill_ratio: float = 0.75,
    ):
        """
        Args:
            max_duration: Target max segment duration (default 8s)
            min_duration: Minimum segment duration (default 2s)
            hard_max_duration: Absolute max, cannot exceed (default 10s)
            noise_threshold_db: Silence detection threshold in dB
            min_silence_duration: Minimum silence duration to count as cut point
            target_fill_ratio: Start cutting when segment reaches this % of max_duration (default 0.75)
        """
        self.max_duration = max_duration
        self.min_duration = min_duration
        self.hard_max_duration = hard_max_duration
        self.noise_threshold_db = noise_threshold_db
        self.min_silence_duration = min_silence_duration
        self.target_fill_ratio = target_fill_ratio

    def analyze(self, audio_path: str) -> SegmentationPlan:
        """Analyze audio and produce a segmentation plan.

        Args:
            audio_path: Path to the audio file

        Returns:
            SegmentationPlan with segments list
        """
        total_duration = get_audio_duration(audio_path)
        logger.info("Analyzing audio: %s (%.2fs)", audio_path, total_duration)

        # Check if splitting is needed
        if total_duration <= self.max_duration:
            logger.info("Audio duration (%.2fs) <= max (%.2fs), single segment mode", total_duration, self.max_duration)
            return SegmentationPlan(
                total_duration=total_duration,
                segment_count=1,
                needs_split=False,
                segments=[
                    SegmentPlan(
                        index=0,
                        start_seconds=0.0,
                        end_seconds=round(total_duration, 3),
                        duration_seconds=round(total_duration, 3),
                        cut_reason="single",
                    )
                ],
            )

        # Detect silences
        silences = detect_silences(audio_path, self.noise_threshold_db, self.min_silence_duration)
        logger.info("Detected %d silence intervals", len(silences))

        # Select cut points using greedy strategy
        cut_points = self._select_cut_points(silences, total_duration)

        # Build segments from cut points
        segments = self._build_segments(cut_points, total_duration)

        # Enforce hard max duration with forced cuts
        segments = self._enforce_max_duration(segments)

        logger.info("Segmentation plan: %d segments", len(segments))
        return SegmentationPlan(
            total_duration=total_duration,
            segment_count=len(segments),
            needs_split=True,
            segments=segments,
        )

    def export_segments(
        self,
        audio_path: str,
        plan: SegmentationPlan,
        output_dir: str,
        job_id: str,
    ) -> SegmentationPlan:
        """Export segment audio files and update plan with file paths.

        Args:
            audio_path: Original audio file path
            plan: Segmentation plan from analyze()
            output_dir: Directory to save segment files
            job_id: Job ID for filename prefix

        Returns:
            Updated SegmentationPlan with audio_path on each segment
        """
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        for seg in plan.segments:
            if seg.start_seconds == 0.0 and seg.end_seconds >= plan.total_duration and plan.segment_count == 1:
                # Single segment mode: use original file
                seg.audio_path = audio_path
                continue

            filename = f"{job_id}_seg{seg.index}_{seg.start_seconds:.1f}-{seg.end_seconds:.1f}.wav"
            output_path = str(out / filename)
            split_audio(audio_path, seg.start_seconds, seg.end_seconds, output_path)
            seg.audio_path = output_path
            logger.info("Exported segment %d: %s", seg.index, filename)

        return plan

    def _select_cut_points(self, silences: list[dict], total_duration: float) -> list[float]:
        """Select optimal cut points from silence intervals using greedy strategy.

        Strategy: accumulate segment length, cut at silence midpoint when:
        - segment length >= max_duration (must cut)
        - segment length >= max_duration * target_fill_ratio (good enough to cut)
        """
        cut_points = []
        last_cut = 0.0
        target_length = self.max_duration * self.target_fill_ratio

        for silence in silences:
            midpoint = silence["midpoint"]
            segment_length = midpoint - last_cut

            if segment_length >= self.max_duration:
                # Must cut: segment already too long
                cut_points.append(midpoint)
                last_cut = midpoint
            elif segment_length >= target_length:
                # Good enough: segment is 75%+ of max, cut here
                cut_points.append(midpoint)
                last_cut = midpoint
            # else: keep accumulating

        return cut_points

    def _build_segments(self, cut_points: list[float], total_duration: float) -> list[SegmentPlan]:
        """Build segment list from cut points."""
        points = [0.0] + cut_points + [total_duration]
        segments = []

        for i in range(len(points) - 1):
            start = round(points[i], 3)
            end = round(points[i + 1], 3)
            duration = round(end - start, 3)

            if duration < 0.01:
                continue  # Skip zero-length segments

            # Determine cut reason
            if i == 0 and len(points) <= 2:
                reason = "single"
            elif i == len(points) - 2:
                reason = "end_of_audio"
            elif i > 0:
                reason = "silence"
            else:
                reason = "silence"

            segments.append(SegmentPlan(
                index=len(segments),
                start_seconds=start,
                end_seconds=end,
                duration_seconds=duration,
                cut_reason=reason,
            ))

        return segments

    def _enforce_max_duration(self, segments: list[SegmentPlan]) -> list[SegmentPlan]:
        """Split any segment that exceeds hard_max_duration with forced cuts."""
        result = []
        reindex = 0

        for seg in segments:
            if seg.duration_seconds <= self.hard_max_duration:
                seg.index = reindex
                result.append(seg)
                reindex += 1
                continue

            # Forced split needed
            logger.warning(
                "Segment %d (%.2fs) exceeds hard max (%.2fs), forcing split",
                seg.index, seg.duration_seconds, self.hard_max_duration,
            )

            pos = seg.start_seconds
            while pos < seg.end_seconds - 0.01:
                end = min(pos + self.max_duration, seg.end_seconds)
                # Try not to make last fragment too short
                if seg.end_seconds - end < self.min_duration and seg.end_seconds - pos <= self.hard_max_duration:
                    end = seg.end_seconds

                duration = round(end - pos, 3)
                result.append(SegmentPlan(
                    index=reindex,
                    start_seconds=round(pos, 3),
                    end_seconds=round(end, 3),
                    duration_seconds=duration,
                    cut_reason="forced",
                ))
                reindex += 1
                pos = end

        return result
