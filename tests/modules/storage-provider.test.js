const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => loadFile(path.resolve(__dirname, '../../extension/modules/shared/storage-provider.js')));
beforeEach(() => resetChromeMocks());

describe('StorageProvider', () => {
  it('supports CRUD through a Chrome storage area', async () => {
    const provider = new StorageProvider(chrome.storage.local);
    await provider.set('setting', { enabled: true });
    expect(await provider.get('setting')).toEqual({ enabled: true });
    await provider.remove('setting');
    expect(await provider.get('setting', 'fallback')).toBe('fallback');
  });

  it('isolates namespaced keys', async () => {
    const provider = new StorageProvider(chrome.storage.local).namespace('user');
    await provider.set('theme', 'dark');
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { 'user:theme': 'dark' },
      expect.any(Function)
    );
    expect(await provider.get('theme')).toBe('dark');
  });

  it('rejects invalid keys and namespaces', async () => {
    const provider = new StorageProvider(chrome.storage.local);
    await expect(provider.set('', true)).rejects.toThrow('Storage key');
    expect(() => provider.namespace('../unsafe')).toThrow('namespace');
  });
});
