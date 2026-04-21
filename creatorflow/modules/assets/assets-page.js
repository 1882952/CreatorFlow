export class AssetsModule {
  #app;
  #headerSlot = null;
  #contentSlot = null;
  #assets = [];
  #isLoading = false;
  #error = '';
  #boundClick = null;

  constructor({ app }) {
    this.#app = app;
  }

  mount(headerSlot, contentSlot) {
    this.#headerSlot = headerSlot;
    this.#contentSlot = contentSlot;
    this.#renderHeader();
    this.#boundClick = (event) => this.#handleClick(event);
    this.#contentSlot.addEventListener('click', this.#boundClick);
    this.#loadAssets();
  }

  unmount() {
    if (this.#contentSlot && this.#boundClick) {
      this.#contentSlot.removeEventListener('click', this.#boundClick);
    }
    this.#headerSlot = null;
    this.#contentSlot = null;
    this.#boundClick = null;
  }

  async #loadAssets() {
    const orchClient = this.#app.orchestratorClient;
    if (!orchClient) {
      this.#error = '资产页需要先在设置中启用编排服务。';
      this.#renderContent();
      return;
    }

    this.#isLoading = true;
    this.#error = '';
    this.#renderContent();

    try {
      const data = await orchClient.listAssets();
      this.#assets = Array.isArray(data.assets) ? data.assets : [];
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
    subtitle.textContent = '查看最终拼接视频与各段生成结果';
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
      page.appendChild(this.#createInfoCard('正在加载资产...'));
      this.#contentSlot.appendChild(page);
      return;
    }

    if (this.#error) {
      page.appendChild(this.#createInfoCard(this.#error, 'error'));
      this.#contentSlot.appendChild(page);
      return;
    }

    const grouped = this.#groupAssetsByJob(this.#assets);
    if (grouped.length === 0) {
      page.appendChild(this.#createInfoCard('暂无可展示的生成结果。'));
      this.#contentSlot.appendChild(page);
      return;
    }

    for (const job of grouped) {
      page.appendChild(this.#createJobCard(job));
    }

    this.#contentSlot.appendChild(page);
  }

  #createInfoCard(message, tone = 'info') {
    const card = document.createElement('div');
    card.className = `card assets-info-card assets-info-card--${tone}`;
    card.textContent = message;
    return card;
  }

  #groupAssetsByJob(assets) {
    const jobs = new Map();

    for (const asset of assets) {
      if (!jobs.has(asset.job_id)) {
        jobs.set(asset.job_id, {
          jobId: asset.job_id,
          jobName: asset.job_name,
          jobStatus: asset.job_status,
          createdAt: asset.created_at,
          finalAsset: null,
          segmentAssets: [],
        });
      }

      const group = jobs.get(asset.job_id);
      if (asset.type === 'final_video') {
        group.finalAsset = asset;
      } else {
        group.segmentAssets.push(asset);
      }
    }

    return Array.from(jobs.values());
  }

  #createJobCard(job) {
    const card = document.createElement('section');
    card.className = 'card assets-job-card';

    const header = document.createElement('div');
    header.className = 'assets-job-header';

    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'assets-job-title';
    title.textContent = job.jobName;
    const meta = document.createElement('div');
    meta.className = 'assets-job-meta';
    meta.textContent = `${this.#formatDate(job.createdAt)} · ${job.segmentAssets.length} 段`;
    info.appendChild(title);
    info.appendChild(meta);

    const badge = document.createElement('span');
    badge.className = `status-badge ${job.jobStatus || 'completed'}`;
    badge.textContent = this.#statusLabel(job.jobStatus);

    header.appendChild(info);
    header.appendChild(badge);
    card.appendChild(header);

    const finalWrap = document.createElement('div');
    finalWrap.className = 'assets-final-wrap';
    if (job.finalAsset) {
      finalWrap.appendChild(this.#createAssetCard(job.finalAsset, { compact: false, title: '最终视频' }));
    } else {
      finalWrap.appendChild(this.#createInfoCard('该任务还没有最终拼接视频。', 'warning'));
    }
    card.appendChild(finalWrap);

    if (job.segmentAssets.length > 0) {
      const details = document.createElement('details');
      details.className = 'assets-segments';

      const summary = document.createElement('summary');
      summary.textContent = `查看分段结果 (${job.segmentAssets.length})`;
      details.appendChild(summary);

      const grid = document.createElement('div');
      grid.className = 'assets-segment-grid';
      for (const asset of job.segmentAssets) {
        const segTitle = asset.segment_index !== null && asset.segment_index !== undefined
          ? `分段 ${asset.segment_index + 1}`
          : '分段结果';
        grid.appendChild(this.#createAssetCard(asset, { compact: true, title: segTitle }));
      }
      details.appendChild(grid);
      card.appendChild(details);
    }

    return card;
  }

  #createAssetCard(asset, { compact = false, title = '视频资产' } = {}) {
    const card = document.createElement('article');
    card.className = `assets-asset-card${compact ? ' compact' : ''}`;

    const titleRow = document.createElement('div');
    titleRow.className = 'assets-asset-title-row';

    const titleEl = document.createElement('div');
    titleEl.className = 'assets-asset-title';
    titleEl.textContent = title;

    const status = document.createElement('span');
    status.className = `status-badge ${asset.exists ? 'completed' : 'asset_missing'}`;
    status.textContent = asset.exists ? '可用' : '文件缺失';

    titleRow.appendChild(titleEl);
    titleRow.appendChild(status);
    card.appendChild(titleRow);

    if (asset.exists) {
      const video = document.createElement('video');
      video.className = 'assets-video';
      video.src = asset.preview_url;
      video.controls = true;
      video.preload = 'metadata';
      card.appendChild(video);
    } else {
      const missing = document.createElement('div');
      missing.className = 'assets-video-missing';
      missing.textContent = '资产文件不存在';
      card.appendChild(missing);
    }

    const meta = document.createElement('div');
    meta.className = 'assets-asset-meta';
    meta.textContent = `${asset.filename} · ${this.#formatSize(asset.size)}`;
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'assets-asset-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-secondary btn-sm';
    downloadBtn.dataset.action = 'download-asset';
    downloadBtn.dataset.assetId = asset.id;
    downloadBtn.dataset.url = asset.download_url;
    downloadBtn.textContent = '下载';
    downloadBtn.disabled = !asset.exists;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.dataset.action = 'delete-asset';
    deleteBtn.dataset.assetId = asset.id;
    deleteBtn.textContent = '删除';

    actions.appendChild(downloadBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);

    return card;
  }

  async #handleClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    if (action === 'refresh-assets') {
      this.#loadAssets();
      return;
    }

    if (action === 'download-asset') {
      const url = target.dataset.url;
      if (url) {
        window.open(url, '_blank', 'noopener');
      }
      return;
    }

    if (action === 'delete-asset') {
      const assetId = target.dataset.assetId;
      if (!assetId) return;

      if (!window.confirm('确认删除这个资产吗？此操作会删除本地文件。')) {
        return;
      }

      try {
        target.disabled = true;
        await this.#app.orchestratorClient.deleteAsset(assetId);
        this.#app.showToast?.('资产已删除', 'success');
        await this.#loadAssets();
      } catch (err) {
        console.error('[Assets] Delete failed:', err);
        this.#app.showToast?.(`删除失败: ${err.message || err}`, 'error');
        target.disabled = false;
      }
    }
  }

  #statusLabel(status) {
    switch (status) {
      case 'completed': return '已完成';
      case 'failed': return '失败';
      case 'running': return '运行中';
      case 'queued': return '排队中';
      default: return status || '未知';
    }
  }

  #formatSize(size) {
    if (!size) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx++;
    }
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  #formatDate(value) {
    try {
      return new Date(value).toLocaleString('zh-CN');
    } catch {
      return value || '';
    }
  }
}
