"""Shared utilities for Spike validation scripts."""

import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime


def run_ffprobe(filepath: str, *args: str) -> str:
    """Run ffprobe and return stdout."""
    cmd = ["ffprobe", "-v", "quiet", *args, str(filepath)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    return result.stdout.strip()


def get_duration(filepath: str) -> float:
    """Get media file duration in seconds."""
    out = run_ffprobe(
        filepath,
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
    )
    return float(out)


def get_video_info(filepath: str) -> dict:
    """Get video codec, resolution, fps, and pixel format."""
    out = run_ffprobe(
        filepath,
        "-show_entries",
        "stream=codec_name,width,height,r_frame_rate,pix_fmt",
        "-select_streams", "v:0",
        "-of", "json",
    )
    data = json.loads(out)
    if not data.get("streams"):
        return {}
    s = data["streams"][0]
    fps_str = s.get("r_frame_rate", "0/1")
    num, den = fps_str.split("/")
    fps = float(num) / float(den) if float(den) != 0 else 0
    return {
        "codec": s.get("codec_name"),
        "width": s.get("width"),
        "height": s.get("height"),
        "fps": round(fps, 2),
        "pix_fmt": s.get("pix_fmt"),
    }


def save_results(spike_name: str, results: dict) -> Path:
    """Save results JSON to spikes/results/ directory."""
    results_dir = Path(__file__).parent / "results"
    results_dir.mkdir(parents=True, exist_ok=True)
    results["timestamp"] = datetime.now().isoformat()
    out_path = results_dir / f"{spike_name}_results.json"
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nResults saved to: {out_path}")
    return out_path


def print_header(title: str) -> None:
    """Print a formatted section header."""
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def check_ffmpeg() -> bool:
    """Check if ffmpeg and ffprobe are available."""
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        subprocess.run(["ffprobe", "-version"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def check_comfyui(url: str = "http://127.0.0.1:8188") -> bool:
    """Check if ComfyUI is reachable."""
    try:
        import urllib.request
        urllib.request.urlopen(f"{url}/system_stats", timeout=5)
        return True
    except Exception:
        return False
