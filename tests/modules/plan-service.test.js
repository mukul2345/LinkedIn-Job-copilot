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
  it('should allow applications for free user under limit', async () => {
    setMockStorageData({
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
      [`usage_${new Date().toISOString().split('T')[0]}`]: { applications: 1, hrMessages: 0 },
    });

    const result = await canPerformAction('applications');
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
    expect(result.limit).toBe(3);
  });

  it('should deny applications for free user at limit', async () => {
    setMockStorageData({
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
      [`usage_${new Date().toISOString().split('T')[0]}`]: { applications: 3, hrMessages: 0 },
    });

    const result = await canPerformAction('applications');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('limit reached');
    expect(result.reason).toContain('Upgrade to Pro');
  });

  it('should always allow applications for pro user', async () => {
    setMockStorageData({
      userPlan: 'pro',
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      planCachedAt: new Date().toISOString(),
      [`usage_${new Date().toISOString().split('T')[0]}`]: { applications: 100, hrMessages: 50 },
    });

    const result = await canPerformAction('applications');
    expect(result.allowed).toBe(true);
  });

  it('should deny AI answers for free user', async () => {
    setMockStorageData({
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
    });

    const result = await canPerformAction('aiAnswers');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Pro plan');
  });

  it('should allow AI answers for pro user', async () => {
    setMockStorageData({
      userPlan: 'pro',
      planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      planCachedAt: new Date().toISOString(),
    });

    const result = await canPerformAction('aiAnswers');
    expect(result.allowed).toBe(true);
  });

  it('should deny HR messages for free user at limit', async () => {
    setMockStorageData({
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
      [`usage_${new Date().toISOString().split('T')[0]}`]: { applications: 0, hrMessages: 3 },
    });

    const result = await canPerformAction('hrMessages');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('HR message');
  });

  it('should allow HR messages for free user under limit', async () => {
    setMockStorageData({
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
      [`usage_${new Date().toISOString().split('T')[0]}`]: { applications: 0, hrMessages: 2 },
    });

    const result = await canPerformAction('hrMessages');
    expect(result.allowed).toBe(true);
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
