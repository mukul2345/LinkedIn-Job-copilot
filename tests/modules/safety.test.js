// tests/modules/safety.test.js - Unit tests for bot/safety.js

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules(['constants.js', 'plan-config.js', 'usage-repository.js', 'plan-service.js', 'safety.js']);
});

beforeEach(() => {
  resetChromeMocks();
});

describe('LINKEDIN_SAFETY_LIMITS', () => {
  it('should define application limits', () => {
    expect(LINKEDIN_SAFETY_LIMITS.applications.safe).toBe(25);
    expect(LINKEDIN_SAFETY_LIMITS.applications.warning).toBe(50);
    expect(LINKEDIN_SAFETY_LIMITS.applications.danger).toBe(80);
  });

  it('should define message limits', () => {
    expect(LINKEDIN_SAFETY_LIMITS.messages.safe).toBe(20);
    expect(LINKEDIN_SAFETY_LIMITS.messages.warning).toBe(35);
    expect(LINKEDIN_SAFETY_LIMITS.messages.danger).toBe(50);
  });

  it('should define minimum delays', () => {
    expect(LINKEDIN_SAFETY_LIMITS.minDelay.betweenApps).toBe(3);
    expect(LINKEDIN_SAFETY_LIMITS.minDelay.betweenMessages).toBe(20);
  });
});

describe('checkLinkedInSafety()', () => {
  const today = new Date().toISOString().split('T')[0];

  it('should return safe when under safe limit', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 10, hrMessages: 5 },
    });

    const result = await checkLinkedInSafety('applications');
    expect(result.level).toBe('safe');
    expect(result.message).toBeNull();
    expect(result.current).toBe(10);
  });

  it('should return warning when past safe limit', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 30, hrMessages: 0 },
    });

    const result = await checkLinkedInSafety('applications');
    expect(result.level).toBe('warning');
    expect(result.message).toContain('past the safe zone');
    expect(result.current).toBe(30);
  });

  it('should return warning when approaching danger', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 55, hrMessages: 0 },
    });

    const result = await checkLinkedInSafety('applications');
    expect(result.level).toBe('warning');
    expect(result.message).toContain('Approaching');
  });

  it('should return danger when at danger limit', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 80, hrMessages: 0 },
    });

    const result = await checkLinkedInSafety('applications');
    expect(result.level).toBe('danger');
    expect(result.message).toContain('STOP');
  });

  it('should check HR messages separately', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 5, hrMessages: 50 },
    });

    const result = await checkLinkedInSafety('hrMessages');
    expect(result.level).toBe('danger');
    expect(result.current).toBe(50);
  });

  it('should return safe for zero usage', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 0, hrMessages: 0 },
    });

    const result = await checkLinkedInSafety('applications');
    expect(result.level).toBe('safe');
    expect(result.current).toBe(0);
  });
});

describe('getAdaptiveDelay()', () => {
  const today = new Date().toISOString().split('T')[0];

  it('should return at least the minimum delay', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 5, hrMessages: 0 },
    });

    const delay = await getAdaptiveDelay('applications', 1000);
    // Minimum is 3s for applications (fast default floor).
    expect(delay).toBeGreaterThanOrEqual(3000);
  });

  it('should increase delay when past safe limit', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 30, hrMessages: 0 },
    });

    const delay = await getAdaptiveDelay('applications', 30000);
    // Should be 1.5x base (45s) ± jitter
    expect(delay).toBeGreaterThan(30000);
  });

  it('should double delay when past warning limit', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 55, hrMessages: 0 },
    });

    const delay = await getAdaptiveDelay('applications', 30000);
    // Should be 1.5x * 2x = 3x base (90s) ± jitter
    expect(delay).toBeGreaterThan(60000);
  });

  it('should use message delay for hrMessages', async () => {
    setMockStorageData({
      [`usage_${today}`]: { applications: 0, hrMessages: 5 },
    });

    const delay = await getAdaptiveDelay('hrMessages', 1000);
    // Minimum is 20s for messages.
    expect(delay).toBeGreaterThanOrEqual(20000);
  });
});

describe('checkSubscriptionExpiry()', () => {
  it('should return not expiring for admin', async () => {
    setMockStorageData({ userRole: 'admin' });

    const result = await checkSubscriptionExpiry();
    expect(result.expiring).toBe(false);
    expect(result.message).toBeNull();
  });

  it('should return not expiring for free plan', async () => {
    setMockStorageData({
      userRole: 'user',
      userPlan: 'free',
      planCachedAt: new Date().toISOString(),
    });

    const result = await checkSubscriptionExpiry();
    expect(result.expiring).toBe(false);
  });

  it('should warn when plan expires in 3 days', async () => {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    setMockStorageData({
      userRole: 'user',
      userPlan: 'pro',
      planExpiresAt: threeDaysFromNow.toISOString(),
      planCachedAt: new Date().toISOString(),
    });

    const result = await checkSubscriptionExpiry();
    expect(result.expiring).toBe(true);
    expect(result.daysLeft).toBeLessThanOrEqual(3);
    expect(result.message).toContain('expires');
  });

  it('should warn when plan expires in 1 day', async () => {
    const tomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    setMockStorageData({
      userRole: 'user',
      userPlan: 'pro',
      planExpiresAt: tomorrow.toISOString(),
      planCachedAt: new Date().toISOString(),
    });

    const result = await checkSubscriptionExpiry();
    expect(result.expiring).toBe(true);
    expect(result.daysLeft).toBeLessThanOrEqual(1);
    expect(result.message).toContain('tomorrow');
  });

  it('should alert when plan already expired', async () => {
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    setMockStorageData({
      userRole: 'user',
      userPlan: 'pro',
      planExpiresAt: yesterday.toISOString(),
      planCachedAt: new Date().toISOString(),
    });

    const result = await checkSubscriptionExpiry();
    expect(result.expiring).toBe(true);
    expect(result.daysLeft).toBe(0);
    expect(result.message).toContain('expired');
  });

  it('should not warn when plan has 30+ days left', async () => {
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    setMockStorageData({
      userRole: 'user',
      userPlan: 'pro',
      planExpiresAt: farFuture.toISOString(),
      planCachedAt: new Date().toISOString(),
    });

    const result = await checkSubscriptionExpiry();
    expect(result.expiring).toBe(false);
    expect(result.message).toBeNull();
  });
});
