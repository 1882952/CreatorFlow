/**
 * Hash-based Router
 * Supports #/path style routing with module registration
 */
export class Router {
  #routes = new Map();
  #currentPath = '';
  #beforeEach = null;

  /**
   * Register a route handler
   * @param {string} path - Route path (e.g. '/digital-human')
   * @param {Function} handler - Called with (path) on navigation
   */
  register(path, handler) {
    this.#routes.set(path, handler);
  }

  /**
   * Navigate to a path
   * @param {string} path
   */
  navigate(path) {
    window.location.hash = '#' + path;
  }

  /**
   * Get current active path
   * @returns {string}
   */
  getCurrentPath() {
    return this.#currentPath;
  }

  /**
   * Set a guard function called before each route change
   * @param {Function} fn - Return false to cancel navigation
   */
  beforeEach(fn) {
    this.#beforeEach = fn;
  }

  /**
   * Start listening for hash changes
   */
  start() {
    window.addEventListener('hashchange', () => this.#handleRoute());
    this.#handleRoute();
  }

  #handleRoute() {
    const hash = window.location.hash.slice(1) || '/digital-human';

    if (hash === this.#currentPath) return;

    if (this.#beforeEach && this.#beforeEach(hash, this.#currentPath) === false) {
      return;
    }

    const handler = this.#routes.get(hash);
    if (handler) {
      this.#currentPath = hash;
      handler(hash);
    } else {
      // Fallback to default route
      window.location.hash = '#/digital-human';
    }
  }
}
