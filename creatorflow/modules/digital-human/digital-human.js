/**
 * DigitalHumanModule - Main Controller
 *
 * Orchestrates the digital human batch generation module.
 * Manages task state, wires up UI components, handles queue lifecycle,
 * and persists task data to storage.
 */
import {
  createTask,
  cloneTask,
  normalizeTask,
  validateTask,
  setTaskCounter,
  getTaskCounter,
} from './task-schema.js';
import { TaskList } from './task-list.js';
import { TaskEditor } from './task-editor.js';
import { ExecutionMonitor } from './execution-monitor.js';
import { TaskQueue } from '../../core/task-queue.js';
import { OrchestratorClient } from '../../core/orchestrator-client.js';

export class DigitalHumanModule {
  // ── App Context ──────────────────────────────────────────────
  #app;

  // ── State ────────────────────────────────────────────────────
  #tasks = [];
  #selectedTaskId = null;
  #isRunning = false;

  // ── Component Instances ──────────────────────────────────────
  #taskList = null;
  #taskEditor = null;
  #executionMonitor = null;
  #taskQueue = null;

  // ── DOM References ───────────────────────────────────────────
  #headerSlot = null;
  #contentSlot = null;
  #leftPanel = null;
  #rightPanel = null;

  // ── Cleanup ──────────────────────────────────────────────────
  #unsubscribers = [];
  #saveDebounceTimer = null;

  /**
   * @param {{ app: object }} opts - App context
   */
  constructor({ app }) {
    this.#app = app;
  }

  // ── Public Lifecycle ────────────────────────────────────────

