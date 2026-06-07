// tests/modules/admin-role.test.js - Tests for admin role behavior

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules(['constants.js', 'plan-config.js', 'usage-repository.js', 'plan-service.js']);
});

beforeEach(() => {
  resetChromeMocks();
});

describe('Admin role - getUserPlanStatus()', () => {
  it('should return pro plan with no expiry for admin users', async () => {
    setMockStorageData({
      userRole: 'admin',
      userPlan: 'pro',
    });

    const status = await getUserPlanStatus();
    expect(status.plan).toBe('pro');
    expect(status.isActive).toBe(true);
    expect(status.expiresAt).toBeNull();
    expect(status.role).toBe('admin');
  });

  it('should return pro even if userPlan is free but role is admin', async () => {
    setMockStorageData({
      userRole: 'admin',
      userPlan: 'free', // This shouldn't matter for admin
    });

    const status = await getUserPlanStatus();
    expect(status.plan).toBe('pro');
    expect(status.isActive).toBe(true);
  });

  it('should return role field in response', async () => {
    setMockStorageData({
      userRole: 'user',
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
    });

    const status = await getUserPlanStatus();
    expect(status.role).toBe('user');
  });
});

describe('Admin role - canPerformAction()', () => {
  it('should bypass all limits for admin users', async () => {
    setMockStorageData({
      userRole: 'admin',
      [`usage_${new Date().toISOString().split('T')[0]}`]: { applications: 999, hrMessages: 999 },
    });

    const appResult = await canPerformAction('applications');
    expect(appResult.allowed).toBe(true);
    expect(appResult.limit).toBe('∞');

    const hrResult = await canPerformAction('hrMessages');
    expect(hrResult.allowed).toBe(true);

    const aiResult = await canPerformAction('aiAnswers');
    expect(aiResult.allowed).toBe(true);
  });

  it('should NOT bypass limits for regular users', async () => {
    setMockStorageData({
      userRole: 'user',
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
      [`usage_${new Date().toISOString().split('T')[0]}`]: { applications: 3, hrMessages: 0 },
    });

    const result = await canPerformAction('applications');
    expect(result.allowed).toBe(false);
  });
});

describe('Admin role - isProUser()', () => {
  it('should return true for admin regardless of plan field', async () => {
    setMockStorageData({
      userRole: 'admin',
      userPlan: 'free',
    });

    const result = await isProUser();
    expect(result).toBe(true);
  });

  it('should return false for regular user on free plan', async () => {
    setMockStorageData({
      userRole: 'user',
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
    });

    const result = await isProUser();
    expect(result).toBe(false);
  });
});

describe('cacheUserRoleAndPlan()', () => {
  it('should store role, plan, and expiry in chrome.storage', async () => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await cacheUserRoleAndPlan('user', 'pro', expiresAt);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userRole: 'user',
        userPlan: 'pro',
        planExpiresAt: expiresAt.toISOString(),
      }),
      expect.any(Function)
    );
  });

  it('should handle admin with null expiry', async () => {
    await cacheUserRoleAndPlan('admin', 'pro', null);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userRole: 'admin',
        userPlan: 'pro',
        planExpiresAt: null,
      }),
      expect.any(Function)
    );
  });
});
