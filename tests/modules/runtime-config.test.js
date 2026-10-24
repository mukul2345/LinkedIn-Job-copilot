const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => loadFile(path.resolve(__dirname, '../../extension/core/runtime-config.js')));
beforeEach(() => resetChromeMocks());

describe('runtime configuration', () => {
  it('uses explicit then persisted then defaults then safe fallback precedence', async () => {
    const resolved = await resolveRuntimeConfig(
      { requestTimeoutMs: 5000 },
      { requestTimeoutMs: 7000, gmailScanIntervalMinutes: 60 }
    );
    expect(resolved.requestTimeoutMs).toBe(5000);
    expect(resolved.gmailScanIntervalMinutes).toBe(60);
    expect(resolved.apiBaseUrl).toBe(SYSTEM_DEFAULTS.apiBaseUrl);
    expect(resolved.apiVersion).toBe(SAFE_CONFIG_FALLBACK.apiVersion);
  });

  it('ignores invalid persisted and explicit values', async () => {
    const resolved = await resolveRuntimeConfig(
      { apiBaseUrl: 'javascript:alert(1)', requestTimeoutMs: 1 },
      { apiBaseUrl: 'http://insecure.test', gmailScanIntervalMinutes: -1 }
    );
    expect(resolved.apiBaseUrl).toBe(SYSTEM_DEFAULTS.apiBaseUrl);
    expect(resolved.requestTimeoutMs).toBe(SYSTEM_DEFAULTS.requestTimeoutMs);
    expect(resolved.gmailScanIntervalMinutes).toBe(SYSTEM_DEFAULTS.gmailScanIntervalMinutes);
  });
});
