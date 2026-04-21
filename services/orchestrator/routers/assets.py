"""Asset overview router for generated local outputs."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from models.schemas import AssetItemResponse, AssetListResponse
from services import job_service

router = APIRouter(tags=["assets"])


def _resolve_path(path_str: str) -> Path:
    """Resolve an artifact path relative to the current process root when needed."""
    path = Path(path_str)
    if path.is_absolute():
        return path
    return (Path.cwd() / path).resolve()


def _to_asset_item(request: Request, artifact: dict) -> AssetItemResponse:
    """Convert a raw artifact row into a frontend-ready asset payload."""
    resolved = _resolve_path(artifact["path"])
    exists = resolved.exists()
    size = resolved.stat().st_size if exists else 0

    return AssetItemResponse(
        id=artifact["id"],
        job_id=artifact["job_id"],
        job_name=artifact.get("job_name") or artifact["job_id"],
        job_status=artifact.get("job_status") or "unknown",
        type=artifact["type"],
        segment_id=artifact.get("segment_id"),
        segment_index=artifact.get("segment_index"),
        filename=resolved.name,
        path=str(resolved),
        size=size,
        exists=exists,
        created_at=artifact["created_at"],
        cleanup_status=artifact.get("cleanup_status", "pending"),
        preview_url=str(request.url_for("get_asset_content", artifact_id=artifact["id"])),
        download_url=str(request.url_for("download_asset", artifact_id=artifact["id"])),
        delete_url=str(request.url_for("delete_asset", artifact_id=artifact["id"])),
    )


@router.get("/assets", response_model=AssetListResponse)
async def list_assets(request: Request) -> AssetListResponse:
    """List generated video assets across all jobs."""
    rows = job_service.list_generated_assets()
    assets = [_to_asset_item(request, row) for row in rows]
    return AssetListResponse(assets=assets, total=len(assets))


@router.get("/assets/{artifact_id}/content", name="get_asset_content")
async def get_asset_content(artifact_id: str) -> FileResponse:
    """Return the raw asset file for inline preview."""
    artifact = job_service.get_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    path = _resolve_path(artifact["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Asset file not found")

    media_type, _ = mimetypes.guess_type(path.name)
    return FileResponse(path, media_type=media_type or "application/octet-stream")


@router.get("/assets/{artifact_id}/download", name="download_asset")
async def download_asset(artifact_id: str) -> FileResponse:
    """Download an asset file with attachment headers."""
    artifact = job_service.get_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    path = _resolve_path(artifact["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Asset file not found")

    media_type, _ = mimetypes.guess_type(path.name)
    return FileResponse(
        path,
        filename=path.name,
        media_type=media_type or "application/octet-stream",
    )


@router.delete("/assets/{artifact_id}", name="delete_asset")
async def delete_asset(artifact_id: str) -> dict:
    """Delete a generated asset file and remove its record."""
    artifact = job_service.get_artifact(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    path = _resolve_path(artifact["path"])
    if path.exists():
        path.unlink()

    job_service.delete_artifact(artifact_id)
    return {"artifactId": artifact_id, "deleted": True}
