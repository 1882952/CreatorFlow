/**
 * TaskList Component
 *
 * Renders the left-side task list panel with toolbar, drag-drop sorting,
 * bulk image import, and selection management.
 */
export class TaskList {
  /** @type {HTMLElement} */
  #container;
  /** @type {import('../../core/event-bus.js').EventBus} */
  #eventBus;
  /** @type {string|null} */
  #dragSrcId = null;

  /**
   * @param {{ container: HTMLElement, eventBus: import('../../core/event-bus.js').EventBus }} opts
   */
  constructor({ container, eventBus }) {
    this.#container = container;
    this.#eventBus = eventBus;
    this.#bindEvents();
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Render the full task list panel.
   * @param {Array<object>} tasks - Array of task objects
   * @param {string|null} selectedId - Currently selected task ID
   */
  render(tasks, selectedId) {
    this.#container.innerHTML = '';

    // Toolbar
    const toolbar = this.#createToolbar(tasks);
    this.#container.appendChild(toolbar);

    // Task scroll area
    const scroll = document.createElement('div');
    scroll.className = 'dh-task-scroll';
    scroll.dataset.role = 'task-scroll';

    if (tasks.length === 0) {
      scroll.appendChild(this.#createEmptyState());
    } else {
      tasks.forEach((task, index) => {
        const item = this.#createTaskItem(task, task.id === selectedId);
        item.style.animationDelay = `${index * 30}ms`;
        item.classList.add('task-enter');
        scroll.appendChild(item);
      });
    }
    this.#container.appendChild(scroll);

    // Stats bar
    const stats = document.createElement('div');
    stats.className = 'dh-stats-bar';
    const selectedCount = tasks.filter(t => t.selected).length;
    stats.textContent = `共 ${tasks.length} 项，已选 ${selectedCount} 项`;
    this.#container.appendChild(stats);
  }

  // ── Toolbar ────────────────────────────────────────────────

  /**
   * @param {Array<object>} tasks
   * @returns {HTMLElement}
   */
  #createToolbar(tasks) {
    const toolbar = document.createElement('div');
    toolbar.className = 'dh-toolbar';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.dataset.action = 'create';
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>新增任务`;

    const spacer = document.createElement('div');
    spacer.className = 'dh-toolbar-spacer';

    const allSelected = tasks.length > 0 && tasks.every(t => t.selected);
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-ghost btn-sm';
    toggleBtn.dataset.action = 'select-all';
    toggleBtn.textContent = allSelected ? '取消全选' : '全选';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.dataset.action = 'delete-selected';
    deleteBtn.textContent = '删除已选';
    deleteBtn.disabled = !tasks.some(t => t.selected);

    toolbar.appendChild(addBtn);
    toolbar.appendChild(spacer);
    toolbar.appendChild(toggleBtn);
    toolbar.appendChild(deleteBtn);

    return toolbar;
  }

  // ── Empty State ────────────────────────────────────────────

  /**
   * @returns {HTMLElement}
   */
  #createEmptyState() {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.style.padding = '48px 16px';
    el.innerHTML = `
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <line x1="12" y1="8" x2="12" y2="16"/>
        <line x1="8" y1="12" x2="16" y2="12"/>
      </svg>
      <div class="empty-title">暂无任务</div>
      <div class="empty-desc">点击「新增任务」或拖入图片批量创建</div>
    `;
    return el;
  }

  // ── Task Item ──────────────────────────────────────────────

  /**
   * @param {object} task
   * @param {boolean} isSelected
   * @returns {HTMLElement}
   */
  #createTaskItem(task, isSelected) {
    const item = document.createElement('div');
    item.className = 'dh-task-item' + (isSelected ? ' selected' : '');
    item.dataset.taskId = task.id;
    item.draggable = true;

    // Checkbox
    const cbWrap = document.createElement('label');
    cbWrap.className = 'dh-task-checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!task.selected;
    cb.dataset.action = 'toggle-selected';
    cbWrap.appendChild(cb);
    item.appendChild(cbWrap);

    // Thumbnail
    const thumb = document.createElement('div');
    thumb.className = 'dh-task-thumb';
    if (task.image && task.image.previewUrl) {
      const img = document.createElement('img');
      img.src = task.image.previewUrl;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = `<svg class="dh-thumb-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
    }
    item.appendChild(thumb);

    // Info (name + badge)
    const info = document.createElement('div');
    info.className = 'dh-task-info';
    const name = document.createElement('div');
    name.className = 'dh-task-name';
    name.textContent = task.name || '未命名任务';
    name.dataset.action = 'select';
    info.appendChild(name);

    const badge = document.createElement('span');
    badge.className = `status-badge ${task.status || 'draft'} dh-task-badge`;
    badge.textContent = this.#statusLabel(task.status);
    info.appendChild(badge);

    item.appendChild(info);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'dh-task-actions';

    const dupBtn = document.createElement('button');
    dupBtn.className = 'btn btn-ghost btn-icon';
    dupBtn.dataset.action = 'duplicate';
    dupBtn.dataset.tooltip = '复制';
    dupBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost btn-icon';
    delBtn.dataset.action = 'delete';
    delBtn.dataset.tooltip = '删除';
    delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`;

    actions.appendChild(dupBtn);
    actions.appendChild(delBtn);
    item.appendChild(actions);

    return item;
  }

  // ── Event Binding ──────────────────────────────────────────

  #bindEvents() {
    // Click delegation on container
    this.#container.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);

      // Checkbox toggle
      const cbAction = target.closest('[data-action="toggle-selected"]');
      if (cbAction) {
        const item = cbAction.closest('.dh-task-item');
        if (item) {
          e.stopPropagation();
          this.#eventBus.emit('task:toggle-selected', { taskId: item.dataset.taskId });
          return;
        }
      }

      // Toolbar buttons
      const action = target.closest('[data-action]');
      if (action) {
        const act = action.dataset.action;
        switch (act) {
          case 'create':
            this.#eventBus.emit('task:create', {});
            return;
          case 'select-all':
            this.#eventBus.emit('task:select-all', {});
            return;
          case 'delete-selected': {
            this.#eventBus.emit('task:delete-selected', {});
            return;
          }
          case 'select': {
            const item = action.closest('.dh-task-item');
            if (item) {
              this.#eventBus.emit('task:select', { taskId: item.dataset.taskId });
              return;
            }
            break;
          }
          case 'duplicate': {
            const item = action.closest('.dh-task-item');
            if (item) {
              this.#eventBus.emit('task:duplicate', { taskId: item.dataset.taskId });
              return;
            }
            break;
          }
          case 'delete': {
            const item = action.closest('.dh-task-item');
            if (item) {
              this.#eventBus.emit('task:delete', { taskId: item.dataset.taskId });
              return;
            }
            break;
          }
        }
      }

      // Click on task item itself (select)
      const taskItem = target.closest('.dh-task-item');
      if (taskItem && !target.closest('.dh-task-actions') && !target.closest('.dh-task-checkbox')) {
        this.#eventBus.emit('task:select', { taskId: taskItem.dataset.taskId });
      }
    });

    // Drag & Drop sorting
    this.#container.addEventListener('dragstart', (e) => {
      const item = /** @type {HTMLElement} */ (e.target).closest('.dh-task-item');
      if (!item) return;
      this.#dragSrcId = item.dataset.taskId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.taskId);
      item.style.opacity = '0.5';
    item.style.transform = 'scale(1.02)';
    item.style.boxShadow = '0 8px 32px rgba(0,0,0,0.4)';
    });

    this.#container.addEventListener('dragend', (e) => {
      const item = /** @type {HTMLElement} */ (e.target).closest('.dh-task-item');
      if (item) {
        item.style.opacity = '';
        item.style.transform = '';
        item.style.boxShadow = '';
      }
      this.#dragSrcId = null;
      // Clean up all drag-over states
      this.#container.querySelectorAll('.dh-task-item.drag-over').forEach(el => {
        el.classList.remove('drag-over');
      });
    });

    this.#container.addEventListener('dragover', (e) => {
      // Only handle internal task drag sorting (not file drag)
      if (!this.#dragSrcId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const scrollArea = this.#container.querySelector('[data-role="task-scroll"]');
      if (!scrollArea) return;

      // Clear previous highlights
      scrollArea.querySelectorAll('.dh-task-item.drag-over').forEach(el => {
        el.classList.remove('drag-over');
      });

      const target = /** @type {HTMLElement} */ (e.target).closest('.dh-task-item');
      if (target && target.dataset.taskId !== this.#dragSrcId) {
        target.classList.add('drag-over');
      }
    });

    this.#container.addEventListener('dragleave', (e) => {
      const target = /** @type {HTMLElement} */ (e.target).closest('.dh-task-item');
      if (target) target.classList.remove('drag-over');
    });

    this.#container.addEventListener('drop', (e) => {
      // Only handle internal task drag sorting
      if (!this.#dragSrcId) return;
      e.preventDefault();

      const target = /** @type {HTMLElement} */ (e.target).closest('.dh-task-item');
      if (!target || target.dataset.taskId === this.#dragSrcId) return;

      target.classList.remove('drag-over');

      this.#eventBus.emit('task:reorder', {
        sourceId: this.#dragSrcId,
        targetId: target.dataset.taskId,
      });

      this.#dragSrcId = null;
    });

    // ── Bulk Image Import (file drag from outside) ──────────
    let dragCounter = 0;

    this.#container.addEventListener('dragenter', (e) => {
      // Only handle file drags (not internal task drags)
      if (this.#dragSrcId) return;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        dragCounter++;
      }
    });

    this.#container.addEventListener('dragover', (e) => {
      if (this.#dragSrcId) return;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    this.#container.addEventListener('dragleave', (e) => {
      if (this.#dragSrcId) return;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        dragCounter--;
      }
    });

    this.#container.addEventListener('drop', (e) => {
      if (this.#dragSrcId) return;
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      dragCounter = 0;

      const files = Array.from(e.dataTransfer.files);
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        this.#eventBus.emit('task:bulk-image-import', { files: imageFiles });
      }
    });
  }

  // ── Helpers ────────────────────────────────────────────────

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
