// tests/modules/usage-repository.test.js - Unit tests for database/usage-repository.js

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules(['usage-repository.js']);
});

beforeEach(() => {
  resetChromeMocks();
});

describe('getUsageDate()', () => {
  it('should return today in YYYY-MM-DD format', () => {
    const date = getUsageDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(date).toBe(new Date().toISOString().split('T')[0]);
  });
});

describe('getTodayUsage()', () => {
  it('should return zeros if no usage recorded', async () => {
    const usage = await getTodayUsage();
    expect(usage.applications).toBe(0);
    expect(usage.hrMessages).toBe(0);
  });

  it('should return stored usage data', async () => {
    const key = `usage_${getUsageDate()}`;
    setMockStorageData({ [key]: { applications: 5, hrMessages: 2 } });

    const usage = await getTodayUsage();
    expect(usage.applications).toBe(5);
    expect(usage.hrMessages).toBe(2);
  });
});

describe('incrementApplicationCount()', () => {
  it('should increment from 0 to 1', async () => {
    const count = await incrementApplicationCount();
    expect(count).toBe(1);
  });

  it('should increment existing count', async () => {
    const key = `usage_${getUsageDate()}`;
    setMockStorageData({ [key]: { applications: 3, hrMessages: 1 } });

    const count = await incrementApplicationCount();
    expect(count).toBe(4);
  });

  it('should persist to chrome.storage', async () => {
    await incrementApplicationCount();
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });
});

describe('incrementHRMessageCount()', () => {
  it('should increment from 0 to 1', async () => {
    const count = await incrementHRMessageCount();
    expect(count).toBe(1);
  });

  it('should increment existing count', async () => {
    const key = `usage_${getUsageDate()}`;
    setMockStorageData({ [key]: { applications: 0, hrMessages: 5 } });

    const count = await incrementHRMessageCount();
    expect(count).toBe(6);
  });
});

describe('checkUsageLimit()', () => {
  it('should allow if under limit', async () => {
    const key = `usage_${getUsageDate()}`;
    setMockStorageData({ [key]: { applications: 2, hrMessages: 1 } });

    const result = await checkUsageLimit('applications', { applicationsPerDay: 3 });
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(2);
    expect(result.limit).toBe(3);
  });

  it('should deny if at limit', async () => {
    const key = `usage_${getUsageDate()}`;
    setMockStorageData({ [key]: { applications: 3, hrMessages: 0 } });

    const result = await checkUsageLimit('applications', { applicationsPerDay: 3 });
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(3);
  });

  it('should deny if over limit', async () => {
    const key = `usage_${getUsageDate()}`;
    setMockStorageData({ [key]: { applications: 5, hrMessages: 0 } });

    const result = await checkUsageLimit('applications', { applicationsPerDay: 3 });
    expect(result.allowed).toBe(false);
  });

  it('should always allow for Infinity limit (pro plan)', async () => {
    const key = `usage_${getUsageDate()}`;
    setMockStorageData({ [key]: { applications: 999, hrMessages: 0 } });

    const result = await checkUsageLimit('applications', { applicationsPerDay: Infinity });
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe('∞');
  });

  it('should check hrMessages limit correctly', async () => {
    const key = `usage_${getUsageDate()}`;
    setMockStorageData({ [key]: { applications: 0, hrMessages: 3 } });

    const result = await checkUsageLimit('hrMessages', { hrMessagesPerDay: 3 });
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(3);
  });

  it('should allow hrMessages if under limit', async () => {
    const key = `usage_${getUsageDate()}`;
    setMockStorageData({ [key]: { applications: 0, hrMessages: 1 } });

    const result = await checkUsageLimit('hrMessages', { hrMessagesPerDay: 3 });
    expect(result.allowed).toBe(true);
  });
});

describe('cleanupOldUsage()', () => {
  it('should remove usage data older than 7 days', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const oldKey = `usage_${oldDate.toISOString().split('T')[0]}`;
    const todayKey = `usage_${getUsageDate()}`;

    setMockStorageData({
      [oldKey]: { applications: 5, hrMessages: 3 },
      [todayKey]: { applications: 1, hrMessages: 0 },
      someOtherKey: 'value',
    });

    await cleanupOldUsage();

    expect(chrome.storage.local.remove).toHaveBeenCalled();
    const removedKeys = chrome.storage.local.remove.mock.calls[0][0];
    expect(removedKeys).toContain(oldKey);
  });

  it('should not remove recent usage data', async () => {
    const todayKey = `usage_${getUsageDate()}`;
    setMockStorageData({
      [todayKey]: { applications: 1, hrMessages: 0 },
    });

    await cleanupOldUsage();

    // remove should not be called (or called with empty array)
    const removeCalls = chrome.storage.local.remove.mock.calls;
    if (removeCalls.length > 0) {
      expect(removeCalls[0][0]).not.toContain(todayKey);
    }
  });

  it('should not remove non-usage keys', async () => {
    setMockStorageData({
      firstName: 'John',
      botRunning: false,
    });

    await cleanupOldUsage();

    // Should not try to remove non-usage keys
    const removeCalls = chrome.storage.local.remove.mock.calls;
    if (removeCalls.length > 0) {
      expect(removeCalls[0][0]).not.toContain('firstName');
      expect(removeCalls[0][0]).not.toContain('botRunning');
    }
  });
});
