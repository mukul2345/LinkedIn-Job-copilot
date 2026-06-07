// tests/setup.js - Global test setup
// Mocks Chrome extension APIs that are used across all modules

// Mock chrome.runtime
const mockSendMessage = jest.fn().mockResolvedValue(undefined);
const mockOnMessageAddListener = jest.fn();

// Mock chrome.storage.local
const mockStorageData = {};
const mockStorageGet = jest.fn((keys, callback) => {
  if (typeof keys === 'string') {
    callback({ [keys]: mockStorageData[keys] });
  } else if (Array.isArray(keys)) {
    const result = {};
    keys.forEach(k => { result[k] = mockStorageData[k]; });
    callback(result);
  } else if (keys === null) {
    callback({ ...mockStorageData });
  } else {
    callback({});
  }
});

const mockStorageSet = jest.fn((data, callback) => {
  Object.assign(mockStorageData, data);
  if (callback) callback();
});

const mockStorageRemove = jest.fn((keys, callback) => {
  if (typeof keys === 'string') {
    delete mockStorageData[keys];
  } else if (Array.isArray(keys)) {
    keys.forEach(k => delete mockStorageData[k]);
  }
  if (callback) callback();
});

const mockStorageClear = jest.fn((callback) => {
  Object.keys(mockStorageData).forEach(k => delete mockStorageData[k]);
  if (callback) callback();
});

// Mock chrome.tabs
const mockTabsQuery = jest.fn().mockResolvedValue([]);
const mockTabsCreate = jest.fn().mockResolvedValue({ id: 1 });
const mockTabsUpdate = jest.fn().mockResolvedValue({});
const mockTabsSendMessage = jest.fn().mockResolvedValue({});
const mockTabsGet = jest.fn((tabId, callback) => callback({ status: 'complete' }));
const mockTabsOnUpdatedAddListener = jest.fn();
const mockTabsOnUpdatedRemoveListener = jest.fn();

// Mock chrome.notifications
const mockNotificationsCreate = jest.fn();

// Assemble the global chrome mock
global.chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: {
      addListener: mockOnMessageAddListener,
    },
    onInstalled: {
      addListener: jest.fn(),
    },
    lastError: null,
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
      clear: mockStorageClear,
    },
  },
  tabs: {
    query: mockTabsQuery,
    create: mockTabsCreate,
    update: mockTabsUpdate,
    sendMessage: mockTabsSendMessage,
    get: mockTabsGet,
    onUpdated: {
      addListener: mockTabsOnUpdatedAddListener,
      removeListener: mockTabsOnUpdatedRemoveListener,
    },
  },
  notifications: {
    create: mockNotificationsCreate,
  },
};

// Helper to reset all mocks between tests
global.resetChromeMocks = () => {
  mockSendMessage.mockClear();
  mockOnMessageAddListener.mockClear();
  mockStorageGet.mockClear();
  mockStorageSet.mockClear();
  mockStorageRemove.mockClear();
  mockStorageClear.mockClear();
  mockTabsQuery.mockClear();
  mockTabsCreate.mockClear();
  mockTabsUpdate.mockClear();
  mockTabsSendMessage.mockClear();
  mockNotificationsCreate.mockClear();
  // Clear stored data
  Object.keys(mockStorageData).forEach(k => delete mockStorageData[k]);
};

// Helper to set mock storage data for tests
global.setMockStorageData = (data) => {
  Object.assign(mockStorageData, data);
};

// Mock document.execCommand (deprecated but used for contenteditable)
document.execCommand = jest.fn().mockReturnValue(true);

// Mock MutationObserver
global.MutationObserver = class {
  constructor(callback) {
    this.callback = callback;
    this.observe = jest.fn();
    this.disconnect = jest.fn();
  }
};

// Mock Element.scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = jest.fn();
