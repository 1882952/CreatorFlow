#!/usr/bin/env python3
"""
Spike S1: Duration Calibration Verification

Verify the actual output video duration for different ComfyUI
workflow duration parameter values (4, 6, 8, 10 seconds).

This script requires:
  1. ComfyUI running at the specified URL
  2. A valid image file and audio file as inputs

Usage:
    python spike_s1_duration_calibration.py \
        --image path/to/image.jpg \
        --audio path/to/audio.mp3 \
        --comfyui-url http://127.0.0.1:8188
"""

import argparse
import asyncio
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from spike_utils import (
    get_duration,
    get_video_info,
    save_results,
    print_header,
    check_ffmpeg,
    check_comfyui,
)


def load_workflow_template() -> dict:
    """Load the LTX 2.3 workflow template."""
    template_path = (
        Path(__file__).resolve().parent.parent.parent.parent
        / "creatorflow" / "assets" / "workflows" / "ltx23-digital-human-api.json"
    )
    if not template_path.exists():
        print(f"Error: Workflow template not found at {template_path}")
        sys.exit(1)
    return json.loads(template_path.read_text(encoding="utf-8"))


def build_workflow(template: dict, image_name: str, audio_name: str,
                   prompt: str, seed: int, duration: int, fps: int,
                   max_resolution: int, output_prefix: str) -> dict:
    """Build a workflow with specific parameters."""
    import copy
    wf = copy.deepcopy(template)

    # Node mapping from workflow-template.js
    NODE_MAP = {
        "IMAGE": {"nodeId": "444", "field": "image"},
        "AUDIO": {"nodeId": "1594", "field": "audio"},
        "PROMPT": {"nodeId": "1624", "field": "text"},
        "SEED": {"nodeId": "1527", "field": "noise_seed"},
        "DURATION": {"nodeId": "1583", "field": "value"},
        "FPS": {"nodeId": "1586", "field": "value"},
        "MAX_RESOLUTION": {"nodeId": "1606", "field": "value"},
        "OUTPUT_PREFIX": {"nodeId": "1747", "field": "filename_prefix"},
    }

    for key, mapping in NODE_MAP.items():
        node_id = mapping["nodeId"]
        field = mapping["field"]
        if node_id not in wf:
            print(f"  WARNING: Node {node_id} not found in template")
            continue

        if key == "IMAGE":
            wf[node_id]["inputs"][field] = image_name
        elif key == "AUDIO":
            wf[node_id]["inputs"][field] = audio_name
        elif key == "PROMPT":
            wf[node_id]["inputs"][field] = prompt
        elif key == "SEED":
            wf[node_id]["inputs"][field] = seed
        elif key == "DURATION":
            wf[node_id]["inputs"][field] = duration
        elif key == "FPS":
            wf[node_id]["inputs"][field] = fps
        elif key == "MAX_RESOLUTION":
            wf[node_id]["inputs"][field] = max_resolution
        elif key == "OUTPUT_PREFIX":
            wf[node_id]["inputs"][field] = output_prefix

    return wf


def upload_file(comfyui_url: str, file_path: str, kind: str = "image") -> str:
    """Upload a file to ComfyUI and return the filename."""
    import urllib.request
    import urllib.parse

    boundary = uuid.uuid4().hex
    file_data = Path(file_path).read_bytes()
    filename = Path(file_path).name

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{kind}"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}\r\n".encode()

    req = urllib.request.Request(
        f"{comfyui_url}/upload/image",
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())
        return result.get("name", filename)


