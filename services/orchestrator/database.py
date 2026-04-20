"""SQLite database management for the CreatorFlow Orchestrator service."""

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from config import settings

_local = threading.local()


def _get_connection() -> sqlite3.Connection:
    """Get or create a thread-local database connection."""
    if not hasattr(_local, "connection") or _local.connection is None:
        db_path = Path(settings.database_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _local.connection = sqlite3.connect(str(db_path))
        _local.connection.row_factory = sqlite3.Row
        _local.connection.execute("PRAGMA journal_mode=WAL")
        _local.connection.execute("PRAGMA foreign_keys=ON")
    return _local.connection


@contextmanager
def get_connection():
    """Context manager that yields a thread-local database connection."""
    conn = _get_connection()
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise


def init_db() -> None:
    """Initialize the database, creating all required tables."""
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                prompt TEXT DEFAULT '',
                seed INTEGER DEFAULT 42,
                fps INTEGER DEFAULT 24,
                max_resolution INTEGER DEFAULT 1280,
                segment_mode TEXT DEFAULT 'auto',
                max_segment_duration REAL DEFAULT 8.0,
                input_image_path TEXT,
                input_audio_path TEXT,
                output_dir TEXT,
                final_video_path TEXT,
                cleanup_policy TEXT DEFAULT 'auto',
                cleanup_after_seconds INTEGER DEFAULT 300,
                created_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                last_error TEXT
            );

            CREATE TABLE IF NOT EXISTS segments (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                "index" INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                start_seconds REAL NOT NULL,
                end_seconds REAL NOT NULL,
                duration_seconds REAL NOT NULL,
                cut_reason TEXT,
                source_image_mode TEXT DEFAULT 'original',
                source_image_path TEXT,
                audio_segment_path TEXT,
                comfy_prompt_id TEXT,
                comfy_output_path TEXT,
                tail_frame_path TEXT,
                last_error TEXT,
                FOREIGN KEY (job_id) REFERENCES jobs(id)
            );

            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                segment_id TEXT,
                type TEXT NOT NULL,
                path TEXT NOT NULL,
                source TEXT,
                created_at TEXT NOT NULL,
                cleanup_status TEXT DEFAULT 'pending',
                FOREIGN KEY (job_id) REFERENCES jobs(id),
                FOREIGN KEY (segment_id) REFERENCES segments(id)
            );
        """)
        conn.commit()
