"""WebSocket event manager for broadcasting real-time updates to clients."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class EventManager:
    """Manages connected WebSocket clients and broadcasts events."""

    def __init__(self) -> None:
        self._clients: list[WebSocket] = []

    def add_client(self, websocket: WebSocket) -> None:
        """Register a new WebSocket client."""
        self._clients.append(websocket)
        logger.info("WebSocket client connected. Total clients: %d", len(self._clients))

    def remove_client(self, websocket: WebSocket) -> None:
        """Unregister a WebSocket client."""
        if websocket in self._clients:
            self._clients.remove(websocket)
        logger.info("WebSocket client disconnected. Total clients: %d", len(self._clients))

    async def broadcast(self, event_type: str, data: Any) -> None:
        """Broadcast an event to all connected clients.

        The message format is:
            {"type": "<event_type>", "data": <data>, "timestamp": "<ISO-8601>"}
        """
        if not self._clients:
            return

        message = json.dumps(
            {
                "type": event_type,
                "data": data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

        stale_clients: list[WebSocket] = []

        for client in self._clients:
            try:
                await client.send_text(message)
            except Exception:
                logger.warning("Failed to send to a client; marking for removal.")
                stale_clients.append(client)

        for client in stale_clients:
            self.remove_client(client)

    def close(self) -> None:
        """Clean up all clients on shutdown."""
        self._clients.clear()
        logger.info("EventManager closed; all clients cleared.")
