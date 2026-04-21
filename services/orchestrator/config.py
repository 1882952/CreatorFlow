"""Configuration management for the CreatorFlow Orchestrator service."""

import os
from dataclasses import dataclass, field
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def resolve_app_path(path_str: str) -> Path:
    """Resolve a configured path against the repository root when relative."""
    path = Path(path_str)
    if path.is_absolute():
        return path.resolve()
    return (PROJECT_ROOT / path).resolve()


@dataclass
class Settings:
    """Application settings with environment variable overrides."""

    port: int = field(default_factory=lambda: int(os.environ.get("ORCHESTRATOR_PORT", "18688")))
    host: str = field(default_factory=lambda: os.environ.get("ORCHESTRATOR_HOST", "0.0.0.0"))
    comfyui_url: str = field(default_factory=lambda: os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188"))
    comfyui_output_dir: str = field(default_factory=lambda: os.environ.get("COMFYUI_OUTPUT_DIR", ""))
    comfyui_input_dir: str = field(default_factory=lambda: os.environ.get("COMFYUI_INPUT_DIR", ""))
    database_path: str = field(default_factory=lambda: os.environ.get("DATABASE_PATH", "data/orchestrator.db"))
    output_dir: str = field(default_factory=lambda: os.environ.get("OUTPUT_DIR", "data/output"))
    work_dir: str = field(default_factory=lambda: os.environ.get("WORK_DIR", "data/work"))
    log_level: str = field(default_factory=lambda: os.environ.get("LOG_LEVEL", "INFO"))
    cleanup_default_delay_seconds: int = field(
        default_factory=lambda: int(os.environ.get("CLEANUP_DEFAULT_DELAY_SECONDS", "300"))
    )
    max_segment_duration: float = 8.0
    min_segment_duration: float = 2.0
    hard_max_duration: float = 10.0

    def __post_init__(self) -> None:
        """Ensure required directories exist after initialization."""
        self.database_path = str(resolve_app_path(self.database_path))
        self.output_dir = str(resolve_app_path(self.output_dir))
        self.work_dir = str(resolve_app_path(self.work_dir))

        if self.comfyui_output_dir:
            self.comfyui_output_dir = str(resolve_app_path(self.comfyui_output_dir))
        if self.comfyui_input_dir:
            self.comfyui_input_dir = str(resolve_app_path(self.comfyui_input_dir))

        Path(self.output_dir).mkdir(parents=True, exist_ok=True)
        Path(self.work_dir).mkdir(parents=True, exist_ok=True)

        # Ensure the parent directory of the database exists
        db_parent = Path(self.database_path).parent
        db_parent.mkdir(parents=True, exist_ok=True)


settings = Settings()
