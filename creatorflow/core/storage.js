/**
 * localStorage wrapper with JSON serialization and error handling
 */
export class Storage {
  #prefix = 'creatorflow.';

  /**
   * Get a value from storage
   * @param {string} key
   * @param {*} defaultValue
   * @returns {*}
   */
  get(key, defaultValue = null) {
    try {
      const raw = localStorage.getItem(this.#prefix + key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[Storage] Failed to parse key "${key}":`, err);
      return defaultValue;
    }
  }

  /**
   * Set a value in storage
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    try {
      localStorage.setItem(this.#prefix + key, JSON.stringify(value));
    } catch (err) {
      console.error(`[Storage] Failed to set key "${key}":`, err);
    }
  }

  /**
   * Remove a key from storage
   * @param {string} key
   */
  remove(key) {
    try {
      localStorage.removeItem(this.#prefix + key);
    } catch (err) {
      console.error(`[Storage] Failed to remove key "${key}":`, err);
    }
  }

  /**
   * Clear all creatorflow-prefixed keys
   */
  clear() {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(this.#prefix)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch (err) {
      console.error('[Storage] Failed to clear:', err);
    }
  }
}
