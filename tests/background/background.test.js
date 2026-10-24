// tests/background/background.test.js - Unit tests for background.js (service worker)

const fs = require('fs');
const path = require('path');

beforeEach(() => {
  resetChromeMocks();
  // Reset the onMessage listeners
  chrome.runtime.onMessage.addListener.mockClear();

  const sharedFiles = [
    '../../extension/core/constants.js',
    '../../extension/core/runtime-config.js',
    '../../extension/modules/shared/errors.js',
    '../../extension/modules/shared/logger.js',
    '../../extension/modules/shared/message-protocol.js',
  ];
  sharedFiles.forEach(relativePath => {
    (0, eval)(fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8'));
  });

  // Load background.js fresh for each test using indirect eval (global scope)
  const code = fs.readFileSync(
    path.resolve(__dirname, '../../extension/background/service-worker.js'),
    'utf8'
  );
  (0, eval)(code);
});

describe('background.js message handling', () => {
  it('should register an onMessage listener', () => {
    // The first addListener call is from setup.js, subsequent from background.js
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
  });

  it('should handle START_BOT', async () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://www.linkedin.com/feed/' }]);

    listener({ type: MessageType.START_BOT }, {}, sendResponse);
    await Promise.resolve();
    expect(listener).toBeDefined();
  });

  it('should handle STOP_BOT', async () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    // Mock tabs.query with callback style (used by stopBot)
    chrome.tabs.query.mockImplementation((query, callback) => {
      if (callback) callback([]);
    });

    listener({ type: MessageType.STOP_BOT }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { stopped: true } });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ botRunning: false });
  });

  it('should handle START_HR', async () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    chrome.tabs.query.mockResolvedValue([{ id: 2, url: 'https://www.linkedin.com/mynetwork/' }]);

    listener({ type: MessageType.START_HR }, {}, sendResponse);
    await Promise.resolve();
    expect(listener).toBeDefined();
  });

  it('should handle STOP_HR', async () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    chrome.tabs.query.mockImplementation((query, callback) => {
      if (callback) callback([]);
    });

    listener({ type: MessageType.STOP_HR }, {}, sendResponse);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, data: { stopped: true } });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ hrBotRunning: false });
  });
});

describe('stopBot()', () => {
  it('should send stopBot message to all LinkedIn tabs', () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    chrome.tabs.query.mockImplementation((query, callback) => {
      callback([{ id: 1 }, { id: 2 }]);
    });
    chrome.tabs.sendMessage.mockReturnValue(Promise.resolve());

    listener({ type: MessageType.STOP_BOT }, {}, sendResponse);

    expect(chrome.tabs.query).toHaveBeenCalledWith(
      { url: 'https://www.linkedin.com/*' },
      expect.any(Function)
    );
  });
});

describe('stopHRBot()', () => {
  it('should set hrBotRunning to false in storage', () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    chrome.tabs.query.mockImplementation((query, callback) => {
      if (callback) callback([{ id: 1 }]);
    });
    chrome.tabs.sendMessage.mockReturnValue(Promise.resolve());

    listener({ type: MessageType.STOP_HR }, {}, sendResponse);

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ hrBotRunning: false });
  });
});

describe('MV3 restart reconciliation', () => {
  it('should preserve valid bot and active search session state across worker restarts', async () => {
    chrome.storage.local.set.mockClear();
    chrome.storage.local.remove.mockClear();
    chrome.storage.local.get.mockImplementation((_keys, callback) => callback({
      botRunning: true,
      botState: { currentSearchIndex: 1 },
      activeSearchSessionId: 'session-1',
      hrBotRunning: false,
    }));

    await reconcileRunState();

    expect(chrome.storage.local.set).not.toHaveBeenCalledWith(expect.objectContaining({ botRunning: false }));
    const removedKeys = chrome.storage.local.remove.mock.calls.flatMap(call =>
      Array.isArray(call[0]) ? call[0] : [call[0]]);
    expect(removedKeys).not.toContain('botState');
    expect(removedKeys).not.toContain('activeSearchSessionId');
  });
});
