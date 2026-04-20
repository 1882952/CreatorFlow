# State Machine: Job and Segment Lifecycle

## Job State Machine

```
draft ──→ queued ──→ preparing ──→ running ──→ concatenating ──→ completed ──→ cleaning ──→ completed
  │          │           │            │                                │
  └→ cancelled   └→ cancelled  └→ failed    └→ failed                 └→ partially_cleaned
                            │            │
                            └→ cancelled  └→ cancelled

failed ──→ queued (retry)
cancelled ──→ queued (retry)
```

### Transition Table

| From | To | Condition |
|------|----|-----------|
| draft | queued | User starts job |
| draft | cancelled | User cancels |
| queued | preparing | Orchestrator picks up job |
| queued | cancelled | User cancels |
| preparing | running | Audio segmented, first segment submitted |
| preparing | failed | Segmentation failed |
| preparing | cancelled | User cancels |
| running | concatenating | All segments completed |
| running | failed | A segment failed |
| running | cancelled | User cancels |
| concatenating | completed | Final video written |
| concatenating | failed | Concat or write failed |
| completed | cleaning | Cleanup scheduled |
| cleaning | completed | All intermediates cleaned |
| cleaning | partially_cleaned | Some cleanup failed |
| failed | queued | User retries |
| cancelled | queued | User retries |

### Terminal States

- `completed` — Job done, final video available
- `partially_cleaned` — Job done but cleanup incomplete (final video still safe)

---

## Segment State Machine

```
pending ──→ splitting ──→ uploading ──→ submitted ──→ running ──→ extracting_tail_frame ──→ completed
   │           │             │             │             │                  │
   └→ skipped  └→ failed     └→ failed     └→ failed     └→ failed          └→ failed

failed ──→ pending (retry)
```

### Transition Table

| From | To | Condition |
|------|----|-----------|
| pending | splitting | Audio segment export begins |
| pending | skipped | Segment skipped during retry |
| splitting | uploading | Audio segment file ready |
| splitting | failed | Split/export failed |
| uploading | submitted | Files uploaded to ComfyUI |
| uploading | failed | Upload failed |
| submitted | running | ComfyUI accepted prompt |
| submitted | failed | Prompt rejected |
| running | extracting_tail_frame | ComfyUI execution done, extracting tail |
| running | failed | ComfyUI execution failed |
| extracting_tail_frame | completed | Tail frame extracted |
| extracting_tail_frame | failed | Frame extraction failed |
| failed | pending | Retry initiated |

### Terminal States

- `completed` — Segment video generated, tail frame extracted
- `skipped` — Segment intentionally skipped
