// tests/modules/plan-service.test.js - Unit tests for subscription/plan-service.js

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  // plan-service depends on constants, plan-config and usage-repository
  loadModules(['constants.js', 'plan-config.js', 'usage-repository.js', 'plan-service.js']);
});

beforeEach(() => {
  resetChromeMocks();
});

describe('getUserPlanStatus()', () => {
  it('should return free plan if no cache exists', async () => {
    const status = await getUserPlanStatus();
    expect(status.plan).toBe('free');
    expect(status.isActive).toBe(true);
  });

  it('should return cached plan if cache is fresh (< 5 min)', async () => {
    setMockStorageData({
      userPlan: 'pro',
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      planCachedAt: new Date().toISOString(), // Just cached
    });

    const status = await getUserPlanStatus();
    expect(status.plan).toBe('pro');
    expect(status.isActive).toBe(true);
  });

  it('should detect expired pro plan', async () => {
    setMockStorageData({
      userPlan: 'pro',
      planExpiresAt: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
      planCachedAt: new Date().toISOString(),
    });

    const status = await getUserPlanStatus();
    expect(status.plan).toBe('pro');
    expect(status.isActive).toBe(false);
  });

  it('should always consider free plan as active', async () => {
    setMockStorageData({
      userPlan: 'free',
      planExpiresAt: null,
      planCachedAt: new Date().toISOString(),
    });

    const status = await getUserPlanStatus();
    expect(status.plan).toBe('free');
    expect(status.isActive).toBe(true);
  });
});

describe('canPerformAction()', () => {
  it('should defer application quota authorization to the server', async () => {
    setMockStorageData({ userPlan: 'free' });

    const result = await canPerformAction('applications');

    expect(result).toEqual({
      allowed: true,
      current: null,
      limit: 10,
      reason: 'Monthly quota is verified by the server immediately before the action.',
    });
  });

  it('should expose the Pro monthly application limit without claiming unlimited access', async () => {
    setMockStorageData({
      userPlan: 'pro',
      planExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    await expect(canPerformAction('applications')).resolves.toMatchObject({
      allowed: true,
      current: null,
      limit: 50,
    });
  });

  it('should expose the free monthly outreach limit', async () => {
    setMockStorageData({ userPlan: 'free' });
    await expect(canPerformAction('hrMessages')).resolves.toMatchObject({
      allowed: true,
      limit: 10,
    });
  });

  it('should deny AI answers for free user', async () => {
    setMockStorageData({ userPlan: 'free' });
    await expect(canPerformAction('aiAnswers')).resolves.toMatchObject({
      allowed: false,
      reason: 'AI answers require Pro plan.',
    });
  });

  it('should allow AI answers for an active Pro user', async () => {
    setMockStorageData({
      userPlan: 'pro',
      planExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await expect(canPerformAction('aiAnswers')).resolves.toMatchObject({ allowed: true });
  });
});

describe('isProUser()', () => {
  it('should return false for free user', async () => {
    setMockStorageData({
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
    });

    const result = await isProUser();
    expect(result).toBe(false);
  });

  it('should return true for active pro user', async () => {
    setMockStorageData({
      userPlan: 'pro',
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      planCachedAt: new Date().toISOString(),
    });

    const result = await isProUser();
    expect(result).toBe(true);
  });

  it('should return false for expired pro user', async () => {
    setMockStorageData({
      userPlan: 'pro',
      planExpiresAt: new Date(Date.now() - 1000).toISOString(),
      planCachedAt: new Date().toISOString(),
    });

    const result = await isProUser();
    expect(result).toBe(false);
  });
});

describe('cachePlanLocally()', () => {
  it('should store plan data in chrome.storage', async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await cachePlanLocally('pro', expiresAt);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userPlan: 'pro',
        planExpiresAt: expiresAt.toISOString(),
      }),
      expect.any(Function)
    );
  });

  it('should handle null expiresAt', async () => {
    await cachePlanLocally('free', null);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userPlan: 'free',
        planExpiresAt: null,
      }),
      expect.any(Function)
    );
  });
});