  /**
   * Mount and initialize the module.
   * @param {HTMLElement} headerSlot
   * @param {HTMLElement} contentSlot
   */
  mount(headerSlot, contentSlot) {
    this.#headerSlot = headerSlot;
    this.#contentSlot = contentSlot;

    // 1. Build layout
    this.#buildLayout();

    // 2. Restore tasks from storage
    this.#restoreState();

    // 3. Create components
    this.#taskList = new TaskList({
      container: this.#leftPanel,
      eventBus: this.#app.eventBus,
    });

    this.#taskEditor = new TaskEditor({
      container: this.#rightPanel,
      eventBus: this.#app.eventBus,
      fileUploader: this.#app.fileUploader,
      comfyClient: this.#app.comfyClient,
    });

    this.#executionMonitor = new ExecutionMonitor({
      container: this.#rightPanel,
      eventBus: this.#app.eventBus,
      comfyClient: this.#app.comfyClient,
    });

    this.#taskQueue = new TaskQueue({
      client: this.#app.comfyClient,
      eventBus: this.#app.eventBus,
    });
    this.#taskQueue.setTasks(this.#tasks);

    // 4. Wire events
    this.#bindEvents();

    // 5. Bind editor/monitor events (they use delegation)
    this.#taskEditor.bindEvents();
    this.#executionMonitor.bindEvents();

    // 6. Render header
    this.#renderHeader();

    // 7. Initial render
    this.#renderAll();
  }

  /**
   * Unmount the module, cleaning up all resources.
   */
  unmount() {
    // Flush any pending save
    if (this.#saveDebounceTimer) {
      clearTimeout(this.#saveDebounceTimer);
      this.#saveDebounceTimer = null;
    }
    this.#saveNow();

    // Cleanup queue
    if (this.#taskQueue) {
      this.#taskQueue.destroy();
      this.#taskQueue = null;
    }

    // Cleanup monitor
    if (this.#executionMonitor) {
      this.#executionMonitor.destroy();
      this.#executionMonitor = null;
    }

    // Unsubscribe all events
    for (const unsub of this.#unsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.#unsubscribers = [];

    // Clear DOM
    if (this.#headerSlot) this.#headerSlot.innerHTML = '';
    if (this.#contentSlot) this.#contentSlot.innerHTML = '';

    this.#taskList = null;
    this.#taskEditor = null;
    this.#headerSlot = null;
    this.#contentSlot = null;
    this.#leftPanel = null;
    this.#rightPanel = null;
  }

  // ── Layout Construction ─────────────────────────────────────

  #buildLayout() {
    this.#contentSlot.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'dh-container';

    // Left panel
    this.#leftPanel = document.createElement('div');
    this.#leftPanel.className = 'dh-task-list-panel';

    // Right panel
    this.#rightPanel = document.createElement('div');
    this.#rightPanel.className = 'dh-task-editor-panel';

    container.appendChild(this.#leftPanel);
    container.appendChild(this.#rightPanel);
    this.#contentSlot.appendChild(container);
  }

  // ── Header Rendering ────────────────────────────────────────

  #renderHeader() {
    this.#headerSlot.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'dh-header';

    const title = document.createElement('div');
    title.className = 'dh-header-title';
    title.textContent = '数字人批量生成';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'dh-header-actions';
    actions.dataset.role = 'header-actions';

    // Action buttons depend on running state
    if (this.#isRunning) {
      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'btn btn-secondary btn-sm';
      pauseBtn.dataset.action = 'pause';
      pauseBtn.textContent = '暂停';
      actions.appendChild(pauseBtn);

      const stopBtn = document.createElement('button');
      stopBtn.className = 'btn btn-danger btn-sm';
      stopBtn.dataset.action = 'stop';
      stopBtn.textContent = '停止';
      actions.appendChild(stopBtn);
    } else {
      const hasFailed = this.#tasks.some(t => t.status === 'failed');
      const hasReady = this.#tasks.some(t => t.selected && t.status === 'ready');

      const startBtn = document.createElement('button');
      startBtn.className = 'btn btn-primary btn-sm';
      startBtn.dataset.action = 'start';
      startBtn.textContent = '开始执行';
      startBtn.disabled = !hasReady;
      actions.appendChild(startBtn);

      if (hasFailed) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-secondary btn-sm';
        retryBtn.dataset.action = 'retry-failed';
        retryBtn.textContent = '重试失败';
        actions.appendChild(retryBtn);
      }
    }

    header.appendChild(actions);
    this.#headerSlot.appendChild(header);
  }

  // ── Event Binding ───────────────────────────────────────────

  #bindEvents() {
    const bus = this.#app.eventBus;

    // Task list events
    this.#subscribe('task:create', () => this.#handleCreate());
    this.#subscribe('task:select', ({ taskId }) => this.#handleSelect(taskId));
    this.#subscribe('task:toggle-selected', ({ taskId }) => this.#handleToggleSelected(taskId));
    this.#subscribe('task:delete', ({ taskId }) => this.#handleDelete(taskId));
    this.#subscribe('task:delete-selected', () => this.#handleDeleteSelected());
    this.#subscribe('task:duplicate', ({ taskId }) => this.#handleDuplicate(taskId));
    this.#subscribe('task:reorder', ({ sourceId, targetId }) => this.#handleReorder(sourceId, targetId));
    this.#subscribe('task:update', (data) => this.#handleUpdate(data));
    this.#subscribe('task:bulk-image-import', ({ files }) => this.#handleBulkImageImport(files));
    this.#subscribe('task:select-all', () => this.#handleSelectAll());

    // Queue events
    this.#subscribe('queue:started', () => {
      this.#isRunning = true;
      this.#renderHeader();
      this.#renderRightPanel();
      this.#updateStatusBar();
    });
    this.#subscribe('queue:completed', () => {
      this.#isRunning = false;
      this.#renderHeader();
      this.#renderRightPanel();
      this.#save();
      this.#updateStatusBar();
      this.#showToast('全部任务执行完成', 'success');
    });
    this.#subscribe('queue:stopped', () => {
      this.#isRunning = false;
      this.#renderHeader();
      this.#renderRightPanel();
      this.#save();
      this.#updateStatusBar();
    });
    this.#subscribe('queue:paused', () => {
      this.#isRunning = false;
      this.#renderHeader();
      this.#renderRightPanel();
      this.#save();
      this.#updateStatusBar();
      this.#showToast('队列已暂停', 'warning');
    });
    this.#subscribe('queue:task-started', ({ taskId }) => {
      this.#renderTaskList();
      this.#renderRightPanel();
      this.#save();
    });
    this.#subscribe('queue:task-progress', ({ taskId }) => {
      // Lightweight update: only re-render right panel (monitor)
      this.#renderRightPanel();
    });
    this.#subscribe('queue:task-completed', ({ taskId }) => {
      this.#renderTaskList();
      this.#renderRightPanel();
      this.#save();
      this.#updateStatusBar();
      const task = this.#findTask(taskId);
      this.#showToast(`任务完成: ${task ? task.name : taskId}`, 'success');
    });
    this.#subscribe('queue:task-failed', ({ taskId, error }) => {
      this.#renderTaskList();
      this.#renderRightPanel();
      this.#save();
      this.#updateStatusBar();
      const task = this.#findTask(taskId);
      this.#showToast(`任务失败: ${task ? task.name : taskId} - ${error || ''}`, 'error');
    });

    // Header action buttons
    this.#headerSlot.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      switch (action) {
        case 'start':
          this.#handleStart();
          break;
        case 'pause':
          this.#handlePause();
          break;
        case 'stop':
          this.#handleStop();
          break;
        case 'retry-failed':
          this.#handleRetryFailed();
          break;
      }
    });

    // Orchestrator events (segment progress)
    if (this.#app.orchestratorClient) {
      this.#subscribe('orchestrator:job.failed', ({ jobId, error }) => {
        const task = this.#tasks.find(t => t._orchJobId === jobId);
        if (task) {
          task.status = 'failed';
          task.error = error;
          this.#isRunning = false;
          this.#renderAll();
          this.#renderHeader();
          this.#save();
          this.#showToast(`任务失败: ${task.name}`, 'error');
        }
      });

      this.#subscribe('orchestrator:job.completed', ({ jobId, finalVideoPath, totalDuration }) => {
        const task = this.#tasks.find(t => t._orchJobId === jobId);
        if (task) {
          task.status = 'completed';
          task.progress = 100;
          task.progressLabel = '完成';
          task.finalOutput = {
            localPath: finalVideoPath,
            duration: totalDuration,
          };
          this.#isRunning = false;
          this.#renderAll();
          this.#renderHeader();
          this.#save();
          this.#showToast(`任务完成: ${task.name}`, 'success');
        }
      });

      this.#subscribe('orchestrator:segment.started', ({ jobId, index }) => {
        const task = this.#tasks.find(t => t._orchJobId === jobId);
        if (task) {
          task.progressLabel = `分段 ${index + 1} 执行中...`;
          this.#renderRightPanel();
        }
      });

      this.#subscribe('orchestrator:segment.completed', ({ jobId, index }) => {
        const task = this.#tasks.find(t => t._orchJobId === jobId);
        if (task) {
          task.progressLabel = `分段 ${index + 1} 完成`;
          this.#renderRightPanel();
        }
      });

      this.#subscribe('orchestrator:job.concatenating', ({ jobId }) => {
        const task = this.#tasks.find(t => t._orchJobId === jobId);
        if (task) {
          task.progressLabel = '正在拼接视频...';
          this.#renderRightPanel();
        }
      });
    }
  }

  /**
   * Helper to subscribe and track for cleanup.
   * @param {string} event
   * @param {Function} handler
   */
  #subscribe(event, handler) {
    const unsub = this.#app.eventBus.on(event, handler);
    this.#unsubscribers.push(unsub);
  }

  // ── Event Handlers ──────────────────────────────────────────

  #handleCreate() {
    if (this.#isRunning) return;
    const task = createTask();
    this.#tasks.push(task);
    this.#selectedTaskId = task.id;
    validateTask(task);
    this.#renderAll();
    this.#save();
  }

  #handleSelect(taskId) {
    if (this.#isRunning) return;
    if (this.#selectedTaskId === taskId) return;
    this.#selectedTaskId = taskId;
    this.#renderTaskList();
    this.#renderRightPanel();
    this.#saveSelection();
  }

  #handleToggleSelected(taskId) {
    const task = this.#findTask(taskId);
    if (!task) return;
    task.selected = !task.selected;
    validateTask(task);
    this.#renderTaskList();
    this.#save();
  }

  #handleDelete(taskId) {
    if (this.#isRunning) return;
    const idx = this.#tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;
    this.#tasks.splice(idx, 1);
    if (this.#selectedTaskId === taskId) {
      this.#selectedTaskId = this.#tasks.length > 0 ? this.#tasks[0].id : null;
    }
    this.#renderAll();
    this.#save();
  }

  #handleDeleteSelected() {
    if (this.#isRunning) return;
    const toDelete = this.#tasks.filter(t => t.selected);
    if (toDelete.length === 0) return;
    const deleteIds = new Set(toDelete.map(t => t.id));
    this.#tasks = this.#tasks.filter(t => !deleteIds.has(t.id));
    if (deleteIds.has(this.#selectedTaskId)) {
      this.#selectedTaskId = this.#tasks.length > 0 ? this.#tasks[0].id : null;
    }
    this.#renderAll();
    this.#save();
  }

  #handleDuplicate(taskId) {
    if (this.#isRunning) return;
    const task = this.#findTask(taskId);
    if (!task) return;
    const dup = cloneTask(task);
    const idx = this.#tasks.findIndex(t => t.id === taskId);
    // Insert after the original
    this.#tasks.splice(idx + 1, 0, dup);
    validateTask(dup);
    this.#selectedTaskId = dup.id;
    this.#renderAll();
    this.#save();
  }

  #handleReorder(sourceId, targetId) {
    const srcIdx = this.#tasks.findIndex(t => t.id === sourceId);
    const tgtIdx = this.#tasks.findIndex(t => t.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const [moved] = this.#tasks.splice(srcIdx, 1);
    // Recalculate target index after splice
    const newTgtIdx = this.#tasks.findIndex(t => t.id === targetId);
    this.#tasks.splice(newTgtIdx, 0, moved);

    this.#renderTaskList();
    this.#save();
  }

  #handleUpdate(data) {
    const task = this.#findTask(data.taskId);
    if (!task) return;

    if (data.field) {
      // Single field update
      task[data.field] = data.value;
    } else if (data.updates) {
      // Batch updates (e.g. image/audio upload results)
      for (const [key, value] of Object.entries(data.updates)) {
        if (typeof value === 'object' && value !== null && task[key] && typeof task[key] === 'object') {
          // Merge into nested object (e.g. task.image = {...task.image, ...value})
          task[key] = { ...task[key], ...value };
        } else {
          task[key] = value;
        }
      }
    }

    validateTask(task);

    // Re-render editor if this task is currently selected
    if (this.#selectedTaskId === data.taskId && !this.#isRunning) {
      this.#taskEditor.render(task, false);
    }
    // Update task list to reflect status changes
    this.#renderTaskList();
    // Re-render header to update start button enabled/disabled state
    this.#renderHeader();
    this.#save();
  }

  async #handleBulkImageImport(files) {
    if (this.#isRunning) return;

    for (const file of files) {
      const task = createTask();
      task.name = file.name.replace(/\.[^.]+$/, '');
      this.#tasks.push(task);
      validateTask(task);

      // Start image upload in background
      this.#uploadImageForTask(task, file);
    }

    // Select the first newly created task
    if (!this.#selectedTaskId && this.#tasks.length > 0) {
      this.#selectedTaskId = this.#tasks[0].id;
    }

    this.#renderAll();
    this.#save();
  }

  /**
   * Upload an image for a specific task (async, non-blocking).
   * @param {object} task
   * @param {File} file
   */
  async #uploadImageForTask(task, file) {
    task.image = {
      ...task.image,
      uploadState: 'uploading',
      originalName: file.name,
      size: file.size,
    };

    try {
      const previewUrl = URL.createObjectURL(file);
      const result = await this.#app.fileUploader.uploadAsset(file, { kind: 'image' });

      let width = null;
      let height = null;
      try {
        const dims = await this.#parseImageDims(previewUrl);
        width = dims.width;
        height = dims.height;
      } catch { /* ignore dimension parsing failure */ }

      task.image = {
        ...task.image,
        uploadState: 'uploaded',
        uploadedName: result.name,
        originalName: result.originalName,
        previewUrl: previewUrl,
        size: file.size,
        width,
        height,
      };

      validateTask(task);
    } catch (err) {
      console.error(`[DigitalHuman] Bulk import upload failed for ${file.name}:`, err);
      task.image = { ...task.image, uploadState: 'failed' };
    }

    // Re-render to reflect upload state change
    this.#renderAll();
    this.#save();
  }

  /**
   * Parse image dimensions from a blob URL.
   * @param {string} url
   * @returns {Promise<{width:number,height:number}>}
   */
  #parseImageDims(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = url;
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('Failed to load image'));
      setTimeout(() => reject(new Error('Timeout')), 5000);
    });
  }

  #handleSelectAll() {
    if (this.#isRunning) return;
    const allSelected = this.#tasks.every(t => t.selected);
    const newState = !allSelected;
    for (const task of this.#tasks) {
      task.selected = newState;
      validateTask(task);
    }
    this.#renderAll();
    this.#save();
  }

  async #handleStart() {
    const execMode = this.#app.storage?.get('settings', {}).executionMode || 'orchestrated';
    const orchClient = this.#app.orchestratorClient;

    if (execMode === 'orchestrated' && orchClient) {
      await this.#handleStartOrchestrated(orchClient);
    } else {
      await this.#handleStartDirect();
    }
  }

  async #handleStartDirect() {
    // Validate all selected tasks
    const selectedTasks = this.#tasks.filter(t => t.selected);
    const invalidTasks = selectedTasks.filter(t => {
      validateTask(t);
      return !t.validation.valid;
    });

    if (selectedTasks.length === 0) {
      this.#showToast('没有已选中的任务', 'warning');
      return;
    }

    if (invalidTasks.length > 0) {
      this.#showToast(`${invalidTasks.length} 项任务校验未通过，请检查`, 'warning');
      this.#renderAll();
      return;
    }

    for (const task of selectedTasks) {
      if (task.status === 'draft') validateTask(task);
    }

    this.#renderTaskList();
    this.#taskQueue.setTasks(this.#tasks);
    try {
      await this.#taskQueue.start();
    } catch (err) {
      console.error('[DigitalHuman] Queue start error:', err);
      this.#showToast(`执行失败: ${err.message}`, 'error');
    }
  }

  async #handleStartOrchestrated(orchClient) {
    const selectedTasks = this.#tasks.filter(t => t.selected && t.validation.valid);
    if (selectedTasks.length === 0) {
      this.#showToast('没有已选中的有效任务', 'warning');
      return;
    }

    // Submit each selected task to the orchestrator
    for (const task of selectedTasks) {
      try {
        task.status = 'uploading';
        task.progress = 0;
        task.progressLabel = '提交中...';
        this.#renderTaskList();
        this.#renderRightPanel();

        // Build form data
        const formData = new FormData();
        formData.append('name', task.name);
        formData.append('prompt', task.prompt);
        formData.append('seed', task.seed);
        formData.append('fps', task.fps);
        formData.append('max_resolution', task.maxResolution);
        formData.append('segment_mode', task.segmentMode || 'auto');
        formData.append('max_segment_duration', task.maxSegmentDuration || 8);

        // Attach image file if available
        if (task.image?.file) {
          formData.append('image', task.image.file);
        } else if (task.image?.previewUrl) {
          // Fetch blob URL and attach
          try {
            const resp = await fetch(task.image.previewUrl);
            const blob = await resp.blob();
            const file = new File([blob], task.image.originalName || 'image.jpg', { type: blob.type });
            formData.append('image', file);
          } catch { /* skip */ }
        }

        // Attach audio file if available
        if (task.audio?.file) {
          formData.append('audio', task.audio.file);
        } else if (task.audio?.previewUrl) {
          try {
            const resp = await fetch(task.audio.previewUrl);
            const blob = await resp.blob();
            const file = new File([blob], task.audio.originalName || 'audio.mp3', { type: blob.type });
            formData.append('audio', file);
          } catch { /* skip */ }
        }

        // Submit to orchestrator
        const result = await orchClient.createJob(formData);
        task._orchJobId = result.jobId;
        task.status = 'queued';
        task.progressLabel = '已入队';

        // Start execution
        await orchClient.startJob(result.jobId);
        task.status = 'running';
        task.progressLabel = '执行中...';

        this.#showToast(`任务已提交: ${task.name}`, 'success');
      } catch (err) {
        console.error('[DigitalHuman] Orchestrator submit error:', err);
        task.status = 'failed';
        task.error = err.message;
        this.#showToast(`提交失败: ${task.name} - ${err.message}`, 'error');
      }
    }

    // Switch to running mode
    this.#isRunning = true;
    this.#renderHeader();
    this.#renderRightPanel();
    this.#save();
  }

  #handlePause() {
    this.#taskQueue.pause();
  }

  async #handleStop() {
    await this.#taskQueue.stop();
  }

  #handleRetryFailed() {
    const count = this.#taskQueue.retryFailed();
    if (count > 0) {
      this.#showToast(`已重置 ${count} 项失败任务`, 'info');
      this.#renderAll();
      this.#save();
      this.#renderHeader(); // Update start button state
    } else {
      this.#showToast('没有失败的任务需要重试', 'info');
    }
  }

  // ── Rendering ───────────────────────────────────────────────

  /**
   * Render all UI components.
   */
  #renderAll() {
    this.#renderTaskList();
    this.#renderRightPanel();
  }

  /**
   * Re-render the task list component.
   */
  #renderTaskList() {
    if (this.#taskList) {
      this.#taskList.render(this.#tasks, this.#selectedTaskId);
    }
  }

  /**
   * Re-render the right panel based on current state.
   */
  #renderRightPanel() {
    if (!this.#rightPanel) return;

    if (this.#isRunning) {
      // Show execution monitor
      this.#rightPanel.className = 'dh-right-panel';
      this.#executionMonitor.render(this.#tasks, {}, this.#getCurrentTaskIndex());
    } else if (this.#selectedTaskId) {
      // Show task editor
      const task = this.#findTask(this.#selectedTaskId);
      if (task) {
        this.#rightPanel.className = 'dh-task-editor-panel';
        this.#taskEditor.render(task, false);
      } else {
        this.#selectedTaskId = null;
        this.#renderEmptyState();
      }
    } else {
      this.#renderEmptyState();
    }
  }

  /**
   * Show the empty state in the right panel.
   */
  #renderEmptyState() {
    if (!this.#rightPanel) return;
    this.#rightPanel.className = 'dh-task-editor-panel dh-empty-state';
    this.#rightPanel.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <div class="empty-title">选择或创建一个任务</div>
        <div class="empty-desc">从左侧列表选择任务进行编辑，或拖入图片批量创建</div>
      </div>
    `;
  }

  /**
   * Get the index of the currently executing task in the tasks array.
   * @returns {number} -1 if no task is currently running
   */
  #getCurrentTaskIndex() {
    if (!this.#taskQueue || !this.#taskQueue.isRunning) return -1;
    // Find the first running task
    const idx = this.#tasks.findIndex(t => t.status === 'running');
    return idx;
  }

  // ── Persistence ─────────────────────────────────────────────

  /**
   * Debounced save - waits 300ms of inactivity before persisting.
   */
  #save() {
    if (this.#saveDebounceTimer) {
      clearTimeout(this.#saveDebounceTimer);
    }
    this.#saveDebounceTimer = setTimeout(() => {
      this.#saveNow();
    }, 300);
  }

  /**
   * Immediately persist tasks and selection to storage.
   */
  #saveNow() {
    if (!this.#app.storage) return;

    try {
      // Update task counter
      setTaskCounter(getTaskCounter());

      // Serialize tasks (strip non-persistable fields)
      const serialized = this.#tasks.map(t => ({
        id: t.id,
        name: t.name,
        selected: t.selected,
        status: t.status,
        validation: t.validation,
        image: {
          originalName: t.image?.originalName ?? null,
          uploadedName: t.image?.uploadedName ?? null,
          // Note: previewUrl is a blob URL, not persistable
          previewUrl: null,
          size: t.image?.size ?? null,
          width: t.image?.width ?? null,
          height: t.image?.height ?? null,
          uploadState: t.image?.uploadedName ? 'idle' : 'idle',
        },
        audio: {
          originalName: t.audio?.originalName ?? null,
          uploadedName: t.audio?.uploadedName ?? null,
          previewUrl: null,
          size: t.audio?.size ?? null,
          duration: t.audio?.duration ?? null,
          uploadState: t.audio?.uploadedName ? 'idle' : 'idle',
        },
        prompt: t.prompt,
        seed: t.seed,
        duration: t.duration,
        fps: t.fps,
        maxResolution: t.maxResolution,
        promptId: null,
        progress: 0,
        progressLabel: '',
        currentNode: null,
        error: null,
        output: { filename: null, subfolder: null, type: null, videoUrl: null },
        createdAt: t.createdAt,
        startedAt: null,
        completedAt: null,
      }));

      this.#app.storage.set('dh-tasks', serialized);
      this.#app.storage.set('dh-taskCounter', getTaskCounter());
      this.#saveSelection();
    } catch (err) {
      console.error('[DigitalHuman] Save failed:', err);
    }
  }

  /**
   * Persist only the selected task ID.
   */
  #saveSelection() {
    if (this.#app.storage) {
      this.#app.storage.set('dh-selectedTaskId', this.#selectedTaskId);
    }
  }

  /**
   * Restore tasks and selection from storage.
   */
  #restoreState() {
    const storage = this.#app.storage;
    if (!storage) return;

    // Restore task counter
    const savedCounter = storage.get('dh-taskCounter', 0);
    setTaskCounter(savedCounter);

    // Restore tasks
    const savedTasks = storage.get('dh-tasks', []);
    if (Array.isArray(savedTasks) && savedTasks.length > 0) {
      this.#tasks = savedTasks.map(t => {
        const normalized = normalizeTask(t);
        validateTask(normalized);
        return normalized;
      });
    }

    // Restore selection
    const savedSelectedId = storage.get('dh-selectedTaskId', null);
    if (savedSelectedId && this.#findTask(savedSelectedId)) {
      this.#selectedTaskId = savedSelectedId;
    } else if (this.#tasks.length > 0) {
      this.#selectedTaskId = this.#tasks[0].id;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  /**
   * Find a task by ID.
   * @param {string} taskId
   * @returns {object|undefined}
   */
  #findTask(taskId) {
    return this.#tasks.find(t => t.id === taskId);
  }

  /**
   * Show a toast notification via the app context.
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} type
   */
  #showToast(message, type = 'info') {
    if (this.#app.showToast) {
      this.#app.showToast(message, type);
    } else if (typeof window.__cf !== 'undefined' && window.__cf.showToast) {
      window.__cf.showToast(message, type);
    }
  }

  /**
   * Update the global status bar with current queue progress.
   */
  #updateStatusBar() {
    const running = this.#tasks.filter(t => t.status === 'running').length;
    const total = this.#tasks.filter(t => t.selected && ['ready', 'running', 'completed', 'failed'].includes(t.status)).length;
    this.#app.eventBus.emit('app:statusbar-update', {
      queueRunning: running,
      queueTotal: total,
    });
  }
}
