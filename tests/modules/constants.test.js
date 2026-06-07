// tests/modules/constants.test.js - Unit tests for core/constants.js

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules(['constants.js']);
});

describe('Constants', () => {
  it('should define APP_NAME', () => {
    expect(APP_NAME).toBe('JobPilot AI');
  });

  it('should define APP_VERSION', () => {
    expect(APP_VERSION).toBeDefined();
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should define USER_ROLES with admin and user', () => {
    expect(USER_ROLES).toBeDefined();
    expect(USER_ROLES.ADMIN).toBe('admin');
    expect(USER_ROLES.USER).toBe('user');
  });

  it('should define PLAN_TYPES with free and pro', () => {
    expect(PLAN_TYPES).toBeDefined();
    expect(PLAN_TYPES.FREE).toBe('free');
    expect(PLAN_TYPES.PRO).toBe('pro');
  });

  it('should define USER_ID_PREFIX', () => {
    expect(USER_ID_PREFIX).toBe('USR');
  });
});
