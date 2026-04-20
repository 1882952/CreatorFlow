"""State machine definitions for Job and Segment lifecycle."""

from __future__ import annotations


class JobStatus:
    """Job status constants and allowed transitions."""

    DRAFT = "draft"
    QUEUED = "queued"
    PREPARING = "preparing"
    RUNNING = "running"
    CONCATENATING = "concatenating"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    CLEANING = "cleaning"
    PARTIALLY_CLEANED = "partially_cleaned"

    # Allowed transitions: {from_status: set(to_statuses)}
    TRANSITIONS: dict[str, set[str]] = {
        DRAFT: {QUEUED, CANCELLED},
        QUEUED: {PREPARING, CANCELLED},
        PREPARING: {RUNNING, FAILED, CANCELLED},
        RUNNING: {CONCATENATING, FAILED, CANCELLED},
        CONCATENATING: {COMPLETED, FAILED},
        COMPLETED: {CLEANING},
        FAILED: {QUEUED},          # retry
        CANCELLED: {QUEUED},       # retry
        CLEANING: {COMPLETED, PARTIALLY_CLEANED},
        PARTIALLY_CLEANED: set(),  # terminal
    }

    @classmethod
    def can_transition(cls, from_status: str, to_status: str) -> bool:
        """Check if a transition is allowed."""
        allowed = cls.TRANSITIONS.get(from_status, set())
        return to_status in allowed

    @classmethod
    def is_terminal(cls, status: str) -> bool:
        """Check if a status is terminal (no further transitions)."""
        return status in (cls.COMPLETED, cls.PARTIALLY_CLEANED) or (
            status not in cls.TRANSITIONS
        )


class SegmentStatus:
    """Segment status constants and allowed transitions."""

    PENDING = "pending"
    SPLITTING = "splitting"
    UPLOADING = "uploading"
    SUBMITTED = "submitted"
    RUNNING = "running"
    EXTRACTING_TAIL_FRAME = "extracting_tail_frame"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

    # Allowed transitions
    TRANSITIONS: dict[str, set[str]] = {
        PENDING: {SPLITTING, SKIPPED},
        SPLITTING: {UPLOADING, FAILED},
        UPLOADING: {SUBMITTED, FAILED},
        SUBMITTED: {RUNNING, FAILED},
        RUNNING: {EXTRACTING_TAIL_FRAME, FAILED},
        EXTRACTING_TAIL_FRAME: {COMPLETED, FAILED},
        COMPLETED: set(),         # terminal
        FAILED: {PENDING},        # retry
        SKIPPED: set(),           # terminal
    }

    @classmethod
    def can_transition(cls, from_status: str, to_status: str) -> bool:
        """Check if a transition is allowed."""
        allowed = cls.TRANSITIONS.get(from_status, set())
        return to_status in allowed

    @classmethod
    def is_terminal(cls, status: str) -> bool:
        """Check if a status is terminal."""
        return status in (cls.COMPLETED, cls.SKIPPED) or (
            status not in cls.TRANSITIONS
        )
