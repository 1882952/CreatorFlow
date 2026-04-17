import { DigitalHumanModule } from './digital-human.js';

export default {
  id: 'digital-human',
  route: '/digital-human',
  mount({ headerSlot, contentSlot, app }) {
    const module = new DigitalHumanModule({ app });
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
