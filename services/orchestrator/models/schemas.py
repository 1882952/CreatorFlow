"""Pydantic v2 data models for the CreatorFlow Orchestrator service."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class JobCreate(BaseModel):
    """Schema for creating a new job."""

    name: str = "Untitled Job"
    prompt: str = ""
    seed: int = 42
    fps: int = 24
    max_resolution: int = 1280
    segment_mode: str = "auto"  # auto | single
    max_segment_duration: float = 8.0
    cleanup_after_seconds: int = 300


class JobResponse(BaseModel):
    """Schema returned when reading a job."""

    id: str
    name: str
    status: str
    prompt: str
    seed: int
    fps: int
    max_resolution: int
    segment_mode: str
    max_segment_duration: float
    input_image_path: Optional[str] = None
    input_audio_path: Optional[str] = None
    output_dir: Optional[str] = None
    final_video_path: Optional[str] = None
    cleanup_policy: str
    cleanup_after_seconds: int
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    last_error: Optional[str] = None


class JobListResponse(BaseModel):
    """Schema for listing jobs."""

    jobs: list[JobResponse]
    total: int


class SegmentResponse(BaseModel):
    """Schema returned when reading a segment."""

    id: str
    job_id: str
    index: int
    status: str
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    cut_reason: Optional[str] = None
    source_image_mode: str
    source_image_path: Optional[str] = None
    audio_segment_path: Optional[str] = None
    comfy_prompt_id: Optional[str] = None
    comfy_output_path: Optional[str] = None
    tail_frame_path: Optional[str] = None
    last_error: Optional[str] = None


class JobDetailResponse(JobResponse):
    """Detailed job response including segments."""

    segments: list[SegmentResponse] = []


class ArtifactResponse(BaseModel):
    """Schema returned when reading an artifact."""

    id: str
    job_id: str
    segment_id: Optional[str] = None
    type: str  # segment_audio, tail_frame, segment_video, final_video, input_image, input_audio
    path: str
    source: Optional[str] = None
    created_at: str
    cleanup_status: str  # pending, cleaned, keep


class ArtifactListResponse(BaseModel):
    """Schema for listing artifacts of a job."""

    artifacts: list[ArtifactResponse]
    total: int


class AssetItemResponse(BaseModel):
    """Schema returned by the asset overview endpoint."""

    id: str
    job_id: str
    job_name: str
    job_status: str
    type: str
    segment_id: Optional[str] = None
    segment_index: Optional[int] = None
    filename: str
    path: str
    size: int
    exists: bool
    created_at: str
    cleanup_status: str
    preview_url: str
    download_url: str
    delete_url: str


class AssetListResponse(BaseModel):
    """Schema for listing generated assets across jobs."""

    assets: list[AssetItemResponse]
    total: int


class AssetBatchDeleteRequest(BaseModel):
    """Request body for batch deleting output assets."""

    ids: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    """Schema for the health-check endpoint."""

    status: str
    sqlite: str
    comfyui: str
    ffmpeg: str
    ffprobe: str
    timestamp: str


class JobSubmitRequest(BaseModel):
    """Request body for creating a job via JSON (alternative to FormData)."""

    name: str = "Untitled Job"
    prompt: str = ""
    seed: int = 42
    fps: int = 24
    max_resolution: int = 1280
    segment_mode: str = "auto"
    max_segment_duration: float = 8.0
    cleanup_after_seconds: int = 300
    input_image_path: Optional[str] = None
    input_audio_path: Optional[str] = None
    output_dir: Optional[str] = None
