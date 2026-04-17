/**
 * ExecutionMonitor Component
 *
 * Renders the execution-mode view showing current task progress,
 * queue overview, and live log.
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

    // Click delegation for queue rows and log toggle
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
    });
  }

  /**
   * Clean up event subscriptions.
   */
  destroy() {
    if (this.#unsubscribeLog) this.#unsubscribeLog();
    if (this.#unsubscribeWs) this.#unsubscribeWs();
    this.#logs = [];
  }

  // ── Section: Current Task ──────────────────────────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createCurrentTask(task) {
    const el = document.createElement('div');
    el.className = 'dh-monitor-current';

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

    header.appendChild(info);

    // Status badge
    const badge = document.createElement('span');
    badge.className = `status-badge ${task.status || 'running'}`;
    badge.textContent = this.#statusLabel(task.status);
    header.appendChild(badge);

    el.appendChild(header);

    // Progress
    const progressRow = document.createElement('div');
    progressRow.className = 'dh-monitor-progress';

    const track = document.createElement('div');
    track.className = 'progress-bar-track';
    const fill = document.createElement('div');
    fill.className = 'progress-bar-fill';
    fill.style.width = `${task.progress || 0}%`;
    track.appendChild(fill);
    progressRow.appendChild(track);

    const text = document.createElement('div');
    text.className = 'dh-progress-text';
    text.textContent = `${Math.round(task.progress || 0)}%`;
    progressRow.appendChild(text);

    el.appendChild(progressRow);

    // Current node
    if (task.currentNode) {
      const node = document.createElement('div');
      node.className = 'dh-monitor-node';
      node.textContent = `当前节点: ${task.currentNode}`;
      el.appendChild(node);
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

  // ── Video Result Preview ───────────────────────────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createVideoResult(task) {
    const el = document.createElement('div');
    el.className = 'dh-video-result';

    const title = document.createElement('div');
    title.className = 'dh-video-title';
    title.textContent = `视频预览 - ${task.name || '未命名'}`;
    el.appendChild(title);

    const video = document.createElement('video');
    video.controls = true;
    video.src = task.output.videoUrl;
    video.preload = 'metadata';
    el.appendChild(video);

    const actions = document.createElement('div');
    actions.className = 'dh-video-actions';

    const downloadBtn = document.createElement('a');
    downloadBtn.className = 'btn btn-primary btn-sm';
    downloadBtn.textContent = '下载视频';
    downloadBtn.href = task.output.videoUrl;
    downloadBtn.download = task.output.filename || `video-${task.id}.mp4`;
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
