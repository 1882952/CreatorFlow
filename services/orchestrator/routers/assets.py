"""Asset overview router for final generated videos in the output directory."""

from __future__ import annotations

import mimetypes

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from config import settings
from models.schemas import AssetBatchDeleteRequest, AssetItemResponse, AssetListResponse
from services import job_service

router = APIRouter(tags=["assets"])


def _to_asset_item(request: Request, asset: dict) -> AssetItemResponse:
    """Convert an output-file record into a frontend-ready asset payload."""
    return AssetItemResponse(
        id=asset["id"],
        job_id=asset.get("job_id") or "",
        job_name=asset.get("job_name") or asset["filename"],
        job_status=asset.get("job_status") or "available",
        type=asset.get("type") or "final_video",
        segment_id=None,
        segment_index=None,
        filename=asset["filename"],
        path=asset["path"],
        size=asset["size"],
        exists=asset.get("exists", True),
        created_at=asset["created_at"],
        cleanup_status=asset.get("cleanup_status", "keep"),
        preview_url=str(request.url_for("get_asset_content", asset_id=asset["id"])),
        download_url=str(request.url_for("download_asset", asset_id=asset["id"])),
        delete_url=str(request.url_for("delete_asset", asset_id=asset["id"])),
    )


@router.get("/assets", response_model=AssetListResponse)
async def list_assets(request: Request) -> AssetListResponse:
    """List final generated videos from the configured output directory."""
    rows = job_service.list_output_assets(settings.output_dir)
    assets = [_to_asset_item(request, row) for row in rows]
    return AssetListResponse(assets=assets, total=len(assets))


@router.post("/assets/batch-delete")
async def batch_delete_assets(payload: AssetBatchDeleteRequest) -> dict:
    """Delete multiple final generated videos."""
    if not payload.ids:
        return {"deleted": [], "not_found": [], "locked": []}
    return job_service.batch_delete_output_assets(settings.output_dir, payload.ids)


@router.get("/assets/{asset_id}/content", name="get_asset_content")
async def get_asset_content(asset_id: str) -> FileResponse:
    """Return the raw asset file for inline preview."""
    try:
        path = job_service.resolve_output_asset_path(settings.output_dir, asset_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not path.exists():
        raise HTTPException(status_code=404, detail="Asset file not found")

    media_type, _ = mimetypes.guess_type(path.name)
    return FileResponse(path, media_type=media_type or "application/octet-stream")


@router.get("/assets/{asset_id}/download", name="download_asset")
async def download_asset(asset_id: str) -> FileResponse:
    """Download an asset file with attachment headers."""
    try:
        path = job_service.resolve_output_asset_path(settings.output_dir, asset_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not path.exists():
        raise HTTPException(status_code=404, detail="Asset file not found")

    media_type, _ = mimetypes.guess_type(path.name)
    return FileResponse(
        path,
        filename=path.name,
        media_type=media_type or "application/octet-stream",
    )


@router.delete("/assets/{asset_id}", name="delete_asset")
async def delete_asset(asset_id: str) -> dict:
    """Delete a final generated video from the output directory."""
    try:
        deleted = job_service.delete_output_asset(settings.output_dir, asset_id)
    except PermissionError as exc:
        raise HTTPException(
            status_code=409,
            detail="Asset file is currently in use. Stop preview playback and retry.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not deleted:
        raise HTTPException(status_code=404, detail="Asset not found")

    return {"assetId": asset_id, "deleted": True}
