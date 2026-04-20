#!/usr/bin/env python3
"""
Spike S3: Concat Compatibility Verification

Verify whether multiple ComfyUI-generated video segments can be
concatenated losslessly with ffmpeg concat demuxer (-c copy).

Usage:
    python spike_s3_concat_compatibility.py --videos v1.mp4 v2.mp4 [v3.mp4 ...]
"""

import argparse
import subprocess
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from spike_utils import (
    get_duration,
    get_video_info,
    save_results,
    print_header,
    check_ffmpeg,
)


def try_copy_concat(video_paths: list[str], output_path: str) -> dict:
    """Try lossless concat using concat demuxer with -c copy."""
    out_dir = Path(output_path).parent
    concat_list = out_dir / "concat_list.txt"
    with open(concat_list, "w", encoding="utf-8") as f:
        for vp in video_paths:
            # Use forward slashes and escape single quotes for ffmpeg
            safe_path = str(vp).replace("\\", "/").replace("'", "'\\''")
            f.write(f"file '{safe_path}'\n")

    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(concat_list),
        "-c", "copy",
        "-movflags", "+faststart",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    return {
        "method": "concat demuxer -c copy",
        "success": result.returncode == 0,
        "output": output_path,
        "stderr": result.stderr[-500:] if result.returncode != 0 else None,
    }


def try_reencode_concat(video_paths: list[str], output_path: str) -> dict:
    """Fallback: re-encode concat."""
    out_dir = Path(output_path).parent
    concat_list = out_dir / "concat_list.txt"
    with open(concat_list, "w", encoding="utf-8") as f:
        for vp in video_paths:
            safe_path = str(vp).replace("\\", "/").replace("'", "'\\''")
            f.write(f"file '{safe_path}'\n")

    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(concat_list),
        "-c:v", "libx264",
        "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    return {
        "method": "concat demuxer re-encode",
        "success": result.returncode == 0,
        "output": output_path,
        "stderr": result.stderr[-500:] if result.returncode != 0 else None,
    }


def main():
    parser = argparse.ArgumentParser(description="Spike S3: Concat Compatibility")
    parser.add_argument("--videos", nargs="+", required=True, help="Video file paths to concatenate")
    args = parser.parse_args()

    if len(args.videos) < 2:
        print("Error: At least 2 video files required")
        sys.exit(1)

    for vp in args.videos:
        if not Path(vp).exists():
            print(f"Error: Video file not found: {vp}")
            sys.exit(1)

    if not check_ffmpeg():
        print("Error: ffmpeg/ffprobe not found in PATH")
        sys.exit(1)

    print_header("Spike S3: Concat Compatibility Verification")

    # Analyze each video
    videos_info = []
    all_params_match = True
    reference_params = None

    for vp in args.videos:
        info = get_video_info(vp)
        duration = get_duration(vp)
        videos_info.append({
            "path": str(vp),
            "duration": round(duration, 3),
            "info": info,
        })
        print(f"\n  {Path(vp).name}:")
        print(f"    Duration: {duration:.3f}s")
        print(f"    Codec: {info.get('codec')}, "
              f"Resolution: {info.get('width')}x{info.get('height')}, "
              f"FPS: {info.get('fps')}, "
              f"Pixel Format: {info.get('pix_fmt')}")

        if reference_params is None:
            reference_params = info
        else:
            for key in ["codec", "width", "height", "fps", "pix_fmt"]:
                if info.get(key) != reference_params.get(key):
                    all_params_match = False
                    print(f"    WARNING: {key} mismatch: {info.get(key)} vs {reference_params.get(key)}")

    # Prepare output
    out_dir = Path(__file__).parent / "results"
    out_dir.mkdir(parents=True, exist_ok=True)
    concat_output = str(out_dir / "s3_concat_output.mp4")
    reencode_output = str(out_dir / "s3_concat_reencode.mp4")

    # Try lossless concat
    print_header("Step 1: Try lossless concat (-c copy)")
    copy_result = try_copy_concat(args.videos, concat_output)
    if copy_result["success"]:
        out_duration = get_duration(concat_output)
        expected_duration = sum(v["duration"] for v in videos_info)
        print(f"  SUCCESS: Concatenated video created")
        print(f"  Output: {concat_output}")
        print(f"  Duration: {out_duration:.3f}s (expected: {expected_duration:.3f}s)")
        copy_result["output_duration"] = round(out_duration, 3)
        copy_result["expected_duration"] = round(expected_duration, 3)
        copy_result["duration_match"] = abs(out_duration - expected_duration) < 0.5
    else:
        print(f"  FAILED: -c copy concat not possible")
        print(f"  Reason: {copy_result.get('stderr', 'Unknown')[:200]}")

    # Try re-encode concat as fallback
    reencode_result = None
    if not copy_result["success"]:
        print_header("Step 2: Fallback to re-encode concat")
        reencode_result = try_reencode_concat(args.videos, reencode_output)
        if reencode_result["success"]:
            out_duration = get_duration(reencode_output)
            print(f"  SUCCESS: Re-encoded concatenation created")
            print(f"  Duration: {out_duration:.3f}s")
            reencode_result["output_duration"] = round(out_duration, 3)
        else:
            print(f"  FAILED: Re-encode also failed")

    # Conclusion
    print_header("Spike S3: Conclusion")
    if copy_result["success"]:
        conclusion = "PASS: Lossless concat (-c copy) works. Same encoding params confirmed."
        if not all_params_match:
            conclusion = "PASS: Lossless concat works despite minor param differences."
    elif reencode_result and reencode_result["success"]:
        conclusion = "PARTIAL: Lossless concat failed, but re-encode concat works as fallback."
    else:
        conclusion = "FAIL: Both concat methods failed."

    print(f"  Encoding params match: {all_params_match}")
    print(f"  Conclusion: {conclusion}")

    save_results("spike_s3", {
        "videos": videos_info,
        "params_match": all_params_match,
        "copy_concat": copy_result,
        "reencode_concat": reencode_result,
        "conclusion": conclusion,
    })


if __name__ == "__main__":
    main()
