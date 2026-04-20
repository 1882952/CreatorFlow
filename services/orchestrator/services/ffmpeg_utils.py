"""ffmpeg/ffprobe utility functions for media processing."""

import json
import logging
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def run_ffmpeg(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    """Run an ffmpeg command and return the result."""
    cmd = ["ffmpeg", *args]
    logger.debug("Running: %s", " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def run_ffprobe(filepath: str, *args: str, timeout: int = 30) -> str:
    """Run ffprobe and return stdout."""
    cmd = ["ffprobe", "-v", "quiet", *args, str(filepath)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {filepath}: {result.stderr}")
    return result.stdout.strip()


def get_audio_duration(filepath: str) -> float:
    """Get audio file duration in seconds."""
    out = run_ffprobe(filepath, "-show_entries", "format=duration", "-of", "csv=p=0")
    return float(out)


def get_media_info(filepath: str) -> dict:
    """Get full media info as dict."""
    out = run_ffprobe(filepath, "-show_format", "-show_streams", "-of", "json")
    return json.loads(out)


def detect_silences(
    filepath: str,
    noise_threshold: float = -30,
    min_silence_duration: float = 0.2,
) -> list[dict]:
    """Detect silence intervals in an audio file using ffmpeg silencedetect.

    Args:
        filepath: Path to audio file
        noise_threshold: Noise threshold in dB (default -30)
        min_silence_duration: Minimum silence duration in seconds (default 0.2)

    Returns:
        List of {start, end, duration, midpoint} dicts
    """
    result = run_ffmpeg(
        "-i", filepath,
        "-af", f"silencedetect=noise={noise_threshold}dB:d={min_silence_duration}",
        "-f", "null", "-",
        timeout=120,
    )

    # Parse silencedetect output
    silences = []
    current_start = None

    for line in (result.stderr or "").split("\n"):
        line = line.strip()
        if "silence_start:" in line:
            # Extract number after "silence_start:"
            parts = line.split("silence_start:")
            if len(parts) > 1:
                try:
                    current_start = float(parts[1].strip().split()[0])
                except (ValueError, IndexError):
                    pass
        elif "silence_end:" in line and current_start is not None:
            parts = line.split("silence_end:")
            if len(parts) > 1:
                try:
                    end = float(parts[1].strip().split("|")[0].strip())
                    duration = end - current_start
                    silences.append({
                        "start": round(current_start, 3),
                        "end": round(end, 3),
                        "duration": round(duration, 3),
                        "midpoint": round(current_start + duration / 2, 3),
                    })
                    current_start = None
                except (ValueError, IndexError):
                    current_start = None

    logger.info("Detected %d silence intervals in %s", len(silences), filepath)
    return silences


def split_audio(
    input_path: str,
    start: float,
    end: float,
    output_path: str,
) -> str:
    """Extract a segment of audio from start to end seconds.

    Args:
        input_path: Source audio file path
        start: Start time in seconds
        end: End time in seconds
        output_path: Output file path

    Returns:
        Output file path
    """
    result = run_ffmpeg(
        "-y",
        "-i", input_path,
        "-ss", f"{start:.3f}",
        "-to", f"{end:.3f}",
        "-c", "copy",
        output_path,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Audio split failed: {result.stderr}")
    logger.info("Split audio: %.3f-%.3f → %s", start, end, output_path)
    return output_path


def extract_frame(
    video_path: str,
    output_path: str,
    timestamp: Optional[float] = None,
    sseof: Optional[float] = None,
    quality: int = 2,
) -> str:
    """Extract a frame from a video file.

    Args:
        video_path: Source video file path
        output_path: Output image path (jpg/png)
        timestamp: Seek to this timestamp in seconds
        sseof: Seek relative to end of file (negative offset)
        quality: JPEG quality (2=high, 31=low)

    Returns:
        Output file path
    """
    cmd = ["-y"]
    if sseof is not None:
        cmd.extend(["-sseof", f"{sseof:.3f}"])
    elif timestamp is not None:
        cmd.extend(["-ss", f"{timestamp:.3f}"])
    cmd.extend(["-i", video_path, "-frames:v", "1", "-q:v", str(quality), output_path])

    result = run_ffmpeg(*cmd, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"Frame extraction failed: {result.stderr}")
    return output_path


def concat_videos(
    video_paths: list[str],
    output_path: str,
    reencode: bool = False,
) -> str:
    """Concatenate multiple video files.

    Args:
        video_paths: List of video file paths in order
        output_path: Output file path
        reencode: If True, re-encode; if False, try -c copy first

    Returns:
        Output file path
    """
    import tempfile

    # Create concat list file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
        for vp in video_paths:
            safe_path = str(vp).replace("\\", "/").replace("'", "'\\''")
            f.write(f"file '{safe_path}'\n")
        concat_list = f.name

    try:
        if not reencode:
            # Try lossless first
            result = run_ffmpeg(
                "-y", "-f", "concat", "-safe", "0",
                "-i", concat_list,
                "-c", "copy", "-movflags", "+faststart",
                output_path,
                timeout=300,
            )
            if result.returncode == 0:
                return output_path
            logger.warning("Lossless concat failed, falling back to re-encode")

        # Re-encode fallback
        result = run_ffmpeg(
            "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list,
            "-c:v", "libx264", "-c:a", "aac",
            "-movflags", "+faststart",
            output_path,
            timeout=600,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Video concat failed: {result.stderr}")

        return output_path
    finally:
        Path(concat_list).unlink(missing_ok=True)
