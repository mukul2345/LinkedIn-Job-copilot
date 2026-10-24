// tests/modules/admin-role.test.js - Tests for admin role behavior

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules(['constants.js', 'plan-config.js', 'usage-repository.js', 'plan-service.js']);
});

beforeEach(() => {
  resetChromeMocks();
});

describe('Cached admin role is non-authoritative', () => {
  it('should not elevate a cached free plan', async () => {
    setMockStorageData({ userRole: 'admin', userPlan: 'free' });

    const status = await getUserPlanStatus();

    expect(status).toMatchObject({ plan: 'free', isActive: true, role: 'admin' });
    await expect(isProUser()).resolves.toBe(false);
  });

  it('should not bypass monthly limits from local role storage', async () => {
    setMockStorageData({ userRole: 'admin', userPlan: 'free' });

    await expect(canPerformAction('applications')).resolves.toMatchObject({
      allowed: true,
      current: null,
      limit: 10,
    });
    await expect(canPerformAction('hrMessages')).resolves.toMatchObject({ limit: 10 });
    await expect(canPerformAction('aiAnswers')).resolves.toMatchObject({ allowed: false });
  });

  it('should recognize only an active cached Pro subscription for display', async () => {
    setMockStorageData({
      userRole: 'admin',
      userPlan: 'pro',
      planExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    await expect(isProUser()).resolves.toBe(true);
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
