// cache-manager.js - TTL-based read-through cache using chrome.storage.local
// Minimizes Firestore reads to stay within free tier (50K reads/day).
// All user data reads should go through this module.

/**
 * Cache TTL configuration (milliseconds).
 * Adjust these to balance freshness vs Firestore read cost.
 */
// eslint-disable-next-line no-var
var CACHE_TTLS = {
  profile: 10 * 60 * 1000,       // 10 minutes
  plan: 5 * 60 * 1000,           // 5 minutes
  templates: 60 * 60 * 1000,     // 1 hour
  skillMap: 60 * 60 * 1000,      // 1 hour
  preferences: 30 * 60 * 1000,   // 30 minutes
  botSettings: 30 * 60 * 1000,   // 30 minutes
  fullProfile: 10 * 60 * 1000,   // 10 minutes (entire user doc)
};

/**
 * Cache key prefix to avoid collisions with other chrome.storage data.
 */
// eslint-disable-next-line no-var
var CACHE_PREFIX = '_cache_';

/**
 * Get cached data if TTL is still valid.
 * @param {string} key - Cache key (e.g., 'profile', 'skillMap', 'fullProfile')
 * @returns {Promise<any|null>} - Cached data or null if expired/missing
 */
async function getCached(key) {
  const cacheKey = CACHE_PREFIX + key;
  return new Promise((resolve) => {
    chrome.storage.local.get([cacheKey], (result) => {
      const entry = result[cacheKey];
      if (!entry || !entry._cachedAt || !entry.data) {
        resolve(null);
        return;
      }

      const ttl = CACHE_TTLS[key] || CACHE_TTLS.fullProfile;
      const age = Date.now() - entry._cachedAt;

      if (age >= ttl) {
        // Expired — return null so caller fetches fresh data
        resolve(null);
        return;
      }

      resolve(entry.data);
    });
  });
}

/**
 * Store data in the cache with a timestamp.
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @returns {Promise<void>}
 */
async function setCache(key, data) {
  const cacheKey = CACHE_PREFIX + key;
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [cacheKey]: {
        data: data,
        _cachedAt: Date.now(),
      }
    }, resolve);
  });
}

/**
 * Invalidate (remove) a specific cache entry.
 * @param {string} key - Cache key to invalidate
 * @returns {Promise<void>}
 */
async function invalidateCache(key) {
  const cacheKey = CACHE_PREFIX + key;
  return new Promise((resolve) => {
    chrome.storage.local.remove([cacheKey], resolve);
  });
}

/**
 * Invalidate all cached user data.
 * Called on logout to ensure no stale data remains.
 * @returns {Promise<void>}
 */
async function invalidateAllCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (allData) => {
      const cacheKeys = Object.keys(allData).filter(k => k.startsWith(CACHE_PREFIX));
      if (cacheKeys.length === 0) {
        resolve();
        return;
      }
      chrome.storage.local.remove(cacheKeys, resolve);
    });
  });
}

/**
 * Check if a cache entry exists and is still valid (non-expired).
 * @param {string} key - Cache key
 * @returns {Promise<boolean>}
 */
async function isCacheValid(key) {
  const data = await getCached(key);
  return data !== null;
}
