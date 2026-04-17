import { renderSettingsPanel } from './settings-panel.js';

export default {
  id: 'settings',
  route: '/settings',
  mount({ headerSlot, contentSlot, app }) {
    headerSlot.innerHTML = '<h2 style="font-size:18px;font-weight:600;">设置</h2>';

    const handle = renderSettingsPanel({ container: contentSlot, app });
    this._handle = handle;
  },
  unmount() {
    if (this._handle) {
      this._handle.destroy();
      this._handle = null;
    }
  }
};
