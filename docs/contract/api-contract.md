# API Contract: CreatorFlow Orchestrator v2.1

Base URL: `http://localhost:18688`

## REST Endpoints

### Health Check

**`GET /api/health`**

Response:
```json
{
  "status": "ok",
  "sqlite": "ok",
  "comfyui": "ok",
  "ffmpeg": "ok",
  "ffprobe": "ok",
  "timestamp": "2026-04-20T12:00:00+00:00"
}
```

---

### Create Job

**`POST /api/jobs`**

Content-Type: `multipart/form-data`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| name | string | no | "Untitled Job" | Job name |
| prompt | string | no | "" | Text prompt |
| seed | int | no | 42 | Random seed |
| fps | int | no | 24 | Frame rate |
| max_resolution | int | no | 1280 | Max resolution |
| segment_mode | string | no | "auto" | "auto" or "single" |
| max_segment_duration | float | no | 8.0 | Max seconds per segment |
| cleanup_after_seconds | int | no | 300 | Cleanup delay |
| image | file | no | - | Reference image (jpg/png/webp) |
| audio | file | no | - | Audio file (mp3/wav/ogg/flac) |

Response:
```json
{
  "jobId": "a1b2c3d4e5f6...",
  "status": "draft"
}
```

---

### List Jobs

**`GET /api/jobs`**

Response:
```json
{
  "jobs": [
    {
      "id": "a1b2c3d4e5f6...",
      "name": "My Video",
      "status": "completed",
      "prompt": "A person talking naturally",
      "seed": 42,
      "fps": 24,
      "max_resolution": 1280,
      "segment_mode": "auto",
      "max_segment_duration": 8.0,
      "input_image_path": "data/work/img_photo.jpg",
      "input_audio_path": "data/work/audio_voice.mp3",
      "output_dir": "data/output",
      "final_video_path": "data/output/a1b2c3-final.mp4",
      "cleanup_policy": "auto",
      "cleanup_after_seconds": 300,
      "created_at": "2026-04-20T12:00:00+00:00",
      "started_at": "2026-04-20T12:00:05+00:00",
      "completed_at": "2026-04-20T12:15:30+00:00",
      "last_error": null
    }
  ],
  "total": 1
}
```

---

### Get Job Detail

**`GET /api/jobs/{jobId}`**

Response: Same as job object above, plus segments:
```json
{
  "id": "a1b2c3d4e5f6...",
  "...": "...(same fields as above)...",
  "segments": [
    {
      "id": "seg_id_1",
      "job_id": "a1b2c3d4e5f6...",
      "index": 0,
      "status": "completed",
      "start_seconds": 0.0,
      "end_seconds": 7.2,
      "duration_seconds": 7.2,
      "cut_reason": "silence",
      "source_image_mode": "original",
      "source_image_path": "data/work/img_photo.jpg",
      "audio_segment_path": "data/work/seg_0_audio.wav",
      "comfy_prompt_id": "abc-123",
      "comfy_output_path": "creatorflow-dh-a1b2-seg0.mp4",
      "tail_frame_path": "data/work/seg_0_tail.jpg",
      "last_error": null
    }
  ]
}
```

---

### Start Job

**`POST /api/jobs/{jobId}/start`**

Response:
```json
{
  "jobId": "a1b2c3d4e5f6...",
  "status": "queued"
}
```

---

### Cancel Job

**`POST /api/jobs/{jobId}/cancel`**

Response:
```json
{
  "jobId": "a1b2c3d4e5f6...",
  "status": "cancelled"
}
```

---

### Retry Job

**`POST /api/jobs/{jobId}/retry`**

Retries from the last failed segment. Completed segments are preserved.

Response:
```json
{
  "jobId": "a1b2c3d4e5f6...",
  "status": "queued"
}
```

---

### Get Artifacts

**`GET /api/jobs/{jobId}/artifacts`**

Response:
```json
{
  "artifacts": [
    {
      "id": "art_1",
      "job_id": "a1b2c3d4e5f6...",
      "segment_id": "seg_id_0",
      "type": "segment_audio",
      "path": "data/work/seg_0_audio.wav",
      "source": "ffmpeg_split",
      "created_at": "2026-04-20T12:00:10+00:00",
      "cleanup_status": "pending"
    }
  ],
  "total": 1
}
```

Artifact types:
- `input_image` — Original uploaded image (keep)
- `input_audio` — Original uploaded audio (keep)
- `segment_audio` — Split audio segment (cleanable)
- `tail_frame` — Extracted tail frame image (cleanable)
- `segment_video` — ComfyUI output video per segment (cleanable)
- `final_video` — Concatenated final video (keep)

---

### Upload File

**`POST /api/upload`**

Content-Type: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | file | yes | File to upload |

Response:
```json
{
  "path": "data/work/uploaded_filename.ext",
  "size": 12345
}
```

---

## WebSocket

**`WS /ws`**

Connect and receive real-time events. Client can also send control messages.

### Events (Server → Client)

All events follow the format:
```json
{
  "type": "<event_type>",
  "data": { ... },
  "timestamp": "2026-04-20T12:00:00+00:00"
}
```

#### Job Events

| Event | Data |
|-------|------|
| `job.created` | `{ jobId, name, status: "draft" }` |
| `job.queued` | `{ jobId, status: "queued" }` |
| `job.preparing` | `{ jobId, status: "preparing", segmentCount: 3 }` |
| `job.started` | `{ jobId, status: "running" }` |
| `job.updated` | `{ jobId, status, ...changedFields }` |
| `job.concatenating` | `{ jobId, status: "concatenating" }` |
| `job.completed` | `{ jobId, status: "completed", finalVideoPath, totalDuration }` |
| `job.failed` | `{ jobId, status: "failed", error, failedSegmentIndex }` |
| `job.cancelled` | `{ jobId, status: "cancelled" }` |
| `job.cleanup_scheduled` | `{ jobId, cleanupAfterSeconds }` |
| `job.cleanup_completed` | `{ jobId, cleanedCount }` |

#### Segment Events

| Event | Data |
|-------|------|
| `segment.started` | `{ jobId, segmentId, index }` |
| `segment.splitting` | `{ jobId, segmentId, index }` |
| `segment.uploading` | `{ jobId, segmentId, index }` |
| `segment.submitted` | `{ jobId, segmentId, index, promptId }` |
| `segment.progress` | `{ jobId, segmentId, index, progress: { value, max }, currentNode? }` |
| `segment.completed` | `{ jobId, segmentId, index, outputPath, tailFramePath? }` |
| `segment.failed` | `{ jobId, segmentId, index, error }` |

### Control Messages (Client → Server)

```json
{ "action": "cancel", "jobId": "..." }
{ "action": "retry", "jobId": "..." }
```
