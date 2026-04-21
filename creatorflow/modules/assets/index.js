import { AssetsModule } from './assets-page.js?v=20260421-asset-client-fix';

export default {
  id: 'assets',
  route: '/assets',
  mount({ headerSlot, contentSlot, app }) {
    const module = new AssetsModule({ app });
    module.mount(headerSlot, contentSlot);
    this._instance = module;
  },
  unmount() {
    if (this._instance) {
      this._instance.unmount();
      this._instance = null;
    }
  }
};
