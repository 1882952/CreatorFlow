/**
 * Settings Panel Component
 *
 * Renders the settings UI for configuring ComfyUI server connection
 * and application preferences.
 */

/**
 * Render the settings panel into the given container.
 * @param {{ container: HTMLElement, app: object }} opts
 * @returns {{ destroy: Function }} Handle for cleanup
 */
export function renderSettingsPanel({ container, app }) {
  const { storage, comfyClient, eventBus } = app;
  const saved = storage.get('settings', {});

  const unsubscribeConn = eventBus.on('comfy:connection-changed', (state) => {
    updateConnectionDisplay(state);
  });

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'max-width:600px;margin:0 auto;';

  // ── ComfyUI Connection Section ───────────────────────────────
  const connCard = document.createElement('div');
  connCard.className = 'card';

  const connHeader = document.createElement('div');
  connHeader.className = 'card-header';
  connHeader.innerHTML = `<span class="card-title">ComfyUI 连接设置</span>`;
  connCard.appendChild(connHeader);

  const connDesc = document.createElement('p');
  connDesc.style.cssText = 'color:var(--text-secondary);margin-bottom:16px;font-size:13px;';
  connDesc.textContent = '配置 ComfyUI 服务器地址和连接选项。';
  connCard.appendChild(connDesc);

  // Connection status display
  const statusRow = document.createElement('div');
  statusRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px;';

  const statusDot = document.createElement('span');
  statusDot.className = 'status-dot';
  statusDot.dataset.role = 'settings-status-dot';
  statusDot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:var(--text-disabled);';

  const statusText = document.createElement('span');
  statusText.dataset.role = 'settings-status-text';
  statusText.style.cssText = 'font-size:12px;color:var(--text-secondary);';
  statusText.textContent = '检测中...';

  statusRow.appendChild(statusDot);
  statusRow.appendChild(statusText);
  connCard.appendChild(statusRow);

  // Server address input
  const inputGroup = document.createElement('div');
  inputGroup.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

  const label = document.createElement('label');
  label.style.cssText = 'display:block;margin-bottom:4px;font-size:12px;color:var(--text-secondary);';
  label.textContent = '服务器地址';
  inputGroup.appendChild(label);

  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:8px;';

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'input-field';
  urlInput.id = 'settings-baseurl';
  urlInput.value = saved.comfyBaseUrl || 'http://127.0.0.1:8188';
  urlInput.placeholder = 'http://127.0.0.1:8188';
  inputRow.appendChild(urlInput);

  const testBtn = document.createElement('button');
  testBtn.className = 'btn btn-secondary btn-sm';
  testBtn.textContent = '测试连接';
  testBtn.dataset.action = 'test-connection';
  inputRow.appendChild(testBtn);

  inputGroup.appendChild(inputRow);
  connCard.appendChild(inputGroup);

  // Test result
  const testResult = document.createElement('div');
  testResult.dataset.role = 'test-result';
  testResult.style.cssText = 'margin-top:8px;font-size:12px;min-height:18px;';
  connCard.appendChild(testResult);

  wrapper.appendChild(connCard);

  // ── Application Preferences Section ──────────────────────────
  const prefCard = document.createElement('div');
  prefCard.className = 'card';
  prefCard.style.marginTop = '16px';

  const prefHeader = document.createElement('div');
  prefHeader.className = 'card-header';
  prefHeader.innerHTML = `<span class="card-title">应用偏好</span>`;
  prefCard.appendChild(prefHeader);

  // Sidebar collapsed toggle
  const sidebarRow = document.createElement('div');
  sidebarRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;';

  const sidebarLabel = document.createElement('span');
  sidebarLabel.style.cssText = 'font-size:13px;color:var(--text-primary);';
  sidebarLabel.textContent = '侧边栏默认折叠';

  const sidebarCb = document.createElement('input');
  sidebarCb.type = 'checkbox';
  sidebarCb.dataset.field = 'sidebarCollapsed';
  sidebarCb.checked = !!saved.sidebarCollapsed;
  sidebarCb.style.accentColor = 'var(--color-primary)';
  sidebarCb.style.width = '16px';
  sidebarCb.style.height = '16px';
  sidebarCb.style.cursor = 'pointer';

  sidebarRow.appendChild(sidebarLabel);
  sidebarRow.appendChild(sidebarCb);
  prefCard.appendChild(sidebarRow);

  wrapper.appendChild(prefCard);

  // ── Save Button ──────────────────────────────────────────────
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.style.marginTop = '16px';
  saveBtn.style.width = '100%';
  saveBtn.textContent = '保存设置';
  saveBtn.dataset.action = 'save-settings';
  wrapper.appendChild(saveBtn);

  container.appendChild(wrapper);

  // ── Event Handlers ───────────────────────────────────────────

  // Test connection
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="test-connection"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '测试中...';
      testResult.textContent = '';
      testResult.style.color = '';

      const url = urlInput.value.trim();
      try {
        // We use a direct fetch to test the URL without changing the client
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(`${url}/system_stats`, { signal: controller.signal });
        clearTimeout(timeout);

        if (resp.ok) {
          testResult.textContent = '连接成功！';
          testResult.style.color = 'var(--color-success)';
        } else {
          testResult.textContent = `连接失败: HTTP ${resp.status}`;
          testResult.style.color = 'var(--color-error)';
        }
      } catch (err) {
        testResult.textContent = `连接失败: ${err.message || '无法连接'}`;
        testResult.style.color = 'var(--color-error)';
      } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
      }
      return;
    }

    // Save settings
    const saveAction = e.target.closest('[data-action="save-settings"]');
    if (saveAction) {
      const url = urlInput.value.trim();
      const settings = {
        comfyBaseUrl: url,
        sidebarCollapsed: sidebarCb.checked,
      };

      storage.set('settings', settings);

      // Apply server URL
      if (url) {
        comfyClient.setBaseUrl(url);
      }

      // Emit settings changed
      eventBus.emit('settings:changed', settings);

      // Show toast
      if (app.showToast) {
        app.showToast('设置已保存', 'success');
      } else if (window.__cf && window.__cf.showToast) {
        window.__cf.showToast('设置已保存', 'success');
      }
      return;
    }
  });

  // Initial connection state display
  updateConnectionDisplay(comfyClient.connectionState);

  /**
   * Update the connection status display.
   * @param {string} state
   */
  function updateConnectionDisplay(state) {
    const dot = container.querySelector('[data-role="settings-status-dot"]');
    const text = container.querySelector('[data-role="settings-status-text"]');
    if (!dot || !text) return;

    dot.style.background = '';
    switch (state) {
      case 'connected':
        dot.style.background = 'var(--color-success)';
        text.textContent = '已连接';
        text.style.color = 'var(--color-success)';
        break;
      case 'connecting':
      case 'reconnecting':
        dot.style.background = 'var(--color-warning)';
        text.textContent = '连接中...';
        text.style.color = 'var(--color-warning)';
        break;
      case 'error':
        dot.style.background = 'var(--color-error)';
        text.textContent = '连接错误';
        text.style.color = 'var(--color-error)';
        break;
      default:
        dot.style.background = 'var(--text-disabled)';
        text.textContent = '未连接';
        text.style.color = 'var(--text-secondary)';
    }
  }

  // Return cleanup handle
  return {
    destroy() {
      unsubscribeConn();
    },
  };
}
