"""ComfyUI HTTP and WebSocket client for submitting and monitoring workflow executions."""

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

import httpx

logger = logging.getLogger(__name__)


class ComfyUIClient:
    """Async client for ComfyUI REST API and WebSocket monitoring."""

    def __init__(self, base_url: str = "http://127.0.0.1:8188"):
        self.base_url = base_url.rstrip("/")
        self.ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://")
        self.client_id = uuid.uuid4().hex
        self._http = httpx.AsyncClient(timeout=30.0)

    async def close(self):
        await self._http.aclose()

    # -- REST API -----------------------------------------------------------

    async def system_stats(self) -> dict:
        """GET /system_stats"""
        resp = await self._http.get(f"{self.base_url}/system_stats")
        resp.raise_for_status()
        return resp.json()

    async def upload_image(self, file_path: str, overwrite: bool = True) -> str:
        """Upload an image file to ComfyUI input directory.

        Returns the filename as stored by ComfyUI.
        """
        path = Path(file_path)
        with open(path, "rb") as f:
            files = {"image": (path.name, f, "application/octet-stream")}
            data = {"type": "input", "overwrite": str(overwrite).lower()}
            resp = await self._http.post(
                f"{self.base_url}/upload/image",
                files=files,
                data=data,
            )
        resp.raise_for_status()
        result = resp.json()
        return result.get("name", path.name)

    async def submit_prompt(self, workflow: dict) -> str:
        """Submit a workflow for execution. Returns prompt_id."""
        payload = {"prompt": workflow, "client_id": self.client_id}
        resp = await self._http.post(
            f"{self.base_url}/prompt",
            json=payload,
        )
        resp.raise_for_status()
        result = resp.json()
        prompt_id = result["prompt_id"]
        logger.info("Submitted prompt: %s", prompt_id)
        return prompt_id

    async def get_history(self, prompt_id: str) -> dict:
        """GET /history/{prompt_id}"""
        resp = await self._http.get(f"{self.base_url}/history/{prompt_id}")
        resp.raise_for_status()
        return resp.json()

    async def interrupt(self):
        """POST /interrupt -- cancel current execution."""
        resp = await self._http.post(f"{self.base_url}/interrupt")
        resp.raise_for_status()

    async def get_queue(self) -> dict:
        """GET /queue"""
        resp = await self._http.get(f"{self.base_url}/queue")
        resp.raise_for_status()
        return resp.json()

    def get_view_url(self, filename: str, subfolder: str = "", item_type: str = "output") -> str:
        """Build a /view URL for accessing output files."""
        params = f"filename={filename}&type={item_type}"
        if subfolder:
            params += f"&subfolder={subfolder}"
        return f"{self.base_url}/view?{params}"

    # -- WebSocket Monitoring ------------------------------------------------

    async def wait_for_execution(
        self,
        prompt_id: str,
        on_progress: Optional[Callable] = None,
        timeout: float = 600.0,
    ) -> dict:
        """Connect to ComfyUI WebSocket and wait for execution to complete.

        Args:
            prompt_id: The prompt to monitor.
            on_progress: Callback for progress updates: fn(value, max, node).
            timeout: Maximum wait time in seconds.

        Returns:
            History dict for the completed prompt.

        Raises:
            TimeoutError: If execution doesn't complete in time.
            RuntimeError: If execution fails.
        """
        import websockets

        result = {"status": "unknown", "outputs": {}}
        done = asyncio.Event()

        ws_url = f"{self.ws_url}/ws?clientId={self.client_id}"
        logger.info("Connecting to ComfyUI WS: %s", ws_url)

        async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
            async def listener():
                async for raw_msg in ws:
                    if isinstance(raw_msg, bytes):
                        continue  # Skip binary preview data

                    try:
                        msg = json.loads(raw_msg)
                    except json.JSONDecodeError:
                        continue

                    msg_type = msg.get("type", "")
                    data = msg.get("data", {})

                    if msg_type == "progress":
                        value = data.get("value", 0)
                        max_val = data.get("max", 1)
                        if on_progress:
                            on_progress(value, max_val, None)

                    elif msg_type == "executing":
                        node = data.get("node")
                        if node is None:
                            # Execution complete
                            result["status"] = "completed"
                            done.set()
                        elif on_progress:
                            on_progress(None, None, node)

                    elif msg_type == "execution_error":
                        result["status"] = "error"
                        result["error"] = data.get("exception_message", "Unknown error")
                        done.set()

                    elif msg_type == "execution_start":
                        logger.info("Execution started for prompt %s", prompt_id)

            try:
                await asyncio.wait_for(listener(), timeout=timeout)
            except asyncio.TimeoutError:
                raise TimeoutError(f"Execution timed out after {timeout}s for prompt {prompt_id}")

        if result["status"] == "error":
            raise RuntimeError(f"ComfyUI execution failed: {result.get('error', 'Unknown')}")

        # Fetch history to get outputs
        history = await self.get_history(prompt_id)
        return history.get(prompt_id, history)

    async def extract_output_video(self, history: dict) -> Optional[str]:
        """Extract the output video filename from execution history.

        Looks for VHS_VideoCombine node output (node 1747).
        """
        outputs = history.get("outputs", {})
        for node_id, node_output in outputs.items():
            for key in ("gifs", "videos"):
                if key in node_output:
                    for item in node_output[key]:
                        filename = item.get("filename", "")
                        if filename.endswith(".mp4"):
                            return filename
        return None
