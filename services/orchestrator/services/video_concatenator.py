"""Video concatenation: combine all segment videos into a final output."""

import logging
from pathlib import Path
from typing import Optional

from services.ffmpeg_utils import concat_videos, get_audio_duration, get_media_info

logger = logging.getLogger(__name__)


class VideoConcatenator:
    """Concatenates segment videos into a final output file."""

    def __init__(self, output_dir: str):
        """
        Args:
            output_dir: Directory for the final output video
        """
        self._output_dir = Path(output_dir)
        self._output_dir.mkdir(parents=True, exist_ok=True)

    def concatenate(
        self,
        video_paths: list[str],
        job_id: str,
        output_filename: Optional[str] = None,
    ) -> dict:
        """Concatenate segment videos into a final video.

        Args:
            video_paths: List of segment video paths in order
            job_id: Job ID for naming
            output_filename: Custom filename (default: auto-generated)

        Returns:
            Dict with {path, duration, size, method}

        Raises:
            RuntimeError: If concatenation fails
        """
        if not video_paths:
            raise ValueError("No video paths provided for concatenation")

        if len(video_paths) == 1:
            # Single segment: just copy/reference it
            return self._handle_single(video_paths[0], job_id)

        filename = output_filename or f"{job_id}-final.mp4"
        output_path = str(self._output_dir / filename)

        # Log segment info
        for i, vp in enumerate(video_paths):
            try:
                info = get_media_info(vp)
                streams = info.get("streams", [])
                duration = float(info.get("format", {}).get("duration", 0))
                logger.info(
                    "Segment %d: %s (%.2fs)",
                    i, Path(vp).name, duration,
                )
            except Exception:
                logger.warning("Could not get info for segment %d: %s", i, vp)

        # Try lossless concat first, fallback to re-encode
        try:
            result_path = concat_videos(video_paths, output_path, reencode=False)
            method = "copy"
        except Exception as e:
            logger.warning("Lossless concat failed (%s), trying re-encode", e)
            result_path = concat_videos(video_paths, output_path, reencode=True)
            method = "reencode"

        # Verify output
        if not Path(output_path).exists():
            raise RuntimeError(f"Concat output file not found: {output_path}")

        duration = 0.0
        try:
            duration = get_audio_duration(output_path)
        except Exception:
            pass

        file_size = Path(output_path).stat().st_size

        logger.info(
            "Concatenated %d segments → %s (%.2fs, %s, method=%s)",
            len(video_paths), output_path, duration,
            _format_size(file_size), method,
        )

        return {
            "path": output_path,
            "duration": round(duration, 3),
            "size": file_size,
            "method": method,
            "segment_count": len(video_paths),
        }

    def _handle_single(self, video_path: str, job_id: str) -> dict:
        """Handle single-segment case (no concatenation needed)."""
        import shutil

        filename = f"{job_id}-final.mp4"
        output_path = str(self._output_dir / filename)

        # Copy the single video to output
        shutil.copy2(video_path, output_path)

        duration = 0.0
        try:
            duration = get_audio_duration(output_path)
        except Exception:
            pass

        file_size = Path(output_path).stat().st_size

        return {
            "path": output_path,
            "duration": round(duration, 3),
            "size": file_size,
            "method": "copy_single",
            "segment_count": 1,
        }


def _format_size(size_bytes: int) -> str:
    """Format file size in human-readable format."""
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"
