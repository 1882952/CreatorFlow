export class AssetsModule {
  #app;
  #headerSlot = null;
  #contentSlot = null;
  #assets = [];
  #selectedIds = new Set();
  #isLoading = false;
  #error = '';
  #boundClick = null;
  #boundChange = null;

  constructor({ app }) {
    this.#app = app;
  }

  mount(headerSlot, contentSlot) {
    this.#headerSlot = headerSlot;
    this.#contentSlot = contentSlot;
    this.#boundClick = (event) => this.#handleClick(event);
    this.#boundChange = (event) => this.#handleChange(event);

    this.#renderHeader();
    this.#contentSlot.addEventListener('click', this.#boundClick);
    this.#contentSlot.addEventListener('change', this.#boundChange);
    this.#loadAssets();
  }

  unmount() {
    if (this.#contentSlot && this.#boundClick) {
      this.#contentSlot.removeEventListener('click', this.#boundClick);
    }
    if (this.#contentSlot && this.#boundChange) {
      this.#contentSlot.removeEventListener('change', this.#boundChange);
    }

    this.#headerSlot = null;
    this.#contentSlot = null;
    this.#boundClick = null;
    this.#boundChange = null;
  }

  async #loadAssets() {
    const orchClient = this.#app.orchestratorClient || this.#app.ensureOrchestratorClient?.();
    if (!orchClient) {
      this.#error = '资产页依赖本地编排服务，请先在设置中启用 Orchestrator。';
      this.#renderContent();
      return;
    }

    this.#isLoading = true;
    this.#error = '';
    this.#renderContent();

    try {
      const data = await orchClient.listAssets();
      this.#assets = Array.isArray(data.assets) ? data.assets : [];
      const validIds = new Set(this.#assets.map((asset) => asset.id));
      this.#selectedIds = new Set(
        Array.from(this.#selectedIds).filter((assetId) => validIds.has(assetId)),
      );
    } catch (err) {
      console.error('[Assets] Load failed:', err);
      this.#error = err.message || '资产加载失败';
    } finally {
      this.#isLoading = false;
      this.#renderContent();
    }
  }

  #renderHeader() {
    if (!this.#headerSlot) return;

    this.#headerSlot.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'assets-header';

    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'assets-header-title';
    title.textContent = '资产总览';

    const subtitle = document.createElement('div');
    subtitle.className = 'assets-header-subtitle';
    subtitle.textContent = '展示后端 data/output 目录中的最终合成视频';

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const actions = document.createElement('div');
    actions.className = 'assets-header-actions';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-secondary btn-sm';
    refreshBtn.dataset.action = 'refresh-assets';
    refreshBtn.textContent = '刷新';

    actions.appendChild(refreshBtn);
    wrapper.appendChild(titleWrap);
    wrapper.appendChild(actions);
    this.#headerSlot.appendChild(wrapper);
  }

  #renderContent() {
    if (!this.#contentSlot) return;

    this.#contentSlot.innerHTML = '';

    const page = document.createElement('div');
    page.className = 'assets-page';

    if (this.#isLoading) {
      page.appendChild(this.#createInfoCard('正在加载 output 目录中的视频...'));
      this.#contentSlot.appendChild(page);
      return;
    }

    if (this.#error) {
      page.appendChild(this.#createInfoCard(this.#error, 'error'));
      this.#contentSlot.appendChild(page);
      return;
    }

    page.appendChild(this.#createToolbar());

    if (this.#assets.length === 0) {
      page.appendChild(this.#createInfoCard('当前 data/output 目录下没有可展示的最终视频。'));
      this.#contentSlot.appendChild(page);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'assets-grid';
    this.#assets.forEach((asset, index) => {
      const card = this.#createAssetCard(asset);
      card.style.animationDelay = `${index * 50}ms`;
      card.classList.add('card-enter');
      grid.appendChild(card);
    });

    page.appendChild(grid);
    this.#contentSlot.appendChild(page);
  }

  #createToolbar() {
    const toolbar = document.createElement('section');
    toolbar.className = 'card assets-toolbar';

    const summary = document.createElement('div');
    summary.className = 'assets-toolbar-summary';

    const primary = document.createElement('div');
    primary.className = 'assets-toolbar-primary';
    primary.textContent = `最终成片 ${this.#assets.length} 条`;

    const secondary = document.createElement('div');
    secondary.className = 'assets-toolbar-secondary';
    secondary.textContent = `已选 ${this.#selectedIds.size} 条`;

    summary.appendChild(primary);
    summary.appendChild(secondary);

    const controls = document.createElement('div');
    controls.className = 'assets-toolbar-controls';

    if (this.#assets.length > 0) {
      const selectAll = document.createElement('label');
      selectAll.className = 'assets-select-all';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.action = 'toggle-all-assets';
      checkbox.checked = this.#selectedIds.size > 0 && this.#selectedIds.size === this.#assets.length;

      const text = document.createElement('span');
      text.textContent = '全选';

      selectAll.appendChild(checkbox);
      selectAll.appendChild(text);
      controls.appendChild(selectAll);
    }

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-secondary btn-sm';
    clearBtn.dataset.action = 'clear-selection';
    clearBtn.textContent = '清空选择';
    clearBtn.disabled = this.#selectedIds.size === 0;

    const batchDownloadBtn = document.createElement('button');
    batchDownloadBtn.className = 'btn btn-secondary btn-sm';
    batchDownloadBtn.dataset.action = 'batch-download';
    batchDownloadBtn.textContent = '批量下载';
    batchDownloadBtn.disabled = this.#selectedIds.size === 0;

    const batchDeleteBtn = document.createElement('button');
    batchDeleteBtn.className = 'btn btn-danger btn-sm';
    batchDeleteBtn.dataset.action = 'batch-delete';
    batchDeleteBtn.textContent = '批量删除';
    batchDeleteBtn.disabled = this.#selectedIds.size === 0;

    controls.appendChild(clearBtn);
    controls.appendChild(batchDownloadBtn);
    controls.appendChild(batchDeleteBtn);

    toolbar.appendChild(summary);
    toolbar.appendChild(controls);
    return toolbar;
  }

  #createAssetCard(asset) {
    const card = document.createElement('article');
    card.className = 'card assets-card';
    if (this.#selectedIds.has(asset.id)) {
      card.classList.add('selected');
    }

    const top = document.createElement('div');
    top.className = 'assets-card-top';

    const select = document.createElement('label');
    select.className = 'assets-select-one';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.action = 'toggle-asset';
    checkbox.dataset.assetId = asset.id;
    checkbox.checked = this.#selectedIds.has(asset.id);
    const checkboxText = document.createElement('span');
    checkboxText.textContent = this.#selectedIds.has(asset.id) ? '已选' : '选择';
    select.appendChild(checkbox);
    select.appendChild(checkboxText);

    const badge = document.createElement('span');
    badge.className = 'status-badge completed';
    badge.textContent = '最终成片';

    top.appendChild(select);
    top.appendChild(badge);

    const title = document.createElement('div');
    title.className = 'assets-card-title';
    title.textContent = asset.filename;

    const meta = document.createElement('div');
    meta.className = 'assets-card-meta';

    const jobLabel = document.createElement('div');
    jobLabel.textContent = asset.job_name
      ? `任务：${asset.job_name}${asset.job_status ? ` (${asset.job_status})` : ''}`
      : '任务：未关联';

    const fileLabel = document.createElement('div');
    fileLabel.textContent = `大小：${this.#formatSize(asset.size)} | 时间：${this.#formatDate(asset.created_at)}`;

    meta.appendChild(jobLabel);
    meta.appendChild(fileLabel);

    const video = document.createElement('video');
    video.className = 'assets-video';
    video.dataset.assetId = asset.id;
    video.src = asset.preview_url;
    video.controls = true;
    video.preload = 'metadata';

    const actions = document.createElement('div');
    actions.className = 'assets-card-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'btn btn-secondary btn-sm';
    playBtn.dataset.action = 'open-preview';
    playBtn.dataset.url = asset.preview_url;
    playBtn.textContent = '新窗口播放';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-secondary btn-sm';
    downloadBtn.dataset.action = 'download-asset';
    downloadBtn.dataset.assetId = asset.id;
    downloadBtn.textContent = '下载';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.dataset.action = 'delete-asset';
    deleteBtn.dataset.assetId = asset.id;
    deleteBtn.textContent = '删除';

    actions.appendChild(playBtn);
    actions.appendChild(downloadBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(top);
    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(video);
    card.appendChild(actions);
    return card;
  }

  #createInfoCard(message, tone = 'info') {
    const card = document.createElement('div');
    card.className = `card assets-info-card assets-info-card--${tone}`;
    card.textContent = message;
    return card;
  }

  #handleChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const action = target.dataset.action;
    if (action === 'toggle-all-assets') {
      this.#toggleAll(target.checked);
      return;
    }

    if (action === 'toggle-asset') {
      const assetId = target.dataset.assetId;
      if (!assetId) return;
      this.#setSelected(assetId, target.checked);
      this.#renderContent();
      return;
    }
  }

  async #handleClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    if (action === 'refresh-assets') {
      await this.#loadAssets();
      return;
    }

    if (action === 'clear-selection') {
      this.#selectedIds.clear();
      this.#renderContent();
      return;
    }

    if (action === 'open-preview') {
      const url = target.dataset.url;
      if (url) {
        window.open(url, '_blank', 'noopener');
      }
      return;
    }

    if (action === 'download-asset') {
      const asset = this.#findAsset(target.dataset.assetId);
      if (asset) {
        this.#downloadAsset(asset);
      }
      return;
    }

    if (action === 'batch-download') {
      const assets = this.#getSelectedAssets();
      for (const asset of assets) {
        this.#downloadAsset(asset);
      }
      return;
    }

    if (action === 'delete-asset') {
      const asset = this.#findAsset(target.dataset.assetId);
      if (!asset) return;
      await this.#deleteAssets([asset]);
      return;
    }

    if (action === 'batch-delete') {
      const assets = this.#getSelectedAssets();
      if (assets.length === 0) return;
      await this.#deleteAssets(assets);
    }
  }

  async #deleteAssets(assets) {
    const orchClient = this.#app.orchestratorClient;
    if (!orchClient || assets.length === 0) return;

    const names = assets.map((asset) => asset.filename).join('\n');
    const isBatch = assets.length > 1;
    const confirmed = window.confirm(
      `${isBatch ? '确认批量删除以下视频吗？' : '确认删除该视频吗？'}\n\n${names}`,
    );
    if (!confirmed) return;

    try {
      this.#releaseAssetPreviews(assets.map((asset) => asset.id));
      await this.#wait(180);

      if (isBatch) {
        const result = await orchClient.batchDeleteAssets(assets.map((asset) => asset.id));
        const deletedCount = Array.isArray(result.deleted) ? result.deleted.length : 0;
        const lockedCount = Array.isArray(result.locked) ? result.locked.length : 0;
        if (deletedCount > 0) {
          this.#app.showToast?.(`已删除 ${deletedCount} 条视频`, 'success');
        }
        if (lockedCount > 0) {
          this.#app.showToast?.(`有 ${lockedCount} 条视频仍被占用，未删除`, 'warning');
        }
      } else {
        await orchClient.deleteAsset(assets[0].id);
        this.#app.showToast?.('视频已删除', 'success');
      }

      for (const asset of assets) {
        this.#selectedIds.delete(asset.id);
      }
      await this.#loadAssets();
    } catch (err) {
      console.error('[Assets] Delete failed:', err);
      this.#app.showToast?.(`删除失败：${err.message || err}`, 'error');
    }
  }

  #releaseAssetPreviews(assetIds) {
    if (!this.#contentSlot || !Array.isArray(assetIds) || assetIds.length === 0) return;

    for (const assetId of assetIds) {
      const video = this.#contentSlot.querySelector(`video[data-asset-id="${CSS.escape(assetId)}"]`);
      if (!video) continue;

      try {
        video.pause();
      } catch {
        // Ignore browsers that reject pause during teardown.
      }

      video.removeAttribute('src');
      video.load();
    }
  }

  #wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  #downloadAsset(asset) {
    const link = document.createElement('a');
    link.href = asset.download_url;
    link.download = asset.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  #findAsset(assetId) {
    return this.#assets.find((asset) => asset.id === assetId) || null;
  }

  #getSelectedAssets() {
    return this.#assets.filter((asset) => this.#selectedIds.has(asset.id));
  }

  #toggleAll(checked) {
    if (checked) {
      this.#selectedIds = new Set(this.#assets.map((asset) => asset.id));
    } else {
      this.#selectedIds.clear();
    }
    this.#renderContent();
  }

  #setSelected(assetId, checked) {
    if (checked) {
      this.#selectedIds.add(assetId);
    } else {
      this.#selectedIds.delete(assetId);
    }
  }

  #formatSize(size) {
    if (!size) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  }

  #formatDate(value) {
    try {
      return new Date(value).toLocaleString('zh-CN');
    } catch {
      return value || '';
    }
  }
}
