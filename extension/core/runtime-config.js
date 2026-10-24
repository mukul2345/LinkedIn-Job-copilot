// runtime-config.js - Validated runtime configuration for classic-script contexts.

// eslint-disable-next-line no-var
var SYSTEM_DEFAULTS = Object.freeze({
  apiBaseUrl: 'https://us-central1-linkedin-jobcopilot.cloudfunctions.net',
  apiVersion: 'v1',
  requestTimeoutMs: 15000,
  gmailScanIntervalMinutes: 15,
});

// eslint-disable-next-line no-var
var SAFE_CONFIG_FALLBACK = Object.freeze({
  apiBaseUrl: 'https://us-central1-linkedin-jobcopilot.cloudfunctions.net',
  apiVersion: 'v1',
  requestTimeoutMs: 10000,
  gmailScanIntervalMinutes: 30,
});

/** Return a validated HTTPS URL without trailing slashes. */
function validateApiBaseUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.href.replace(/\/+$/, '');
  } catch (_) {
    return null;
  }
}

/** Validate an untrusted runtime configuration object. */
function validateRuntimeConfig(candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const validated = {};
  const apiBaseUrl = validateApiBaseUrl(source.apiBaseUrl);
  if (apiBaseUrl) validated.apiBaseUrl = apiBaseUrl;
  if (/^v\d+$/.test(source.apiVersion || '')) validated.apiVersion = source.apiVersion;
  if (Number.isInteger(source.requestTimeoutMs) && source.requestTimeoutMs >= 1000 && source.requestTimeoutMs <= 60000) {
    validated.requestTimeoutMs = source.requestTimeoutMs;
  }
  if (Number.isInteger(source.gmailScanIntervalMinutes) && source.gmailScanIntervalMinutes >= 5 && source.gmailScanIntervalMinutes <= 1440) {
    validated.gmailScanIntervalMinutes = source.gmailScanIntervalMinutes;
  }
  return validated;
}
/**
 * Resolve config with precedence: explicit > persisted user > system defaults > safe fallback.
 * Invalid values are ignored at every external boundary.
 */
async function resolveRuntimeConfig(explicitConfig = {}, persistedConfig) {
  let persisted = persistedConfig;
  if (persisted === undefined && typeof chrome !== 'undefined' && chrome.storage?.local) {
    persisted = await new Promise(resolve => {
      chrome.storage.local.get(['runtimeConfig'], stored => resolve(stored.runtimeConfig || {}));
    });
  }
  return Object.freeze({
    ...SAFE_CONFIG_FALLBACK,
    ...validateRuntimeConfig(SYSTEM_DEFAULTS),
    ...validateRuntimeConfig(persisted),
    ...validateRuntimeConfig(explicitConfig),
  });
}

// eslint-disable-next-line no-var
var RuntimeConfig = Object.freeze({
  defaults: SYSTEM_DEFAULTS,
  safeFallback: SAFE_CONFIG_FALLBACK,
  validate: validateRuntimeConfig,
  resolve: resolveRuntimeConfig,
  getApiBaseUrl() { return SYSTEM_DEFAULTS.apiBaseUrl; },
  getCloudFunctionsUrl() { return SYSTEM_DEFAULTS.apiBaseUrl; },
  buildEndpointUrl(endpoint) {
    if (!/^[A-Za-z][A-Za-z0-9]{1,63}$/.test(endpoint || '')) {
      throw new TypeError('Invalid backend endpoint.');
    }
    return `${SYSTEM_DEFAULTS.apiBaseUrl}/${endpoint}`;
  },
});

// Backward-compatible global consumed by existing services.
// eslint-disable-next-line no-var
var API_BASE_URL = RuntimeConfig.getApiBaseUrl();