def submit_prompt(comfyui_url: str, workflow: dict, client_id: str) -> str:
    """Submit a workflow to ComfyUI and return prompt_id."""
    import urllib.request

    data = json.dumps({
        "prompt": workflow,
        "client_id": client_id,
    }).encode()

    req = urllib.request.Request(
        f"{comfyui_url}/prompt",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
        return result["prompt_id"]


def wait_for_completion(comfyui_url: str, prompt_id: str, timeout: int = 600) -> bool:
    """Poll history until the prompt completes or times out."""
    import urllib.request

    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(f"{comfyui_url}/history/{prompt_id}")
            with urllib.request.urlopen(req, timeout=10) as resp:
                history = json.loads(resp.read())
                if prompt_id in history:
                    outputs = history[prompt_id].get("outputs", {})
                    status = history[prompt_id].get("status", {})
                    if status.get("completed", False) or status.get("status_str") == "success":
                        return True
                    if status.get("status_str") == "error":
                        return False
        except Exception:
            pass
        time.sleep(2)
    return False


def get_output_video(comfyui_url: str, prompt_id: str) -> str | None:
    """Extract output video filename from history."""
    import urllib.request

    req = urllib.request.Request(f"{comfyui_url}/history/{prompt_id}")
    with urllib.request.urlopen(req, timeout=10) as resp:
        history = json.loads(resp.read())

    if prompt_id not in history:
        return None

    outputs = history[prompt_id].get("outputs", {})
    # Look for VHS_VideoCombine output (node 1747)
    for node_id, node_output in outputs.items():
        if "gifs" in node_output:
            for item in node_output["gifs"]:
                filename = item.get("filename")
                if filename and filename.endswith(".mp4"):
                    return filename
        if "videos" in node_output:
            for item in node_output["videos"]:
                filename = item.get("filename")
                if filename and filename.endswith(".mp4"):
                    return filename
    return None


def download_video(comfyui_url: str, filename: str, output_dir: str) -> str:
    """Download video from ComfyUI /view endpoint."""
    import urllib.request

    url = f"{comfyui_url}/view?filename={filename}&type=output"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()

    out_path = Path(output_dir) / filename
    out_path.write_bytes(data)
    return str(out_path)


def main():
    parser = argparse.ArgumentParser(description="Spike S1: Duration Calibration")
    parser.add_argument("--image", required=True, help="Path to reference image")
    parser.add_argument("--audio", required=True, help="Path to audio file")
    parser.add_argument("--comfyui-url", default="http://127.0.0.1:8188", help="ComfyUI URL")
    parser.add_argument("--prompt", default="A person talking naturally", help="Prompt text")
    parser.add_argument("--fps", type=int, default=24, help="Frame rate")
    parser.add_argument("--max-resolution", type=int, default=1280, help="Max resolution")
    args = parser.parse_args()

    if not Path(args.image).exists():
        print(f"Error: Image file not found: {args.image}")
        sys.exit(1)
    if not Path(args.audio).exists():
        print(f"Error: Audio file not found: {args.audio}")
        sys.exit(1)

    if not check_ffmpeg():
        print("Error: ffmpeg/ffprobe not found in PATH")
        sys.exit(1)

    print_header("Spike S1: Duration Calibration Verification")
    print(f"  ComfyUI: {args.comfyui_url}")

    if not check_comfyui(args.comfyui_url):
        print(f"  Error: ComfyUI not reachable at {args.comfyui_url}")
        print("  Please start ComfyUI before running this Spike.")
        sys.exit(1)

    print("  ComfyUI: Connected")

    # Load template and upload files
    template = load_workflow_template()
    client_id = str(uuid.uuid4())

    print(f"\n  Uploading image: {Path(args.image).name}")
    image_name = upload_file(args.comfyui_url, args.image, "image")
    print(f"  Uploaded as: {image_name}")

    print(f"  Uploading audio: {Path(args.audio).name}")
    audio_name = upload_file(args.comfyui_url, args.audio, "audio")
    print(f"  Uploaded as: {audio_name}")

    # Test durations
    test_durations = [4, 6, 8, 10]
    results = []
    out_dir = Path(__file__).parent / "results" / "s1_videos"
    out_dir.mkdir(parents=True, exist_ok=True)

    for dur in test_durations:
        print_header(f"Testing duration = {dur}s")
        prefix = f"spike_s1_d{dur}"

        workflow = build_workflow(
            template, image_name, audio_name,
            args.prompt, seed=42, duration=dur,
            fps=args.fps, max_resolution=args.max_resolution,
            output_prefix=prefix,
        )

        print(f"  Submitting workflow...")
        try:
            prompt_id = submit_prompt(args.comfyui_url, workflow, client_id)
            print(f"  Prompt ID: {prompt_id}")

            print(f"  Waiting for completion (timeout: 10min)...")
            success = wait_for_completion(args.comfyui_url, prompt_id)

            if not success:
                print(f"  FAILED: Execution did not complete")
                results.append({
                    "input_duration": dur,
                    "success": False,
                    "error": "Execution did not complete",
                })
                continue

            video_filename = get_output_video(args.comfyui_url, prompt_id)
            if not video_filename:
                print(f"  FAILED: No output video found")
                results.append({
                    "input_duration": dur,
                    "success": False,
                    "error": "No output video in history",
                })
                continue

            local_path = download_video(args.comfyui_url, video_filename, str(out_dir))
            actual_duration = get_duration(local_path)
            video_info = get_video_info(local_path)

            print(f"  Output: {video_filename}")
            print(f"  Actual duration: {actual_duration:.3f}s")
            print(f"  Difference: {actual_duration - dur:+.3f}s")
            print(f"  Video info: {video_info}")

            results.append({
                "input_duration": dur,
                "success": True,
                "output_file": video_filename,
                "actual_duration": round(actual_duration, 3),
                "difference": round(actual_duration - dur, 3),
                "video_info": video_info,
            })

        except Exception as e:
            print(f"  ERROR: {e}")
            results.append({
                "input_duration": dur,
                "success": False,
                "error": str(e),
            })

    # Summary
    print_header("Spike S1: Duration Mapping Table")
    print(f"  {'Input':>8} | {'Actual':>8} | {'Diff':>8} | Status")
    print(f"  {'-'*8} | {'-'*8} | {'-'*8} | {'-'*12}")
    for r in results:
        if r["success"]:
            print(f"  {r['input_duration']:>7}s | {r['actual_duration']:>7.3f}s | {r['difference']:>+7.3f}s | OK")
        else:
            print(f"  {r['input_duration']:>7}s | {'N/A':>8} | {'N/A':>8} | FAILED: {r.get('error', '')}")

    save_results("spike_s1", {
        "test_durations": test_durations,
        "comfyui_url": args.comfyui_url,
        "results": results,
    })


if __name__ == "__main__":
    main()
