/**
 * TaskEditor Component
 *
 * Renders the right-side editor panel for a single task.
 * Handles image/audio upload, prompt editing, and advanced settings.
 */
import { validateTask } from './task-schema.js';

export class TaskEditor {
  /** @type {HTMLElement} */
  #container;
  /** @type {import('../../core/event-bus.js').EventBus} */
  #eventBus;
  /** @type {import('../../core/file-uploader.js').FileUploader} */
  #fileUploader;
  /** @type {import('../../core/comfyui-client.js').ComfyUIClient} */
  #comfyClient;
  /** @type {boolean} */
  #advancedExpanded = false;
  /** @type {string|null} */
  #currentTaskId = null;
  /** @type {boolean} */
  #isReadOnly = false;

  // Upload abort controllers
  #imageAbort = null;
  #audioAbort = null;

  /**
   * @param {{ container: HTMLElement, eventBus: import('../../core/event-bus.js').EventBus, fileUploader: import('../../core/file-uploader.js').FileUploader, comfyClient: import('../../core/comfyui-client.js').ComfyUIClient }} opts
   */
  constructor({ container, eventBus, fileUploader, comfyClient }) {
    this.#container = container;
    this.#eventBus = eventBus;
    this.#fileUploader = fileUploader;
    this.#comfyClient = comfyClient;
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Render the editor for a specific task.
   * @param {object} task - Task object to edit
   * @param {boolean} [isReadOnly=false] - Whether the editor is read-only
   */
  render(task, isReadOnly = false) {
    this.#currentTaskId = task.id;
    this.#isReadOnly = isReadOnly;
    this.#container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'dh-editor-wrapper';

    // Section 1: Task name
    wrapper.appendChild(this.#createNameSection(task));

    // Section 2: Image upload
    wrapper.appendChild(this.#createImageSection(task));

    // Section 3: Audio upload
    wrapper.appendChild(this.#createAudioSection(task));

    // Section 4: Prompt
    wrapper.appendChild(this.#createPromptSection(task));

    // Section 5: Advanced settings
    wrapper.appendChild(this.#createAdvancedSection(task));

    this.#container.appendChild(wrapper);
  }

  // ── Section: Task Name ─────────────────────────────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createNameSection(task) {
    const section = document.createElement('div');
    section.className = 'dh-section';

    const title = document.createElement('div');
    title.className = 'dh-section-title';
    title.textContent = '任务名称';
    section.appendChild(title);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input-field';
    input.value = task.name || '';
    input.placeholder = '输入任务名称';
    input.disabled = this.#isReadOnly;
    input.dataset.field = 'name';
    row.appendChild(input);

    // Status indicator
    const badge = document.createElement('span');
    badge.className = `status-badge ${task.status || 'draft'}`;
    badge.textContent = this.#statusLabel(task.status);
    badge.style.flexShrink = '0';
    row.appendChild(badge);

    section.appendChild(row);
    return section;
  }

  // ── Section: Image Upload ──────────────────────────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createImageSection(task) {
    const section = document.createElement('div');
    section.className = 'dh-section';

    const title = document.createElement('div');
    title.className = 'dh-section-title';
    title.textContent = '参考图片';
    section.appendChild(title);

    const img = task.image || {};
    const uploadState = img.uploadState || 'idle';

    if (uploadState === 'uploaded' && img.previewUrl) {
      // Show preview
      const preview = document.createElement('div');
      preview.className = 'dh-upload-preview';

      const thumb = document.createElement('div');
      thumb.className = 'dh-upload-thumb';
      const imgEl = document.createElement('img');
      imgEl.src = img.previewUrl;
      imgEl.alt = img.originalName || '';
      thumb.appendChild(imgEl);
      preview.appendChild(thumb);

      const info = document.createElement('div');
      info.className = 'dh-upload-info';

      const fname = document.createElement('div');
      fname.className = 'dh-upload-filename';
      fname.textContent = img.originalName || '已上传';
      info.appendChild(fname);

      if (img.size) {
        const meta = document.createElement('div');
        meta.className = 'dh-upload-meta';
        meta.textContent = this.#formatFileSize(img.size);
        if (img.width && img.height) {
          meta.textContent += ` / ${img.width}x${img.height}`;
        }
        info.appendChild(meta);
      }

      if (!this.#isReadOnly) {
        const actions = document.createElement('div');
        actions.className = 'dh-upload-actions';
        const reBtn = document.createElement('button');
        reBtn.className = 'btn btn-secondary btn-sm';
        reBtn.textContent = '重新上传';
        reBtn.dataset.uploadAction = 'reupload-image';
        actions.appendChild(reBtn);
        info.appendChild(actions);
      }

      preview.appendChild(info);
      section.appendChild(preview);

      // Hidden file input for re-upload
      if (!this.#isReadOnly) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.dataset.uploadTarget = 'image';
        section.appendChild(fileInput);
      }
    } else if (uploadState === 'uploading') {
      // Uploading state
      const progress = document.createElement('div');
      progress.className = 'dh-upload-preview';
      progress.innerHTML = `
        <div class="dh-upload-thumb">
          <div class="spinner"></div>
        </div>
        <div class="dh-upload-info">
          <div class="dh-upload-filename">上传中...</div>
        </div>
      `;
      section.appendChild(progress);
    } else {
      // Upload zone (idle or failed)
      const zone = document.createElement('div');
      zone.className = 'upload-zone';
      if (uploadState === 'failed') {
        zone.style.borderColor = 'var(--color-error)';
      }

      zone.innerHTML = `
        <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="M21 15l-5-5L5 21"/>
        </svg>
        <div class="upload-text">${uploadState === 'failed' ? '上传失败，点击重试' : '点击或拖放上传参考图片'}</div>
        <div class="upload-hint">支持 JPG、PNG、WebP</div>
      `;
      zone.dataset.uploadAction = 'zone-image';

      if (!this.#isReadOnly) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        fileInput.dataset.uploadTarget = 'image';
        section.appendChild(fileInput);
      }

      section.appendChild(zone);
    }

    // Validation error
    const vError = this.#getFieldError(task, 'image');
    if (vError) {
      const errEl = document.createElement('div');
      errEl.className = 'dh-section-error';
      errEl.textContent = vError;
      section.appendChild(errEl);
    }

    return section;
  }

  // ── Section: Audio Upload ──────────────────────────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createAudioSection(task) {
    const section = document.createElement('div');
    section.className = 'dh-section';

    const title = document.createElement('div');
    title.className = 'dh-section-title';
    title.textContent = '音频文件';
    section.appendChild(title);

    const audio = task.audio || {};
    const uploadState = audio.uploadState || 'idle';

    if (uploadState === 'uploaded' && audio.previewUrl) {
      const preview = document.createElement('div');
      preview.className = 'dh-upload-preview';

      // Audio icon instead of thumbnail
      const thumb = document.createElement('div');
      thumb.className = 'dh-upload-thumb';
      thumb.innerHTML = `<svg style="width:40px;height:40px;color:var(--text-secondary);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
      preview.appendChild(thumb);

      const info = document.createElement('div');
      info.className = 'dh-upload-info';

      const fname = document.createElement('div');
      fname.className = 'dh-upload-filename';
      fname.textContent = audio.originalName || '已上传';
      info.appendChild(fname);

      const meta = document.createElement('div');
      meta.className = 'dh-upload-meta';
      let metaText = '';
      if (audio.size) metaText += this.#formatFileSize(audio.size);
      if (audio.duration) metaText += ` / ${audio.duration.toFixed(1)}s`;
      meta.textContent = metaText || '音频已上传';
      info.appendChild(meta);

      // Audio player
      const player = document.createElement('div');
      player.className = 'dh-audio-player';
      const audioEl = document.createElement('audio');
      audioEl.controls = true;
      audioEl.preload = 'metadata';
      audioEl.src = audio.previewUrl;
      player.appendChild(audioEl);
      info.appendChild(player);

      if (!this.#isReadOnly) {
        const actions = document.createElement('div');
        actions.className = 'dh-upload-actions';
        const reBtn = document.createElement('button');
        reBtn.className = 'btn btn-secondary btn-sm';
        reBtn.textContent = '重新上传';
        reBtn.dataset.uploadAction = 'reupload-audio';
        actions.appendChild(reBtn);
        info.appendChild(actions);
      }

      preview.appendChild(info);
      section.appendChild(preview);

      // Hidden file input for re-upload
      if (!this.#isReadOnly) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*';
        fileInput.style.display = 'none';
        fileInput.dataset.uploadTarget = 'audio';
        section.appendChild(fileInput);
      }
    } else if (uploadState === 'uploading') {
      const progress = document.createElement('div');
      progress.className = 'dh-upload-preview';
      progress.innerHTML = `
        <div class="dh-upload-thumb">
          <div class="spinner"></div>
        </div>
        <div class="dh-upload-info">
          <div class="dh-upload-filename">上传中...</div>
        </div>
      `;
      section.appendChild(progress);
    } else {
      const zone = document.createElement('div');
      zone.className = 'upload-zone';
      if (uploadState === 'failed') {
        zone.style.borderColor = 'var(--color-error)';
      }

      zone.innerHTML = `
        <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
        <div class="upload-text">${uploadState === 'failed' ? '上传失败，点击重试' : '点击或拖放上传音频文件'}</div>
        <div class="upload-hint">支持 MP3、WAV、OGG</div>
      `;
      zone.dataset.uploadAction = 'zone-audio';

      if (!this.#isReadOnly) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*';
        fileInput.style.display = 'none';
        fileInput.dataset.uploadTarget = 'audio';
        section.appendChild(fileInput);
      }

      section.appendChild(zone);
    }

    // Validation error
    const vError = this.#getFieldError(task, 'audio');
    if (vError) {
      const errEl = document.createElement('div');
      errEl.className = 'dh-section-error';
      errEl.textContent = vError;
      section.appendChild(errEl);
    }

    return section;
  }

  // ── Section: Prompt ────────────────────────────────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createPromptSection(task) {
    const section = document.createElement('div');
    section.className = 'dh-section';

    const title = document.createElement('div');
    title.className = 'dh-section-title';
    title.textContent = '提示词';
    section.appendChild(title);

    const textarea = document.createElement('textarea');
    textarea.className = 'input-field';
    textarea.rows = 4;
    textarea.value = task.prompt || '';
    textarea.placeholder = '输入提示词描述...';
    textarea.disabled = this.#isReadOnly;
    textarea.dataset.field = 'prompt';
    section.appendChild(textarea);

    // Character count
    const count = document.createElement('div');
    count.style.cssText = 'text-align:right;font-size:11px;color:var(--text-disabled);margin-top:4px;';
    count.textContent = `${(task.prompt || '').length} 字`;
    count.dataset.role = 'char-count';
    section.appendChild(count);

    // Validation error
    const vError = this.#getFieldError(task, 'prompt');
    if (vError) {
      const errEl = document.createElement('div');
      errEl.className = 'dh-section-error';
      errEl.textContent = vError;
      section.appendChild(errEl);
    }

    return section;
  }

  // ── Section: Advanced Settings ─────────────────────────────

  /**
   * @param {object} task
   * @returns {HTMLElement}
   */
  #createAdvancedSection(task) {
    const section = document.createElement('div');
    section.className = 'dh-section';

    const wrapper = document.createElement('div');
    wrapper.className = 'dh-advanced-settings';

    // Header
    const header = document.createElement('div');
    header.className = 'dh-advanced-header' + (this.#advancedExpanded ? ' expanded' : '');
    header.dataset.action = 'toggle-advanced';
    header.innerHTML = `
      <svg class="dh-advanced-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      高级设置
    `;
    wrapper.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'dh-advanced-body';
    body.style.display = this.#advancedExpanded ? 'flex' : 'none';
    body.dataset.role = 'advanced-body';

    // Seed
    body.appendChild(this.#createFieldRow('Seed', this.#createSeedControl(task.seed)));
    // Duration
    body.appendChild(this.#createFieldRow('时长 (秒)', this.#createDurationControl(task.duration)));
    // FPS
    body.appendChild(this.#createFieldRow('FPS', this.#createFpsControl(task.fps)));
    // Max Resolution
    body.appendChild(this.#createFieldRow('最大分辨率', this.#createResolutionControl(task.maxResolution)));

    wrapper.appendChild(body);
    section.appendChild(wrapper);

    return section;
  }

  /**
   * @param {string} label
   * @param {HTMLElement} control
   * @returns {HTMLElement}
   */
  #createFieldRow(label, control) {
    const row = document.createElement('div');
    row.className = 'dh-field-row';

    const lbl = document.createElement('div');
    lbl.className = 'dh-field-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const ctrl = document.createElement('div');
    ctrl.className = 'dh-field-control';
    ctrl.appendChild(control);
    row.appendChild(ctrl);

    return row;
  }

  /**
   * @param {number} value
   * @returns {HTMLElement}
   */
  #createSeedControl(value) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'input-field';
    input.value = value ?? 42;
    input.dataset.field = 'seed';
    input.disabled = this.#isReadOnly;
    input.style.flex = '1';
    wrapper.appendChild(input);

    const randBtn = document.createElement('button');
    randBtn.className = 'btn btn-ghost btn-sm';
    randBtn.textContent = '随机';
    randBtn.dataset.action = 'random-seed';
    randBtn.disabled = this.#isReadOnly;
    wrapper.appendChild(randBtn);

    return wrapper;
  }

  /**
   * @param {number} value
   * @returns {HTMLElement}
   */
  #createDurationControl(value) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;';

    const range = document.createElement('input');
    range.type = 'range';
    range.min = '1';
    range.max = '10';
    range.step = '1';
    range.value = value ?? 6;
    range.dataset.field = 'duration-range';
    range.disabled = this.#isReadOnly;
    range.style.flex = '1';
    wrapper.appendChild(range);

    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'input-field';
    num.min = '1';
    num.max = '10';
    num.step = '1';
    num.value = value ?? 6;
    num.dataset.field = 'duration';
    num.disabled = this.#isReadOnly;
    num.style.width = '56px';
    num.style.textAlign = 'center';
    wrapper.appendChild(num);

    return wrapper;
  }

  /**
   * @param {number} value
   * @returns {HTMLElement}
   */
  #createFpsControl(value) {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'input-field';
    input.min = '1';
    input.max = '60';
    input.value = value ?? 30;
    input.dataset.field = 'fps';
    input.disabled = this.#isReadOnly;
    input.style.width = '80px';
    return input;
  }

  /**
   * @param {number} value
   * @returns {HTMLElement}
   */
  #createResolutionControl(value) {
    const select = document.createElement('select');
    select.className = 'input-field';
    select.dataset.field = 'maxResolution';
    select.disabled = this.#isReadOnly;

    for (const opt of [768, 1024, 1280]) {
      const option = document.createElement('option');
      option.value = String(opt);
      option.textContent = `${opt}px`;
      if (Number(value) === opt) option.selected = true;
      select.appendChild(option);
    }

    return select;
  }

  // ── Event Delegation ───────────────────────────────────────

  /**
   * Wire up all interactive events using delegation on the container.
   * Called once by the controller after construction.
   */
  bindEvents() {
    // Input/change events for field editing
    this.#container.addEventListener('input', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const field = target.dataset.field;
      if (!field || !this.#currentTaskId) return;

      let value = target.value;

      // Sync duration range <-> number
      if (field === 'duration-range') {
        const numInput = this.#container.querySelector('[data-field="duration"]');
        if (numInput) numInput.value = value;
        this.#emitFieldUpdate('duration', Number(value));
        return;
      }

      // Type coercion
      if (['seed', 'duration', 'fps', 'maxResolution'].includes(field)) {
        value = Number(value);
      }

      this.#emitFieldUpdate(field, value);

      // Update char count for prompt
      if (field === 'prompt') {
        const counter = this.#container.querySelector('[data-role="char-count"]');
        if (counter) counter.textContent = `${String(value).length} 字`;
      }
    });

    this.#container.addEventListener('change', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const field = target.dataset.field;
      if (!field || !this.#currentTaskId) return;

      let value = target.value;
      if (['seed', 'duration', 'fps', 'maxResolution'].includes(field)) {
        value = Number(value);
      }

      this.#emitFieldUpdate(field, value);
    });

    // Click delegation
    this.#container.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const action = target.closest('[data-action]');
      if (!action) {
        // Check for upload zone click
        const zone = target.closest('[data-upload-action]');
        if (zone) {
          const act = zone.dataset.uploadAction;
          if (act === 'zone-image' || act === 'reupload-image') {
            const input = this.#container.querySelector('[data-upload-target="image"]');
            if (input) input.click();
          } else if (act === 'zone-audio' || act === 'reupload-audio') {
            const input = this.#container.querySelector('[data-upload-target="audio"]');
            if (input) input.click();
          }
        }
        return;
      }

      const act = action.dataset.action;

      if (act === 'toggle-advanced') {
        this.#advancedExpanded = !this.#advancedExpanded;
        const body = this.#container.querySelector('[data-role="advanced-body"]');
        const header = this.#container.querySelector('.dh-advanced-header');
        if (body) body.style.display = this.#advancedExpanded ? 'flex' : 'none';
        if (header) header.classList.toggle('expanded', this.#advancedExpanded);
        return;
      }

      if (act === 'random-seed') {
        const seed = Math.random() * 2147483647 | 0;
        const input = this.#container.querySelector('[data-field="seed"]');
        if (input) input.value = seed;
        this.#emitFieldUpdate('seed', seed);
        return;
      }
    });

    // File input change (upload)
    this.#container.addEventListener('change', async (e) => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      if (!target.dataset.uploadTarget) return;
      if (!target.files || target.files.length === 0) return;

      const kind = target.dataset.uploadTarget; // 'image' or 'audio'
      const file = target.files[0];
      target.value = ''; // Reset for re-upload

      await this.#handleUpload(kind, file);
    });

    // Drag & drop on upload zones
    this.#container.addEventListener('dragover', (e) => {
      const zone = /** @type {HTMLElement} */ (e.target).closest('.upload-zone');
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      zone.classList.add('drag-over');
    });

    this.#container.addEventListener('dragleave', (e) => {
      const zone = /** @type {HTMLElement} */ (e.target).closest('.upload-zone');
      if (zone) zone.classList.remove('drag-over');
    });

    this.#container.addEventListener('drop', async (e) => {
      const zone = /** @type {HTMLElement} */ (e.target).closest('.upload-zone');
      if (!zone) return;
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drag-over');

      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      const file = e.dataTransfer.files[0];

      // Determine kind from which zone
      const act = zone.dataset.uploadAction || '';
      const kind = act.includes('audio') ? 'audio' : 'image';
      await this.#handleUpload(kind, file);
    });
  }

  // ── Upload Handler ─────────────────────────────────────────

  /**
   * @param {string} kind - 'image' or 'audio'
   * @param {File} file
   */
  async #handleUpload(kind, file) {
    if (!this.#currentTaskId) return;

    // Capture taskId at the start to avoid re-render race condition
    const taskId = this.#currentTaskId;

    // Check ComfyUI connection before uploading
    if (!this.#comfyClient || !this.#comfyClient.isConnected) {
      console.error(`[TaskEditor] Cannot upload ${kind}: ComfyUI not connected`);
      this.#eventBus.emit('task:update', {
        taskId,
        updates: {
          [kind]: {
            uploadState: 'failed',
          },
        },
      });
      this.#showToast('上传失败：ComfyUI 未连接，请检查服务是否已启动', 'error');
      return;
    }

    // Emit uploading state
    this.#eventBus.emit('task:update', {
      taskId,
      updates: {
        [kind]: {
          uploadState: 'uploading',
          originalName: file.name,
          size: file.size,
        },
      },
    });

    try {
      // Create blob URL for preview
      const previewUrl = URL.createObjectURL(file);

      // Upload to ComfyUI server
      const result = await this.#fileUploader.uploadAsset(file, { kind });

      // Parse duration for audio
      let duration = null;
      if (kind === 'audio') {
        duration = await this.#parseAudioDuration(previewUrl);
      }

      // Parse image dimensions
      let width = null;
      let height = null;
      if (kind === 'image' && previewUrl) {
        const dims = await this.#parseImageDimensions(previewUrl);
        width = dims.width;
        height = dims.height;
      }

      const updates = {
        uploadState: 'uploaded',
        originalName: result.originalName,
        uploadedName: result.name,
        previewUrl: previewUrl,
        size: file.size,
        file: file,  // Keep original File for orchestrator mode
      };

      if (kind === 'audio') updates.duration = duration;
      if (kind === 'image') {
        updates.width = width;
        updates.height = height;
      }

      this.#eventBus.emit('task:update', {
        taskId,
        updates: { [kind]: updates },
      });
    } catch (err) {
      console.error(`[TaskEditor] ${kind} upload failed:`, err);
      this.#eventBus.emit('task:update', {
        taskId,
        updates: {
          [kind]: { uploadState: 'failed' },
        },
      });
      this.#showToast(`上传失败: ${err.message || '未知错误'}`, 'error');
    }
  }

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} type
   */
  #showToast(message, type = 'info') {
    if (typeof window.__cf !== 'undefined' && window.__cf.showToast) {
      window.__cf.showToast(message, type);
    }
  }

  /**
   * Parse audio duration from blob URL.
   * @param {string} url
   * @returns {Promise<number|null>}
   */
  #parseAudioDuration(url) {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = url;
      audio.addEventListener('loadedmetadata', () => {
        resolve(audio.duration && isFinite(audio.duration) ? audio.duration : null);
      });
      audio.addEventListener('error', () => resolve(null));
      // Timeout fallback
      setTimeout(() => resolve(null), 5000);
    });
  }

  /**
   * Parse image dimensions from blob URL.
   * @param {string} url
   * @returns {Promise<{width:number|null,height:number|null}>}
   */
  #parseImageDimensions(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = url;
      img.addEventListener('load', () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      });
      img.addEventListener('error', () => resolve({ width: null, height: null }));
      setTimeout(() => resolve({ width: null, height: null }), 5000);
    });
  }

  // ── Field Update Emitter ───────────────────────────────────

  /**
   * Emit a task:update event and trigger validation.
   * @param {string} field
   * @param {*} value
   */
  #emitFieldUpdate(field, value) {
    if (!this.#currentTaskId) return;
    this.#eventBus.emit('task:update', {
      taskId: this.#currentTaskId,
      field,
      value,
    });
  }

  // ── Helpers ────────────────────────────────────────────────

  /**
   * Get a validation error message for a specific field.
   * @param {object} task
   * @param {string} field - 'image', 'audio', or 'prompt'
   * @returns {string|null}
   */
  #getFieldError(task, field) {
    if (!task.validation || !task.validation.errors) return null;
    const errorMap = {
      image: '请上传参考图',
      audio: '请上传音频',
      prompt: '请输入提示词',
    };
    const target = errorMap[field];
    if (!target) return null;
    return task.validation.errors.includes(target) ? target : null;
  }

  /**
   * @param {number} bytes
   * @returns {string}
   */
  #formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * @param {string} status
   * @returns {string}
   */
  #statusLabel(status) {
    const map = {
      draft: '草稿',
      ready: '就绪',
      uploading: '上传中',
      queued: '排队中',
      running: '执行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
      asset_missing: '资源缺失',
    };
    return map[status] || status || '草稿';
  }
}
