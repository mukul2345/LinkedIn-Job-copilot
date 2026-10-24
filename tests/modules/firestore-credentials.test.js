// Regression tests for deletion-only legacy LinkedIn credential cleanup.

const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => {
  loadFile(path.resolve(
    __dirname,
    '../../extension/modules/shared/logger.js'
  ));
  loadFile(path.resolve(
    __dirname,
    '../../extension/modules/database/credential-migration.js'
  ));
});

beforeEach(() => {
  resetChromeMocks();
  global.invalidateCache = jest.fn().mockResolvedValue();
  global.firebase = {
    firestore: {
      FieldValue: {
        delete: jest.fn(() => 'DELETE_FIELD'),
        serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
      },
    },
  };
  global.userDocumentUpdate = jest.fn().mockResolvedValue();
  global.botSettingsSet = jest.fn().mockResolvedValue();
  global.dailyStatsSet = jest.fn().mockResolvedValue();
  global.db = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        update: global.userDocumentUpdate,
        collection: jest.fn(collectionName => ({
          doc: jest.fn(() => ({
            set: collectionName === 'settings'
              ? global.botSettingsSet
              : global.dailyStatsSet,
          })),
        })),
      })),
    })),
  };
  global.getCurrentUser = jest.fn(() => ({ uid: 'user-1' }));
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
});

afterEach(() => {
  delete global.invalidateCache;
  delete global.firebase;
  delete global.userDocumentUpdate;
  delete global.botSettingsSet;
  delete global.dailyStatsSet;
  delete global.db;
  delete global.getCurrentUser;
  jest.restoreAllMocks();
});
describe('legacy LinkedIn credential cleanup', () => {
  it('should remove all local credential and auto-login keys without copying values', async () => {
    setMockStorageData({
      linkedinEmail: 'encoded-email',
      linkedinPassword: 'encoded-password',
      credentialsObfuscated: true,
      credentialOwnerUid: 'user-1',
      pendingAutoLogin: true,
    });

    await expect(removeLegacyLinkedInCredentials('user-1')).resolves.toBe(true);

    expect(chrome.storage.local.remove).toHaveBeenCalledWith(
      [
        'linkedinEmail',
        'linkedinPassword',
        'credentialsObfuscated',
        'credentialOwnerUid',
        'pendingAutoLogin',
      ],
      expect.any(Function),
    );
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(global.userDocumentUpdate).toHaveBeenCalledWith({
      linkedinCredentials: 'DELETE_FIELD',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('should keep local cleanup successful when legacy Firestore deletion fails', async () => {
    global.userDocumentUpdate.mockRejectedValueOnce(new Error('offline'));

    await expect(removeLegacyLinkedInCredentials('user-1')).resolves.toBe(false);

    expect(chrome.storage.local.remove).toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
