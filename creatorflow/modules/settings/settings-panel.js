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
  wrapper.style.cssText = 'max-width:640px;margin:0 auto;';

  // ── ComfyUI Connection Section ───────────────────────────────
  const connCard = document.createElement('div');
  connCard.className = 'card';
  connCard.style.marginBottom = '20px';

  const connHeader = document.createElement('div');
  connHeader.className = 'card-header';
  connHeader.innerHTML = `<span class="card-title">ComfyUI 连接设置</span>`;
  connCard.appendChild(connHeader);

  const connDesc = document.createElement('p');
  connDesc.style.cssText = 'color:var(--text-tertiary);margin-bottom:20px;font-size:14px;line-height:1.6;';
  connDesc.textContent = '配置 ComfyUI 服务器地址和连接选项。';
  connCard.appendChild(connDesc);

  // Connection status display
  const statusRow = document.createElement('div');
  statusRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:20px;padding:12px 16px;background:rgba(255,255,255,0.02);border-radius:var(--radius-md);border:1px solid var(--border-color);';

  const statusDot = document.createElement('span');
  statusDot.className = 'glow-dot';
  statusDot.dataset.role = 'settings-status-dot';
  statusDot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:var(--text-disabled);flex-shrink:0;';

  const statusText = document.createElement('span');
  statusText.dataset.role = 'settings-status-text';
  statusText.style.cssText = 'font-size:13px;font-weight:500;color:var(--text-secondary);';
  statusText.textContent = '检测中...';

  statusRow.appendChild(statusDot);
  statusRow.appendChild(statusText);
  connCard.appendChild(statusRow);

  // Server address input
  const inputGroup = document.createElement('div');
  inputGroup.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

  const label = document.createElement('label');
  label.style.cssText = 'display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:var(--text-secondary);';
  label.textContent = '服务器地址';
  inputGroup.appendChild(label);

  const inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;gap:10px;';

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
  testResult.style.cssText = 'margin-top:10px;font-size:13px;min-height:20px;font-weight:500;';
  connCard.appendChild(testResult);

  wrapper.appendChild(connCard);

  // ── Application Preferences Section ──────────────────────────
  const prefCard = document.createElement('div');
  prefCard.className = 'card';
  prefCard.style.marginTop = '20px';

  // ── Orchestrator Service Section ─────────────────────────────
  const orchCard = document.createElement('div');
  orchCard.className = 'card';
  orchCard.style.marginTop = '20px';

  const orchHeader = document.createElement('div');
  orchHeader.className = 'card-header';
  orchHeader.innerHTML = `<span class="card-title">编排服务设置</span>`;
  orchCard.appendChild(orchHeader);

  const orchDesc = document.createElement('p');
  orchDesc.style.cssText = 'color:var(--text-tertiary);margin-bottom:20px;font-size:14px;line-height:1.6;';
  orchDesc.textContent = '配置本地编排服务地址和分段生成参数。';
  orchCard.appendChild(orchDesc);

  // Orchestrator URL
  const orchGroup = document.createElement('div');
  orchGroup.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

  const orchLabel = document.createElement('label');
  orchLabel.style.cssText = 'display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:var(--text-secondary);';
  orchLabel.textContent = '编排服务地址';
  orchGroup.appendChild(orchLabel);

  const orchRow = document.createElement('div');
  orchRow.style.cssText = 'display:flex;gap:10px;';

  const orchInput = document.createElement('input');
  orchInput.type = 'text';
  orchInput.className = 'input-field';
  orchInput.id = 'settings-orchestrator-url';
  orchInput.value = saved.orchestratorBaseUrl || 'http://localhost:18688';
  orchInput.placeholder = 'http://localhost:18688';
  orchRow.appendChild(orchInput);

  const orchTestBtn = document.createElement('button');
  orchTestBtn.className = 'btn btn-secondary btn-sm';
  orchTestBtn.textContent = '测试连接';
  orchTestBtn.dataset.action = 'test-orchestrator';
  orchRow.appendChild(orchTestBtn);

  orchGroup.appendChild(orchRow);
  orchCard.appendChild(orchGroup);

  // Orchestrator test result
  const orchTestResult = document.createElement('div');
  orchTestResult.dataset.role = 'orch-test-result';
  orchTestResult.style.cssText = 'margin-top:10px;font-size:13px;min-height:20px;font-weight:500;';
  orchCard.appendChild(orchTestResult);

  // Default output directory
  const outputGroup = document.createElement('div');
  outputGroup.style.cssText = 'margin-top:16px;';

  const outputLabel = document.createElement('label');
  outputLabel.style.cssText = 'display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:var(--text-secondary);';
  outputLabel.textContent = '默认输出目录';
  outputGroup.appendChild(outputLabel);

  const outputInput = document.createElement('input');
  outputInput.type = 'text';
  outputInput.className = 'input-field';
  outputInput.id = 'settings-output-dir';
  outputInput.value = saved.defaultOutputDir || '';
  outputInput.placeholder = '留空则使用服务端默认目录';
  outputGroup.appendChild(outputInput);

  orchCard.appendChild(outputGroup);

  // Execution mode toggle
  const modeGroup = document.createElement('div');
  modeGroup.style.cssText = 'margin-top:16px;display:flex;align-items:center;justify-content:space-between;';

  const modeLabel = document.createElement('span');
  modeLabel.style.cssText = 'font-size:14px;font-weight:500;color:var(--text-primary);';
  modeLabel.textContent = '执行模式';

  const modeSelect = document.createElement('select');
  modeSelect.className = 'input-field';
  modeSelect.style.cssText = 'width:auto;min-width:140px;';
  modeSelect.id = 'settings-execution-mode';
  modeSelect.innerHTML = `
    <option value="orchestrated" ${saved.executionMode !== 'direct' ? 'selected' : ''}>编排服务（推荐）</option>
    <option value="direct" ${saved.executionMode === 'direct' ? 'selected' : ''}>直连 ComfyUI（旧版）</option>
  `;
  modeGroup.appendChild(modeLabel);
  modeGroup.appendChild(modeSelect);
  orchCard.appendChild(modeGroup);

  // Cleanup delay
  const cleanupGroup = document.createElement('div');
  cleanupGroup.style.cssText = 'margin-top:16px;display:flex;align-items:center;justify-content:space-between;';

  const cleanupLabel = document.createElement('span');
  cleanupLabel.style.cssText = 'font-size:14px;font-weight:500;color:var(--text-primary);';
  cleanupLabel.textContent = '自动清理延迟（秒）';

  const cleanupInput = document.createElement('input');
  cleanupInput.type = 'number';
  cleanupInput.className = 'input-field';
  cleanupInput.style.cssText = 'width:80px;';
  cleanupInput.id = 'settings-cleanup-delay';
  cleanupInput.value = saved.cleanupAfterSeconds || 300;
  cleanupInput.min = '0';
  cleanupGroup.appendChild(cleanupLabel);
  cleanupGroup.appendChild(cleanupInput);
  orchCard.appendChild(cleanupGroup);

  // Debug mode toggle
  const debugGroup = document.createElement('div');
  debugGroup.style.cssText = 'margin-top:16px;display:flex;align-items:center;justify-content:space-between;padding:6px 0;';

  const debugLabel = document.createElement('span');
  debugLabel.style.cssText = 'font-size:14px;font-weight:500;color:var(--text-primary);';
  debugLabel.textContent = '调试模式（保留中间文件）';

  const debugCb = document.createElement('input');
  debugCb.type = 'checkbox';
  debugCb.dataset.field = 'debugKeepIntermediates';
  debugCb.checked = !!saved.debugKeepIntermediates;
  debugCb.style.accentColor = 'var(--color-primary)';
  debugCb.style.width = '16px';
  debugCb.style.height = '16px';
  debugCb.style.cursor = 'pointer';
  debugGroup.appendChild(debugLabel);
  debugGroup.appendChild(debugCb);
  orchCard.appendChild(debugGroup);

  wrapper.appendChild(orchCard);

  const prefHeader = document.createElement('div');
  prefHeader.className = 'card-header';
  prefHeader.innerHTML = `<span class="card-title">应用偏好</span>`;
  prefCard.appendChild(prefHeader);

  // Sidebar collapsed toggle
  const sidebarRow = document.createElement('div');
  sidebarRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;';

  const sidebarLabel = document.createElement('span');
  sidebarLabel.style.cssText = 'font-size:14px;font-weight:500;color:var(--text-primary);';
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
  saveBtn.style.marginTop = '24px';
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

    // Test orchestrator connection
    const orchBtn = e.target.closest('[data-action="test-orchestrator"]');
    if (orchBtn) {
      orchBtn.disabled = true;
      orchBtn.textContent = '测试中...';
      orchTestResult.textContent = '';
      orchTestResult.style.color = '';

      const url = orchInput.value.trim();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const resp = await fetch(`${url}/api/health`, { signal: controller.signal });
        clearTimeout(timeout);

        if (resp.ok) {
          const data = await resp.json();
          orchTestResult.textContent = `连接成功！(SQLite: ${data.sqlite}, ComfyUI: ${data.comfyui}, ffmpeg: ${data.ffmpeg})`;
          orchTestResult.style.color = 'var(--color-success)';
        } else {
          orchTestResult.textContent = `连接失败: HTTP ${resp.status}`;
          orchTestResult.style.color = 'var(--color-error)';
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          orchTestResult.textContent = '连接超时：请确认编排服务已启动且地址正确';
        } else {
          orchTestResult.textContent = `连接失败: ${err.message || '无法连接'}`;
        }
        orchTestResult.style.color = 'var(--color-error)';
      } finally {
        orchBtn.disabled = false;
        orchBtn.textContent = '测试连接';
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
        orchestratorBaseUrl: orchInput.value.trim(),
        defaultOutputDir: outputInput.value.trim(),
        executionMode: modeSelect.value,
        cleanupAfterSeconds: parseInt(cleanupInput.value) || 300,
        debugKeepIntermediates: debugCb.checked,
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
    dot.style.boxShadow = '';
    switch (state) {
      case 'connected':
        dot.style.background = 'var(--color-success)';
        dot.style.boxShadow = '0 0 8px var(--color-success-glow)';
        text.textContent = '已连接';
        text.style.color = 'var(--color-success)';
        break;
      case 'connecting':
      case 'reconnecting':
        dot.style.background = 'var(--color-warning)';
        dot.style.boxShadow = '0 0 8px var(--color-warning-glow)';
        text.textContent = '连接中...';
        text.style.color = 'var(--color-warning)';
        break;
      case 'error':
        dot.style.background = 'var(--color-error)';
        dot.style.boxShadow = '0 0 8px var(--color-error-glow)';
        text.textContent = '连接错误';
        text.style.color = 'var(--color-error)';
        break;
      default:
        dot.style.background = 'var(--text-disabled)';
        dot.style.boxShadow = 'none';
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
