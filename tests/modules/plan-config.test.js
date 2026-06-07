// tests/modules/plan-config.test.js - Unit tests for subscription/plan-config.js

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules(['plan-config.js']);
});

describe('PLANS', () => {
  it('should define free and pro plans', () => {
    expect(PLANS.free).toBeDefined();
    expect(PLANS.pro).toBeDefined();
  });

  it('free plan should have id "free"', () => {
    expect(PLANS.free.id).toBe('free');
    expect(PLANS.free.name).toBe('Free');
  });

  it('pro plan should have id "pro"', () => {
    expect(PLANS.pro.id).toBe('pro');
    expect(PLANS.pro.name).toBe('Pro');
  });

  it('free plan should have limited applications per day', () => {
    expect(PLANS.free.limits.applicationsPerDay).toBe(3);
  });

  it('free plan should have limited HR messages per day', () => {
    expect(PLANS.free.limits.hrMessagesPerDay).toBe(3);
  });

  it('free plan should not allow AI answers', () => {
    expect(PLANS.free.limits.aiAnswers).toBe(false);
  });

  it('pro plan should have unlimited applications', () => {
    expect(PLANS.pro.limits.applicationsPerDay).toBe(Infinity);
  });

  it('pro plan should have unlimited HR messages', () => {
    expect(PLANS.pro.limits.hrMessagesPerDay).toBe(Infinity);
  });

  it('pro plan should allow AI answers', () => {
    expect(PLANS.pro.limits.aiAnswers).toBe(true);
  });

  it('free plan should limit search terms to 3', () => {
    expect(PLANS.free.limits.searchTerms).toBe(3);
  });

  it('pro plan should have unlimited search terms', () => {
    expect(PLANS.pro.limits.searchTerms).toBe(Infinity);
  });
});

describe('PRICING', () => {
  it('should define monthly, quarterly, half_yearly, yearly', () => {
    expect(PRICING.monthly).toBeDefined();
    expect(PRICING.quarterly).toBeDefined();
    expect(PRICING.half_yearly).toBeDefined();
    expect(PRICING.yearly).toBeDefined();
  });

  it('monthly should be ₹299', () => {
    expect(PRICING.monthly.price).toBe(299);
    expect(PRICING.monthly.currency).toBe('INR');
  });

  it('quarterly should be ₹699', () => {
    expect(PRICING.quarterly.price).toBe(699);
  });

  it('half_yearly should be ₹1499', () => {
    expect(PRICING.half_yearly.price).toBe(1499);
  });

  it('yearly should be ₹2999', () => {
    expect(PRICING.yearly.price).toBe(2999);
  });

  it('yearly should be marked as popular', () => {
    expect(PRICING.yearly.popular).toBe(true);
  });

  it('quarterly should show savings', () => {
    expect(PRICING.quarterly.savings).toBeTruthy();
  });

  it('each period should have correct day count', () => {
    expect(PRICING.monthly.period).toBe(30);
    expect(PRICING.quarterly.period).toBe(90);
    expect(PRICING.half_yearly.period).toBe(180);
    expect(PRICING.yearly.period).toBe(365);
  });
});

describe('getPlanLimits()', () => {
  it('should return free limits for "free"', () => {
    const limits = getPlanLimits('free');
    expect(limits.applicationsPerDay).toBe(3);
    expect(limits.hrMessagesPerDay).toBe(3);
  });

  it('should return pro limits for "pro"', () => {
    const limits = getPlanLimits('pro');
    expect(limits.applicationsPerDay).toBe(Infinity);
  });

  it('should return free limits for unknown plan', () => {
    const limits = getPlanLimits('unknown');
    expect(limits.applicationsPerDay).toBe(3);
  });

  it('should return free limits for undefined', () => {
    const limits = getPlanLimits(undefined);
    expect(limits.applicationsPerDay).toBe(3);
  });
});

describe('getPricing()', () => {
  it('should return correct pricing for monthly', () => {
    const p = getPricing('monthly');
    expect(p.price).toBe(299);
    expect(p.label).toBe('1 Month');
  });

  it('should return correct pricing for yearly', () => {
    const p = getPricing('yearly');
    expect(p.price).toBe(2999);
  });

  it('should default to monthly for unknown period', () => {
    const p = getPricing('unknown');
    expect(p.price).toBe(299);
  });
});

describe('getAllPricingOptions()', () => {
  it('should return array of 4 options', () => {
    const options = getAllPricingOptions();
    expect(Array.isArray(options)).toBe(true);
    expect(options.length).toBe(4);
  });

  it('should include all periods', () => {
    const options = getAllPricingOptions();
    const ids = options.map(o => o.id);
    expect(ids).toContain('monthly');
    expect(ids).toContain('quarterly');
    expect(ids).toContain('half_yearly');
    expect(ids).toContain('yearly');
  });
});
