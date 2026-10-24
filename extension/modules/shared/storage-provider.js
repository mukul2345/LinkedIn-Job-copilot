// storage-provider.js - Storage seam for Chrome extension persistence.

/** Storage provider contract backed by a Chrome storage area. */
// eslint-disable-next-line no-var
var StorageProvider = (function () {
  function ChromeStorageProvider(storageArea) {
    if (!storageArea || typeof storageArea.get !== 'function') {
      throw new TypeError('A valid Chrome storage area is required.');
    }
    this.storageArea = storageArea;
  }

  /** Read one key, returning the provided fallback when absent. */
  ChromeStorageProvider.prototype.get = async function (key, fallbackValue = null) {
    if (typeof key !== 'string' || !key) throw new TypeError('Storage key is required.');
    const stored = await new Promise(resolve => this.storageArea.get([key], resolve));
    return Object.prototype.hasOwnProperty.call(stored || {}, key) && stored[key] !== undefined
      ? stored[key]
      : fallbackValue;
  };

  /** Persist one JSON-compatible value. */
  ChromeStorageProvider.prototype.set = function (key, value) {
    if (typeof key !== 'string' || !key) return Promise.reject(new TypeError('Storage key is required.'));
    return new Promise(resolve => this.storageArea.set({ [key]: value }, resolve));
  };

  /** Remove one or more keys. */
  ChromeStorageProvider.prototype.remove = function (keys) {
    const normalized = Array.isArray(keys) ? keys : [keys];
    if (!normalized.every(key => typeof key === 'string' && key)) {
      return Promise.reject(new TypeError('Valid storage keys are required.'));
    }
    return new Promise(resolve => this.storageArea.remove(normalized, resolve));
  };

  /** Return a namespaced provider to prevent key collisions. */
  ChromeStorageProvider.prototype.namespace = function (prefix) {
    if (!/^[A-Za-z0-9._-]+$/.test(prefix || '')) throw new TypeError('Invalid storage namespace.');
    const parent = this;
    return Object.freeze({
      get(key, fallbackValue) { return parent.get(`${prefix}:${key}`, fallbackValue); },
      set(key, value) { return parent.set(`${prefix}:${key}`, value); },
      remove(key) { return parent.remove(`${prefix}:${key}`); },
    });
  };

  return ChromeStorageProvider;
})();
