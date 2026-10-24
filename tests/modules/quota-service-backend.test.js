jest.mock('firebase-functions', () => ({ https: { onRequest: handler => handler } }));
jest.mock('firebase-admin', () => ({ apps: [{}], firestore: jest.fn(), auth: jest.fn() }));

const { consumeQuota, getCurrentPeriod } = require('../../functions/quota-service');

function createDatabase(userDocument) {
  const userRef = { path: 'users/user-1' };
  const tx = {
    get: jest.fn(async () => ({ exists: true, data: () => userDocument })),
    set: jest.fn((_ref, update) => { userDocument.usage = update.usage; }),
  };
  return {
    tx,
    db: {
      collection: jest.fn(() => ({ doc: jest.fn(() => userRef) })),
      runTransaction: jest.fn(callback => callback(tx)),
    },
  };
}

describe('quota service application idempotency', () => {
  it('should consume once when the same final-submit attempt is retried', async () => {
    const user = { plan: 'free', usage: { period: getCurrentPeriod(), application: 0, outreach: 0 } };
    const { db, tx } = createDatabase(user);

    const first = await consumeQuota(db, 'user-1', 'application', false, 'linkedin:job-1');
    const retry = await consumeQuota(db, 'user-1', 'application', false, 'linkedin:job-1');

    expect(first).toMatchObject({ allowed: true, used: 1 });
    expect(first.idempotent).toBeUndefined();
    expect(retry).toMatchObject({ allowed: true, used: 1, idempotent: true });
    expect(tx.set).toHaveBeenCalledTimes(1);
  });

  it('should consume separate attempts independently', async () => {
    const user = { plan: 'free', usage: { period: getCurrentPeriod(), application: 0, outreach: 0 } };
    const { db } = createDatabase(user);

    await consumeQuota(db, 'user-1', 'application', false, 'linkedin:job-1');
    const second = await consumeQuota(db, 'user-1', 'application', false, 'linkedin:job-2');

    expect(second).toMatchObject({
      allowed: true,
      used: 2,
      limit: 10,
      period: getCurrentPeriod(),
      quotaPeriod: 'month',
    });
  });

  it('should not trust an admin role stored in the user document', async () => {
    const user = {
      role: 'admin',
      plan: 'free',
      usage: { period: getCurrentPeriod(), application: 10, outreach: 0 },
    };
    const { db } = createDatabase(user);

    await expect(consumeQuota(db, 'user-1', 'application', false, 'linkedin:job-11'))
      .resolves.toMatchObject({ allowed: false, used: 10, limit: 10, plan: 'free' });
  });

  it('should bypass only when verified token claims authorize admin access', async () => {
    const user = { role: 'user', plan: 'free', usage: {} };
    const { db, tx } = createDatabase(user);

    await expect(consumeQuota(db, 'user-1', 'application', true, 'linkedin:job-admin'))
      .resolves.toMatchObject({
        allowed: true,
        plan: 'pro',
        quotaPeriod: 'month',
      });
    expect(tx.get).not.toHaveBeenCalled();
  });
});
