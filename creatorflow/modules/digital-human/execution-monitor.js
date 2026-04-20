/**
 * ExecutionMonitor Component
 *
 * Renders the execution-mode view showing current task progress,
 * queue overview, live log, and segmented execution details.
 */
export class ExecutionMonitor {
  /** @type {HTMLElement} */
  #container;
  /** @type {import('../../core/event-bus.js').EventBus} */
  #eventBus;
  /** @type {import('../../core/comfyui-client.js').ComfyUIClient} */
  #comfyClient;
  /** @type {Array<{time:string,msg:string,type:string}>} */
  #logs = [];
  /** @type {boolean} */
  #logExpanded = true;
  /** @type {string|null} */
  #previewTaskId = null;
  /** @type {Function|null} */
  #unsubscribeLog = null;
  /** @type {Function|null} */
  #unsubscribeWs = null;
  /** @type {Function|null} */
  #unsubscribeSegment = null;
  /** @type {Set<string>} */
  #expandedSegmentIds = new Set();

  /**
   * @param {{ container: HTMLElement, eventBus: import('../../core/event-bus.js').EventBus, comfyClient: import('../../core/comfyui-client.js').ComfyUIClient }} opts
   */
  constructor({ container, eventBus, comfyClient }) {
    this.#container = container;
    this.#eventBus = eventBus;
    this.#comfyClient = comfyClient;
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Render the execution monitor view.
   * @param {Array<object>} tasks - All tasks
   * @param {object} queueState - Queue state from TaskQueue
   * @param {number} currentTaskIndex - Index of currently running task (-1 if none)
   */
  render(tasks, queueState, currentTaskIndex) {
    this.#container.innerHTML = '';

    const monitor = document.createElement('div');
    monitor.className = 'dh-execution-monitor';

    // Section 1: Current task detail
    if (currentTaskIndex >= 0 && currentTaskIndex < tasks.length) {
      const current = tasks[currentTaskIndex];
      monitor.appendChild(this.#createCurrentTask(current));
    } else {
      monitor.appendChild(this.#createNoCurrentTask());
    }

    // Video preview (if a completed task was clicked)
    if (this.#previewTaskId) {
      const previewTask = tasks.find(t => t.id === this.#previewTaskId);
      if (previewTask && previewTask.output && previewTask.output.videoUrl) {
        monitor.appendChild(this.#createVideoResult(previewTask));
      }
    }

    // Section 2: Queue overview
    monitor.appendChild(this.#createQueueOverview(tasks, currentTaskIndex));

    // Section 3: Live log
    monitor.appendChild(this.#createLogSection());

    this.#container.appendChild(monitor);
  }

  /**
   * Subscribe to live events. Call once after construction.
   */
  bindEvents() {
    // Subscribe to queue log events
    this.#unsubscribeLog = this.#eventBus.on('queue:log', (entry) => {
      this.#addLog(entry.message || String(entry), entry.type || 'info');
    });

    // Subscribe to ComfyUI WebSocket events for logging
    const wsEvents = ['progress', 'executing', 'executed', 'execution_error', 'status'];
    const unsubscribers = [];
    for (const evt of wsEvents) {
      const unsub = this.#eventBus.on(`comfy:ws:${evt}`, (data) => {
        let msg = `[WS:${evt}]`;
        if (data.node) msg += ` node=${data.node}`;
        if (data.value !== undefined) msg += ` value=${data.value}`;
        if (data.max !== undefined) msg += ` max=${data.max}`;
        const type = evt === 'execution_error' ? 'error' : (evt === 'executed' ? 'success' : 'info');
        this.#addLog(msg, type);
      });
      unsubscribers.push(unsub);
    }

    this.#unsubscribeWs = () => {
      for (const unsub of unsubscribers) unsub();
    };

    // Subscribe to orchestrator segment events
    const segmentEvents = [
      'orchestrator:segment.started',
      'orchestrator:segment.progress',
      'orchestrator:segment.completed',
      'orchestrator:segment.failed',
    ];
    const segmentUnsubscribers = [];
    for (const evt of segmentEvents) {
      const unsub = this.#eventBus.on(evt, (data) => {
        const type = evt.endsWith('failed') ? 'error'
          : evt.endsWith('completed') ? 'success'
          : 'info';
        const idx = data.index !== undefined ? data.index : '?';
        let msg = `[段${idx + 1}]`;
        if (evt.endsWith('started')) msg += ' 开始执行';
        else if (evt.endsWith('progress')) msg += ` 进度 ${data.progress || 0}%${data.currentNode ? ` 节点=${data.currentNode}` : ''}`;
        else if (evt.endsWith('completed')) msg += ' 执行完成';
        else if (evt.endsWith('failed')) msg += ` 执行失败${data.error ? ': ' + data.error : ''}`;
        this.#addLog(msg, type);
      });
      segmentUnsubscribers.push(unsub);
    }

    this.#unsubscribeSegment = () => {
      for (const unsub of segmentUnsubscribers) unsub();
    };

