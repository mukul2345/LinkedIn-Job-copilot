// Regression tests for server-authoritative quota decisions.

const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/core/runtime-config.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/message-protocol.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/api-client.js'));
});

beforeEach(() => {
  resetChromeMocks();
  jest.spyOn(console, 'warn').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('consumeQuota()', () => {
  it('allows a verified admin result returned by the server', async () => {
    global.callBackend = jest.fn().mockResolvedValue({
      allowed: true,
      used: 0,
      limit: Number.MAX_SAFE_INTEGER,
      plan: 'pro',
    });

    const quota = await consumeQuota('application', 'linkedin:job-42');

    expect(global.callBackend).toHaveBeenCalledWith('checkAndConsumeQuota', {
      type: 'application',
      idempotencyKey: 'linkedin:job-42',
    });
    expect(quota.allowed).toBe(true);
    expect(quota.plan).toBe('pro');
  });

  it('does not trust a locally cached admin role', async () => {
    setMockStorageData({ userRole: 'admin' });
    global.callBackend = jest.fn().mockRejectedValue(
      Object.assign(new Error('network down'), { code: 'NETWORK_ERROR' })
    );

    const quota = await consumeQuota('outreach');

    expect(global.callBackend).toHaveBeenCalledTimes(1);
    expect(quota).toMatchObject({ allowed: false, errorCode: 'NETWORK_ERROR' });
  });

  it('preserves a server-reported quota service failure', async () => {
    global.callBackend = jest.fn().mockResolvedValue({
      allowed: false,
      used: 0,
      limit: 0,
      plan: 'unknown',
      errorCode: 'QUOTA_UNAVAILABLE',
    });

    const quota = await consumeQuota('application', 'linkedin:job-service-failure');

    expect(quota).toEqual({
      allowed: false,
      used: 0,
      limit: 0,
      plan: 'unknown',
      errorCode: 'QUOTA_UNAVAILABLE',
    });
  });

  it('returns no errorCode for genuine quota exhaustion', async () => {
    global.callBackend = jest.fn().mockResolvedValue({
      allowed: false,
      used: 10,
      limit: 10,
      plan: 'free',
    });

    const quota = await consumeQuota('application', 'linkedin:job-exhausted');

    expect(quota).toEqual({ allowed: false, used: 10, limit: 10, plan: 'free' });
    expect(quota.errorCode).toBeUndefined();
  });

  it('fails closed with a fallback code when the backend throws a plain error', async () => {
    global.callBackend = jest.fn().mockRejectedValue(new Error('boom'));

    const quota = await consumeQuota('application', 'linkedin:job-network');

    expect(quota).toMatchObject({
      allowed: false,
      plan: 'unknown',
      errorCode: 'QUOTA_CHECK_FAILED',
    });
  });

  it('fails closed before the request when an application key is missing', async () => {
    global.callBackend = jest.fn();

    await expect(consumeQuota('application')).resolves.toMatchObject({
      allowed: false,
      errorCode: 'INVALID_IDEMPOTENCY_KEY',
    });
    expect(global.callBackend).not.toHaveBeenCalled();
  });
});