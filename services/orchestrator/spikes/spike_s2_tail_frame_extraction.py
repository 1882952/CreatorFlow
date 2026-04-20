#!/usr/bin/env python3
"""
Spike S2: Tail Frame Extraction Quality Verification

Verify ffmpeg tail frame extraction quality and determine optimal parameters.

Usage:
    python spike_s2_tail_frame_extraction.py --video path/to/video.mp4
"""

import argparse
import subprocess
import json
import sys
from pathlib import Path

# Add parent to path for utils
sys.path.insert(0, str(Path(__file__).parent))
from spike_utils import (
    get_duration,
    get_video_info,
    save_results,
    print_header,
    check_ffmpeg,
)


def extract_tail_frame_method_a(video_path: str, output_path: str) -> dict:
    """Method A: Seek to -0.05s from end."""
    cmd = [
        "ffmpeg", "-y",
        "-sseof", "-0.05",
        "-i", video_path,
        "-frames:v", "1",
        "-q:v", "2",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return {
        "method": "A (sseof -0.05)",
        "success": result.returncode == 0,
        "output": output_path,
        "stderr": result.stderr[:200] if result.returncode != 0 else None,
    }


def extract_tail_frame_method_b(video_path: str, output_path: str) -> dict:
    """Method B: Seek to -0.1s from end."""
    cmd = [
        "ffmpeg", "-y",
        "-sseof", "-0.1",
        "-i", video_path,
        "-frames:v", "1",
        "-q:v", "2",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return {
        "method": "B (sseof -0.1)",
        "success": result.returncode == 0,
        "output": output_path,
        "stderr": result.stderr[:200] if result.returncode != 0 else None,
    }


def extract_tail_frame_method_c(video_path: str, output_path: str, duration: float) -> dict:
    """Method C: Explicit seek to duration - 0.05."""
    seek_time = max(0, duration - 0.05)
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{seek_time:.3f}",
        "-i", video_path,
        "-frames:v", "1",
        "-q:v", "2",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return {
        "method": f"C (ss {seek_time:.3f})",
        "success": result.returncode == 0,
        "output": output_path,
        "stderr": result.stderr[:200] if result.returncode != 0 else None,
    }


def extract_tail_frame_method_d(video_path: str, output_path: str, duration: float) -> dict:
    """Method D: Reverse + select first frame."""
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", "reverse,select='eq(n\\,0)'",
        "-frames:v", "1",
        "-q:v", "2",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return {
        "method": "D (reverse + select)",
        "success": result.returncode == 0,
        "output": output_path,
        "stderr": result.stderr[:200] if result.returncode != 0 else None,
    }


def get_file_size(path: str) -> int:
    """Get file size in bytes."""
    return Path(path).stat().st_size if Path(path).exists() else 0


def main():
    parser = argparse.ArgumentParser(description="Spike S2: Tail Frame Extraction")
    parser.add_argument("--video", required=True, help="Path to input video file")
    args = parser.parse_args()

    video_path = Path(args.video)
    if not video_path.exists():
        print(f"Error: Video file not found: {video_path}")
        sys.exit(1)

    if not check_ffmpeg():
        print("Error: ffmpeg/ffprobe not found in PATH")
        sys.exit(1)

    print_header("Spike S2: Tail Frame Extraction Quality Verification")

    # Get video info
    duration = get_duration(str(video_path))
    info = get_video_info(str(video_path))
    print(f"\nVideo: {video_path.name}")
    print(f"Duration: {duration:.3f}s")
    print(f"Info: {info}")

    # Prepare output directory
    out_dir = Path(__file__).parent / "results" / "s2_frames"
    out_dir.mkdir(parents=True, exist_ok=True)

    base_name = video_path.stem

    # Run all extraction methods
    methods = [
        ("A", lambda: extract_tail_frame_method_a(str(video_path), str(out_dir / f"{base_name}_tail_A.jpg"))),
        ("B", lambda: extract_tail_frame_method_b(str(video_path), str(out_dir / f"{base_name}_tail_B.jpg"))),
        ("C", lambda: extract_tail_frame_method_c(str(video_path), str(out_dir / f"{base_name}_tail_C.jpg"), duration)),
        ("D", lambda: extract_tail_frame_method_d(str(video_path), str(out_dir / f"{base_name}_tail_D.jpg"), duration)),
    ]

    results = []
    for label, fn in methods:
        print(f"\n  Method {label}: ", end="", flush=True)
        r = fn()
        if r["success"]:
            size = get_file_size(r["output"])
            r["file_size_bytes"] = size
            r["file_size_kb"] = round(size / 1024, 1)
            print(f"OK ({r['file_size_kb']} KB)")
        else:
            print(f"FAILED")
        results.append(r)

    # Conclusion
    print_header("Spike S2: Conclusion")
    successful = [r for r in results if r["success"]]
    if successful:
        best = max(successful, key=lambda r: r.get("file_size_bytes", 0))
        print(f"\n  Recommended method: {best['method']}")
        print(f"  File size: {best.get('file_size_kb', 'N/A')} KB")
        print(f"\n  All successful methods produced frames in: {out_dir}")
    else:
        print("  All methods failed. Check ffmpeg installation and video file.")

    save_results("spike_s2", {
        "video": str(video_path),
        "video_duration": duration,
        "video_info": info,
        "methods": results,
        "recommended_method": successful[0]["method"] if successful else None,
    })


if __name__ == "__main__":
    main()
