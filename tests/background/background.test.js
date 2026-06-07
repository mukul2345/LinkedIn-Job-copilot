// tests/background/background.test.js - Unit tests for background.js (service worker)

const fs = require('fs');
const path = require('path');

beforeEach(() => {
  resetChromeMocks();
  // Reset the onMessage listeners
  chrome.runtime.onMessage.addListener.mockClear();

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

  it('should handle "start" action', () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://www.linkedin.com/feed/' }]);

    listener({ action: 'start' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ received: true });
  });

  it('should handle "stop" action', () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    // Mock tabs.query with callback style (used by stopBot)
    chrome.tabs.query.mockImplementation((query, callback) => {
      if (callback) callback([]);
    });

    listener({ action: 'stop' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ received: true });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ botRunning: false });
  });

  it('should handle "startHR" action', () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    chrome.tabs.query.mockResolvedValue([{ id: 2, url: 'https://www.linkedin.com/mynetwork/' }]);

    listener({ action: 'startHR' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ received: true });
  });

  it('should handle "stopHR" action', () => {
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = jest.fn();

    chrome.tabs.query.mockImplementation((query, callback) => {
      if (callback) callback([]);
    });

    listener({ action: 'stopHR' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ received: true });
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

    listener({ action: 'stop' }, {}, sendResponse);

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

    listener({ action: 'stopHR' }, {}, sendResponse);

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ hrBotRunning: false });
  });
});
