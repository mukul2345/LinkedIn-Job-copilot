const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeEach(() => {
  resetChromeMocks();
  global.sleep = jest.fn().mockResolvedValue();
  global.SELECTORS = {};
  global.startBot = jest.fn();
  global.stopBot = jest.fn();
  global.startHROutreach = jest.fn();
  global.log = jest.fn();
  jest.spyOn(console, 'log').mockImplementation();
});

afterEach(() => {
  delete global.sleep;
  delete global.SELECTORS;
  delete global.startBot;
  delete global.stopBot;
  delete global.startHROutreach;
  delete global.log;
  jest.restoreAllMocks();
});

describe('content startup security and resume state', () => {
  it('should delete legacy credential keys and read the HR state timestamp', () => {
    loadFile(path.resolve(__dirname, '../../extension/modules/shared/errors.js'));
    loadFile(path.resolve(__dirname, '../../extension/modules/shared/logger.js'));
    loadFile(path.resolve(__dirname, '../../extension/modules/shared/message-protocol.js'));
    loadFile(path.resolve(__dirname, '../../extension/content/content.js'));

    expect(chrome.storage.local.remove).toHaveBeenCalledWith([
      'linkedinEmail',
      'linkedinPassword',
      'credentialsObfuscated',
      'credentialOwnerUid',
      'pendingAutoLogin',
    ]);
    expect(chrome.storage.local.get).toHaveBeenCalledWith(
      ['botRunning', 'botState', 'hrBotRunning', 'hrBotState', 'hrBotStateTimestamp'],
      expect.any(Function),
    );
  });
});
