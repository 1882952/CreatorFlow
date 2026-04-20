"""Workflow template loading and parameter injection for ComfyUI."""

import copy
import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Node ID mapping for the LTX 2.3 digital human workflow.
# These must match ltx23-digital-human-api.json and the JS workflow-template.js.
NODE_MAP = {
    "IMAGE": {"nodeId": "444", "field": "image"},
    "AUDIO": {"nodeId": "1594", "field": "audio"},
    "PROMPT": {"nodeId": "1624", "field": "value"},
    "SEED": {"nodeId": "1527", "field": "value"},
    "DURATION": {"nodeId": "1583", "field": "value"},
    "FPS": {"nodeId": "1586", "field": "value"},
    "MAX_RESOLUTION": {"nodeId": "1606", "field": "value"},
    "OUTPUT_PREFIX": {"nodeId": "1747", "field": "filename_prefix"},
}


def load_template(template_path: Optional[str] = None) -> dict:
    """Load the workflow template JSON.

    Args:
        template_path: Explicit path, or None to use default location.

    Returns:
        Parsed workflow dict.
    """
    if template_path is None:
        # Default: relative to services/orchestrator/services/
        template_path = str(
            Path(__file__).resolve().parent.parent.parent.parent
            / "creatorflow" / "assets" / "workflows" / "ltx23-digital-human-api.json"
        )

    path = Path(template_path)
    if not path.exists():
        raise FileNotFoundError(f"Workflow template not found: {path}")

    return json.loads(path.read_text(encoding="utf-8"))


def build_workflow(
    template: dict,
    image_name: str,
    audio_name: str,
    prompt: str,
    seed: int,
    duration: int,
    fps: int = 24,
    max_resolution: int = 1280,
    output_prefix: str = "creatorflow-dh",
) -> dict:
    """Build a workflow by injecting parameters into the template.

    Args:
        template: Loaded workflow template dict.
        image_name: Uploaded image filename in ComfyUI.
        audio_name: Uploaded audio filename in ComfyUI.
        prompt: Text prompt.
        seed: Random seed.
        duration: Generation duration in seconds.
        fps: Frame rate.
        max_resolution: Maximum resolution.
        output_prefix: Filename prefix for output.

    Returns:
        Modified workflow dict ready for submission.
    """
    wf = copy.deepcopy(template)

    injections = {
        "IMAGE": image_name,
        "AUDIO": audio_name,
        "PROMPT": prompt,
        "SEED": seed,
        "DURATION": duration,
        "FPS": fps,
        "MAX_RESOLUTION": max_resolution,
        "OUTPUT_PREFIX": output_prefix,
    }

    for key, value in injections.items():
        mapping = NODE_MAP[key]
        node_id = mapping["nodeId"]
        field = mapping["field"]

        if node_id not in wf:
            logger.warning("Node %s (%s) not found in template", node_id, key)
            continue

        wf[node_id]["inputs"][field] = value

    return wf


def extract_result_from_history(history: dict, prompt_id: str) -> Optional[dict]:
    """Extract output info from ComfyUI execution history.

    Returns dict with {filename, subfolder, type} or None.
    """
    if prompt_id not in history:
        return None

    outputs = history[prompt_id].get("outputs", {})

    # Look for VHS_VideoCombine output
    for node_id, node_output in outputs.items():
        for key in ("gifs", "videos"):
            if key in node_output:
                for item in node_output[key]:
                    filename = item.get("filename", "")
                    if filename.endswith(".mp4"):
                        return {
                            "filename": filename,
                            "subfolder": item.get("subfolder", ""),
                            "type": item.get("type", "output"),
                        }

    return None