    // Click delegation for queue rows, log toggle, segment interactions, retry, and result expand
    this.#container.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);

      // Queue row click -> preview video
      const row = target.closest('.dh-queue-row');
      if (row && row.dataset.taskId) {
        this.#previewTaskId = row.dataset.taskId;
        // Re-render handled by controller calling render() again
        this.#eventBus.emit('monitor:preview', { taskId: row.dataset.taskId });
        return;
      }

      // Log header toggle
      const logHeader = target.closest('[data-action="toggle-log"]');
      if (logHeader) {
        this.#logExpanded = !this.#logExpanded;
        const body = this.#container.querySelector('[data-role="log-body"]');
        if (body) body.style.display = this.#logExpanded ? 'block' : 'none';
        const arrow = logHeader.querySelector('.dh-advanced-arrow');
        if (arrow) {
          arrow.style.transform = this.#logExpanded ? 'rotate(90deg)' : '';
        }
        return;
      }

      // Retry from failed segment
      const retryBtn = target.closest('[data-action="retry-segment"]');
      if (retryBtn) {
        const segIndex = retryBtn.dataset.segIndex;
        const taskId = retryBtn.dataset.taskId;
        if (segIndex !== undefined && taskId) {
          this.#eventBus.emit('monitor:retry-segment', {
            taskId,
            segmentIndex: Number(segIndex),
          });
        }
        return;
      }

      // Toggle segment video list expand
      const expandToggle = target.closest('[data-action="toggle-segment-videos"]');
      if (expandToggle) {
        const taskId = expandToggle.dataset.taskId;
        if (taskId) {
          if (this.#expandedSegmentIds.has(taskId)) {
            this.#expandedSegmentIds.delete(taskId);
          } else {
            this.#expandedSegmentIds.add(taskId);
          }
          // Toggle visibility of the segment video list
          const list = this.#container.querySelector(`[data-role="segment-video-list"][data-task-id="${taskId}"]`);
          if (list) {
            list.style.display = this.#expandedSegmentIds.has(taskId) ? 'block' : 'none';
          }
          const arrow = expandToggle.querySelector('.dh-advanced-arrow');
          if (arrow) {
            arrow.style.transform = this.#expandedSegmentIds.has(taskId) ? 'rotate(90deg)' : '';
          }
        }
        return;
      }
    });
  }

  /**
   * Clean up event subscriptions.
   */
  destroy() {
    if (this.#unsubscribeLog) this.#unsubscribeLog();
    if (this.#unsubscribeWs) this.#unsubscribeWs();
    if (this.#unsubscribeSegment) this.#unsubscribeSegment();
    this.#logs = [];
    this.#expandedSegmentIds.clear();
  }

  // ── Section: Current Task ──────────────────────────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createCurrentTask(task) {
    const el = document.createElement('div');
    el.className = 'dh-monitor-current';

    const hasSegments = Array.isArray(task.segments) && task.segments.length > 0;
    const isCompleted = task.status === 'completed';
    const isFailed = task.status === 'failed';

    const header = document.createElement('div');
    header.className = 'dh-monitor-header';

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.className = 'dh-monitor-thumb';
    if (task.image && task.image.previewUrl) {
      const img = document.createElement('img');
      img.src = task.image.previewUrl;
      img.alt = '';
      thumb.appendChild(img);
    }
    header.appendChild(thumb);

    // Title + stage
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';

    const title = document.createElement('div');
    title.className = 'dh-monitor-title';
    title.textContent = task.name || '未命名任务';
    info.appendChild(title);

    const stage = document.createElement('div');
    stage.className = 'dh-monitor-stage';
    stage.textContent = task.progressLabel || this.#stageLabel(task.status);
    info.appendChild(stage);

    // Segment dimension progress label
    if (hasSegments) {
      const completedSegs = task.segments.filter(s => s.status === 'completed').length;
      const segLabel = document.createElement('div');
      segLabel.className = 'dh-monitor-seg-label';
      segLabel.style.cssText = 'font-size:12px;color:var(--color-info);margin-top:2px;';
      segLabel.textContent = `分段 ${completedSegs}/${task.segments.length}`;
      info.appendChild(segLabel);
    }

    header.appendChild(info);

    // Status badge
    const badge = document.createElement('span');
    badge.className = `status-badge ${task.status || 'running'}`;
    badge.textContent = this.#statusLabel(task.status);
    header.appendChild(badge);

    el.appendChild(header);

    // Overall progress bar
    const progressRow = document.createElement('div');
    progressRow.className = 'dh-monitor-progress';

    const track = document.createElement('div');
    track.className = 'progress-bar-track';
    const fill = document.createElement('div');
    fill.className = 'progress-bar-fill';

    if (hasSegments) {
      fill.style.width = `${this.#computeSegmentOverallProgress(task.segments)}%`;
    } else {
      fill.style.width = `${task.progress || 0}%`;
    }
    track.appendChild(fill);
    progressRow.appendChild(track);

    const text = document.createElement('div');
    text.className = 'dh-progress-text';
    if (hasSegments) {
      text.textContent = `${Math.round(this.#computeSegmentOverallProgress(task.segments))}%`;
    } else {
      text.textContent = `${Math.round(task.progress || 0)}%`;
    }
    progressRow.appendChild(text);

    el.appendChild(progressRow);

    // Current node (non-segmented path)
    if (!hasSegments && task.currentNode) {
      const node = document.createElement('div');
      node.className = 'dh-monitor-node';
      node.textContent = `当前节点: ${task.currentNode}`;
      el.appendChild(node);
    }

    // ── Segmented execution sections ──

    if (hasSegments) {
      // Segment list
      el.appendChild(this.#createSegmentList(task));

      // Current running segment detail
      const runningSeg = task.segments.find(s => s.status === 'running' || s.status === 'uploading');
      if (runningSeg) {
        el.appendChild(this.#createCurrentSegmentDetail(runningSeg));
      }

      // Retry button on failure
      if (isFailed) {
        const failedSeg = task.segments.find(s => s.status === 'failed');
        if (failedSeg) {
          el.appendChild(this.#createRetryButton(task, failedSeg));
        }
      }
    }

    // ── Final result on completion ──

    if (isCompleted && task.finalOutput) {
      el.appendChild(this.#createFinalResult(task));
    }

    return el;
  }

  /**
   * @returns {HTMLElement}
   */
  #createNoCurrentTask() {
    const el = document.createElement('div');
    el.className = 'dh-monitor-current';
    el.innerHTML = `
      <div style="text-align:center;padding:24px;color:var(--text-secondary);font-size:13px;">
        队列空闲，等待执行...
      </div>
    `;
    return el;
  }

  // ── Section: Segment List ──────────────────────────────────

  /**
   * Create the segment list view showing each segment's status.
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createSegmentList(task) {
    const el = document.createElement('div');
    el.className = 'dh-segment-list';
    el.style.cssText = 'margin-top:12px;';

    const listTitle = document.createElement('div');
    listTitle.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-bottom:6px;font-weight:500;';
    listTitle.textContent = '分段列表';
    el.appendChild(listTitle);

    for (const seg of task.segments) {
      el.appendChild(this.#createSegmentRow(seg));
    }

    return el;
  }

  /**
   * @param {{ index: number, status: string, startSeconds: number, endSeconds: number, durationSeconds: number, progress: number, currentNode: string|null, error: string|null, outputVideoUrl: string|null }} seg
   * @returns {HTMLElement}
   */
  #createSegmentRow(seg) {
    const row = document.createElement('div');
    row.className = 'dh-segment-row';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--radius-sm);margin-bottom:2px;background:var(--bg-glass);';

    // Status indicator dot
    const dot = document.createElement('div');
    dot.className = `dh-segment-dot dh-segment-dot--${seg.status}`;
    dot.style.cssText = this.#segmentDotStyle(seg.status);
    row.appendChild(dot);

    // Segment label (段 N)
    const label = document.createElement('div');
    label.style.cssText = 'font-size:12px;color:var(--text-primary);min-width:36px;';
    label.textContent = `段 ${seg.index + 1}`;
    row.appendChild(label);

    // Time range
    const timeRange = document.createElement('div');
    timeRange.style.cssText = 'font-size:11px;color:var(--text-secondary);min-width:80px;';
    timeRange.textContent = `${this.#formatSeconds(seg.startSeconds)}-${this.#formatSeconds(seg.endSeconds)}`;
    row.appendChild(timeRange);

    // Mini progress bar
    const miniBar = document.createElement('div');
    miniBar.style.cssText = 'flex:1;height:4px;background:var(--border-color);border-radius:2px;overflow:hidden;';
    const miniFill = document.createElement('div');
    miniFill.style.cssText = `height:100%;border-radius:2px;transition:width var(--transition-fast);${this.#segmentFillStyle(seg)}`;
    miniBar.appendChild(miniFill);
    row.appendChild(miniBar);

    // Status text
    const statusText = document.createElement('div');
    statusText.style.cssText = `font-size:11px;min-width:48px;text-align:right;${this.#segmentStatusColor(seg.status)}`;
    statusText.textContent = this.#segmentStatusLabel(seg.status, seg.progress);
    row.appendChild(statusText);

    return row;
  }

  /**
   * Create detail panel for the currently running segment.
   * @param {{ index: number, status: string, startSeconds: number, endSeconds: number, durationSeconds: number, progress: number, currentNode: string|null, error: string|null }} seg
   * @returns {HTMLElement}
   */
  #createCurrentSegmentDetail(seg) {
    const el = document.createElement('div');
    el.className = 'dh-current-segment-detail';
    el.style.cssText = 'margin-top:8px;padding:8px 10px;border-radius:var(--radius-md);background:rgba(108,92,231,0.08);border:1px solid rgba(108,92,231,0.15);';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';

    const segTitle = document.createElement('div');
    segTitle.style.cssText = 'font-size:13px;color:var(--color-primary-light);font-weight:500;';
    segTitle.textContent = `正在执行: 段 ${seg.index + 1} (${this.#formatSeconds(seg.startSeconds)}-${this.#formatSeconds(seg.endSeconds)})`;
    header.appendChild(segTitle);

    const pct = document.createElement('div');
    pct.style.cssText = 'font-size:12px;color:var(--text-secondary);';
    pct.textContent = `${Math.round(seg.progress || 0)}%`;
    header.appendChild(pct);

    el.appendChild(header);

    // Segment progress bar
    const track = document.createElement('div');
    track.style.cssText = 'height:6px;background:var(--border-color);border-radius:3px;overflow:hidden;margin-bottom:4px;';
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;border-radius:3px;background:var(--color-primary-light);transition:width var(--transition-fast);width:${seg.progress || 0}%;`;
    track.appendChild(fill);
    el.appendChild(track);

    // Current node
    if (seg.currentNode) {
      const nodeEl = document.createElement('div');
      nodeEl.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-top:4px;';
      nodeEl.textContent = `当前节点: ${seg.currentNode}`;
      el.appendChild(nodeEl);
    }

    return el;
  }

  // ── Section: Retry Button ──────────────────────────────────

  /**
   * @param {object} task
   * @param {{ index: number, error: string|null }} failedSeg
   * @returns {HTMLElement}
   */
  #createRetryButton(task, failedSeg) {
    const el = document.createElement('div');
    el.className = 'dh-retry-section';
    el.style.cssText = 'margin-top:10px;display:flex;align-items:center;gap:10px;';

    // Error message
    if (failedSeg.error) {
      const errMsg = document.createElement('div');
      errMsg.style.cssText = 'flex:1;font-size:12px;color:var(--color-error);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      errMsg.textContent = `段 ${failedSeg.index + 1} 失败: ${failedSeg.error}`;
      errMsg.title = failedSeg.error;
      el.appendChild(errMsg);
    }

    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-primary btn-sm';
    retryBtn.style.cssText = 'white-space:nowrap;';
    retryBtn.textContent = `从失败段重试 (段 ${failedSeg.index + 1})`;
    retryBtn.dataset.action = 'retry-segment';
    retryBtn.dataset.segIndex = String(failedSeg.index);
    retryBtn.dataset.taskId = task.id;
    el.appendChild(retryBtn);

    return el;
  }

  // ── Section: Final Result ──────────────────────────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createFinalResult(task) {
    const el = document.createElement('div');
    el.className = 'dh-final-result';
    el.style.cssText = 'margin-top:12px;padding:12px;border-radius:var(--radius-md);background:rgba(0,184,148,0.08);border:1px solid rgba(0,184,148,0.15);';

    const header = document.createElement('div');
    header.style.cssText = 'font-size:13px;color:var(--color-success);font-weight:500;margin-bottom:8px;';
    header.textContent = '最终结果';
    el.appendChild(header);

    // Video player
    const video = document.createElement('video');
    video.controls = true;
    video.src = task.finalOutput.videoUrl;
    video.preload = 'metadata';
    video.style.cssText = 'width:100%;border-radius:var(--radius-sm);margin-bottom:8px;';
    el.appendChild(video);

    // File info row
    const fileInfo = document.createElement('div');
    fileInfo.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-secondary);margin-bottom:8px;';

    if (task.finalOutput.filename) {
      const nameRow = document.createElement('div');
      nameRow.textContent = `文件名: ${task.finalOutput.filename}`;
      fileInfo.appendChild(nameRow);
    }
    if (task.finalOutput.localPath) {
      const pathRow = document.createElement('div');
      pathRow.style.cssText = 'word-break:break-all;';
      pathRow.textContent = `本地路径: ${task.finalOutput.localPath}`;
      fileInfo.appendChild(pathRow);
    }
    if (task.finalOutput.duration) {
      const durRow = document.createElement('div');
      durRow.textContent = `时长: ${this.#formatSeconds(task.finalOutput.duration)}`;
      fileInfo.appendChild(durRow);
    }
    el.appendChild(fileInfo);

    // Download button
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';

    const downloadBtn = document.createElement('a');
    downloadBtn.className = 'btn btn-primary btn-sm';
    downloadBtn.textContent = '下载视频';
    downloadBtn.href = task.finalOutput.videoUrl;
    downloadBtn.download = task.finalOutput.filename || 'final-video.mp4';
    downloadBtn.target = '_blank';
    actions.appendChild(downloadBtn);

    // Expandable segment video list toggle (only if segments have output videos)
    const segmentsWithOutput = (task.segments || []).filter(s => s.outputVideoUrl);
    if (segmentsWithOutput.length > 0) {
      const isExpanded = this.#expandedSegmentIds.has(task.id);

      const toggleBtn = document.createElement('div');
      toggleBtn.dataset.action = 'toggle-segment-videos';
      toggleBtn.dataset.taskId = task.id;
      toggleBtn.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--color-info);cursor:pointer;user-select:none;';

      const toggleArrow = document.createElement('svg');
      toggleArrow.className = 'dh-advanced-arrow';
      toggleArrow.setAttribute('viewBox', '0 0 24 24');
      toggleArrow.setAttribute('fill', 'none');
      toggleArrow.setAttribute('stroke', 'currentColor');
      toggleArrow.setAttribute('stroke-width', '2');
      toggleArrow.style.cssText = 'width:12px;height:12px;';
      if (isExpanded) toggleArrow.style.transform = 'rotate(90deg)';
      toggleArrow.innerHTML = '<polyline points="9 18 15 12 9 6"/>';
      toggleBtn.appendChild(toggleArrow);

      const toggleLabel = document.createElement('span');
      toggleLabel.textContent = `分段视频 (${segmentsWithOutput.length})`;
      toggleBtn.appendChild(toggleLabel);

      actions.appendChild(toggleBtn);
    }

    el.appendChild(actions);

    // Segment video list (expandable)
    if (segmentsWithOutput.length > 0) {
      const isExpanded = this.#expandedSegmentIds.has(task.id);

      const segList = document.createElement('div');
      segList.dataset.role = 'segment-video-list';
      segList.dataset.taskId = task.id;
      segList.style.cssText = `margin-top:8px;display:${isExpanded ? 'block' : 'none'};`;

      for (const seg of segmentsWithOutput) {
        const segRow = document.createElement('div');
        segRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-color);';

        const segLabel = document.createElement('div');
        segLabel.style.cssText = 'font-size:12px;color:var(--text-primary);min-width:36px;';
        segLabel.textContent = `段 ${seg.index + 1}`;
        segRow.appendChild(segLabel);

        const segTime = document.createElement('div');
        segTime.style.cssText = 'font-size:11px;color:var(--text-secondary);min-width:80px;';
        segTime.textContent = `${this.#formatSeconds(seg.startSeconds)}-${this.#formatSeconds(seg.endSeconds)}`;
        segRow.appendChild(segTime);

        const segLink = document.createElement('a');
        segLink.style.cssText = 'font-size:12px;color:var(--color-info);text-decoration:none;';
        segLink.textContent = '播放';
        segLink.href = seg.outputVideoUrl;
        segLink.target = '_blank';
        segRow.appendChild(segLink);

        segList.appendChild(segRow);
      }

      el.appendChild(segList);
    }

    return el;
  }

  // ── Section: Queue Overview ────────────────────────────────

  /**
   * @param {Array<object>} tasks
   * @param {number} currentTaskIndex
   * @returns {HTMLElement}
   */
  #createQueueOverview(tasks, currentTaskIndex) {
    const el = document.createElement('div');
    el.className = 'dh-monitor-queue';

    const title = document.createElement('div');
    title.className = 'dh-queue-title';
    title.textContent = `队列总览 (${tasks.length})`;
    el.appendChild(title);

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const row = document.createElement('div');
      row.className = 'dh-queue-row';
      row.dataset.taskId = task.id;

      // Thumbnail
      const thumb = document.createElement('div');
      thumb.className = 'dh-queue-thumb';
      if (task.image && task.image.previewUrl) {
        const img = document.createElement('img');
        img.src = task.image.previewUrl;
        img.alt = '';
        thumb.appendChild(img);
      }
      row.appendChild(thumb);

      // Name
      const name = document.createElement('div');
      name.className = 'dh-queue-name';
      name.textContent = task.name || '未命名';
      row.appendChild(name);

      // Segment indicator (if segmented)
      const hasSegments = Array.isArray(task.segments) && task.segments.length > 0;
      if (hasSegments) {
        const completedSegs = task.segments.filter(s => s.status === 'completed').length;
        const segTag = document.createElement('div');
        segTag.style.cssText = 'font-size:11px;color:var(--color-info);min-width:40px;text-align:center;';
        segTag.textContent = `${completedSegs}/${task.segments.length}`;
        row.appendChild(segTag);
      }

      // Mini progress bar
      const miniBar = document.createElement('div');
      miniBar.className = 'dh-queue-mini-bar';
      const miniFill = document.createElement('div');
      miniFill.className = 'dh-queue-mini-fill';

      if (task.status === 'completed') {
        miniFill.classList.add('completed');
        miniFill.style.width = '100%';
      } else if (task.status === 'failed') {
        miniFill.classList.add('failed');
        miniFill.style.width = '100%';
      } else if (hasSegments) {
        miniFill.style.width = `${this.#computeSegmentOverallProgress(task.segments)}%`;
      } else {
        miniFill.style.width = `${task.progress || 0}%`;
      }
      miniBar.appendChild(miniFill);
      row.appendChild(miniBar);

      // Status icon
      const icon = document.createElement('div');
      icon.className = 'dh-queue-status-icon';
      icon.innerHTML = this.#statusIconSvg(task.status);
      row.appendChild(icon);

      el.appendChild(row);
    }

    return el;
  }

  // ── Section: Live Log ──────────────────────────────────────

  /**
   * @returns {HTMLElement}
   */
  #createLogSection() {
    const el = document.createElement('div');
    el.className = 'dh-monitor-log';

    // Header
    const header = document.createElement('div');
    header.className = 'dh-log-header';
    header.dataset.action = 'toggle-log';

    const title = document.createElement('span');
    title.className = 'dh-log-title';
    title.textContent = `执行日志 (${this.#logs.length})`;
    header.appendChild(title);

    const arrow = document.createElement('svg');
    arrow.className = 'dh-advanced-arrow';
    arrow.setAttribute('viewBox', '0 0 24 24');
    arrow.setAttribute('fill', 'none');
    arrow.setAttribute('stroke', 'currentColor');
    arrow.setAttribute('stroke-width', '2');
    arrow.style.cssText = 'width:14px;height:14px;';
    if (this.#logExpanded) arrow.style.transform = 'rotate(90deg)';
    arrow.innerHTML = '<polyline points="9 18 15 12 9 6"/>';
    header.appendChild(arrow);

    el.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'dh-log-body';
    body.dataset.role = 'log-body';
    body.style.display = this.#logExpanded ? 'block' : 'none';

    for (const log of this.#logs) {
      body.appendChild(this.#createLogEntry(log));
    }

    if (this.#logs.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px;color:var(--text-disabled);font-style:italic;';
      empty.textContent = '等待日志...';
      body.appendChild(empty);
    }

    el.appendChild(body);
    return el;
  }

  /**
   * @param {{time:string,msg:string,type:string}} entry
   * @returns {HTMLElement}
   */
  #createLogEntry(entry) {
    const el = document.createElement('div');
    el.className = 'dh-log-entry';
    el.innerHTML = `<span class="dh-log-time">${entry.time}</span><span class="dh-log-msg ${entry.type}">${this.#escapeHtml(entry.msg)}</span>`;
    return el;
  }

  // ── Video Result Preview (for queue row click) ─────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createVideoResult(task) {
    const el = document.createElement('div');
    el.className = 'dh-video-result';

    // Use finalOutput if available, otherwise fall back to output
    const output = task.finalOutput || task.output;

    const title = document.createElement('div');
    title.className = 'dh-video-title';
    title.textContent = `视频预览 - ${task.name || '未命名'}`;
    el.appendChild(title);

    const video = document.createElement('video');
    video.controls = true;
    video.src = output.videoUrl;
    video.preload = 'metadata';
    el.appendChild(video);

    const actions = document.createElement('div');
    actions.className = 'dh-video-actions';

    const downloadBtn = document.createElement('a');
    downloadBtn.className = 'btn btn-primary btn-sm';
    downloadBtn.textContent = '下载视频';
    downloadBtn.href = output.videoUrl;
    downloadBtn.download = output.filename || `video-${task.id}.mp4`;
    downloadBtn.target = '_blank';
    actions.appendChild(downloadBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-ghost btn-sm';
    closeBtn.textContent = '关闭预览';
    closeBtn.dataset.action = 'close-preview';
    closeBtn.addEventListener('click', () => {
      this.#previewTaskId = null;
    });
    actions.appendChild(closeBtn);

    el.appendChild(actions);
    return el;
  }

  // ── Log Management ─────────────────────────────────────────

  /**
   * Add a log entry and update the UI if visible.
   * @param {string} msg
   * @param {string} type - 'info' | 'error' | 'success'
   */
  #addLog(msg, type = 'info') {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    this.#logs.push({ time, msg, type });

    // Cap at 200 entries
    if (this.#logs.length > 200) {
      this.#logs = this.#logs.slice(-200);
    }

    // Live update: append to log body if it exists
    const body = this.#container.querySelector('[data-role="log-body"]');
    if (body) {
      // Remove empty message if present
      const empty = body.querySelector('div[style*="font-style:italic"]');
      if (empty) empty.remove();

      body.appendChild(this.#createLogEntry({ time, msg, type }));

      // Auto-scroll to bottom
      body.scrollTop = body.scrollHeight;

      // Update count in title
      const logTitle = this.#container.querySelector('.dh-log-title');
      if (logTitle) {
        logTitle.textContent = `执行日志 (${this.#logs.length})`;
      }

      // If we exceeded 200, trim DOM entries
      while (body.children.length > 200) {
        body.removeChild(body.firstChild);
      }
    }
  }

  // ── Segment Helpers ────────────────────────────────────────

  /**
   * Compute overall progress from segments (0-100).
   * @param {Array<{status:string,progress:number,durationSeconds:number}>} segments
   * @returns {number}
   */
  #computeSegmentOverallProgress(segments) {
    if (!segments || segments.length === 0) return 0;

    const totalDuration = segments.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
    if (totalDuration === 0) {
      // Fallback to equal weight per segment
      const completed = segments.filter(s => s.status === 'completed').length;
      return Math.round((completed / segments.length) * 100);
    }

    let weightedProgress = 0;
    for (const seg of segments) {
      const weight = (seg.durationSeconds || 0) / totalDuration;
      if (seg.status === 'completed') {
        weightedProgress += weight * 100;
      } else if (seg.status === 'failed') {
        weightedProgress += weight * (seg.progress || 0);
      } else {
        weightedProgress += weight * (seg.progress || 0);
      }
    }
    return Math.round(weightedProgress);
  }

  /**
   * @param {string} status
   * @returns {string} inline style for segment dot
   */
  #segmentDotStyle(status) {
    const base = 'width:8px;height:8px;border-radius:50%;flex-shrink:0;';
    switch (status) {
      case 'completed':
        return base + 'background:var(--color-success);';
      case 'running':
      case 'uploading':
        return base + 'background:var(--color-primary-light);animation:pulse 1.5s infinite;';
      case 'failed':
        return base + 'background:var(--color-error);';
      case 'pending':
      default:
        return base + 'background:var(--text-disabled);';
    }
  }

  /**
   * @param {{ status: string, progress: number }} seg
   * @returns {string} inline style for mini fill bar
   */
  #segmentFillStyle(seg) {
    const widthBase = `width:${seg.status === 'completed' ? 100 : (seg.progress || 0)}%;`;
    switch (seg.status) {
      case 'completed':
        return widthBase + 'background:var(--color-success);';
      case 'running':
      case 'uploading':
        return widthBase + 'background:var(--color-primary-light);';
      case 'failed':
        return widthBase + 'background:var(--color-error);';
      default:
        return widthBase + 'background:var(--text-disabled);';
    }
  }

  /**
   * @param {string} status
   * @returns {string} CSS color style
   */
  #segmentStatusColor(status) {
    switch (status) {
      case 'completed': return 'color:var(--color-success);';
      case 'running':
      case 'uploading': return 'color:var(--color-primary-light);';
      case 'failed': return 'color:var(--color-error);';
      default: return 'color:var(--text-disabled);';
    }
  }

  /**
   * @param {string} status
   * @param {number} progress
   * @returns {string} Human-readable status text
   */
  #segmentStatusLabel(status, progress) {
    switch (status) {
      case 'completed': return '已完成';
      case 'running': return `${Math.round(progress || 0)}%`;
      case 'uploading': return '上传中';
      case 'failed': return '失败';
      case 'pending':
      default: return '等待中';
    }
  }

  /**
   * Format seconds to M:SS display.
   * @param {number} seconds
   * @returns {string}
   */
  #formatSeconds(seconds) {
    if (seconds === undefined || seconds === null) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  // ── Helpers ────────────────────────────────────────────────

  /**
   * @param {string} status
   * @returns {string}
   */
  #statusLabel(status) {
    const map = {
      draft: '草稿',
      ready: '等待中',
      uploading: '上传中',
      queued: '排队中',
      running: '执行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
      asset_missing: '资源缺失',
    };
    return map[status] || status || '未知';
  }

  /**
   * @param {string} status
   * @returns {string}
   */
  #stageLabel(status) {
    const map = {
      queued: '排队等待中...',
      running: '正在执行...',
      completed: '执行完成',
      failed: '执行失败',
      cancelled: '已取消',
    };
    return map[status] || '准备中...';
  }

  /**
   * @param {string} status
   * @returns {string} SVG markup
   */
  #statusIconSvg(status) {
    switch (status) {
      case 'completed':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2" style="width:16px;height:16px;"><polyline points="20 6 9 17 4 12"/></svg>`;
      case 'failed':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2" style="width:16px;height:16px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      case 'running':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-primary-light)" stroke-width="2" style="width:16px;height:16px;"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
      case 'queued':
        return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
      default:
        return `<svg viewBox="0 0 24 24" fill="none" stroke="var(--text-disabled)" stroke-width="2" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/></svg>`;
    }
  }

  /**
   * @param {string} str
   * @returns {string}
   */
  #escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
