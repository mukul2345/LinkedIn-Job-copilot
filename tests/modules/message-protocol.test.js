const path = require('path');
const { loadFile } = require('../helpers/load-modules');

beforeAll(() => loadFile(path.resolve(__dirname, '../../extension/modules/shared/message-protocol.js')));
beforeEach(() => resetChromeMocks());

describe('message protocol', () => {
  it('validates allowlisted typed messages', () => {
    expect(MessageProtocol.validate({ type: MessageType.START_BOT })).toEqual(
      expect.objectContaining({ valid: true })
    );
    expect(MessageProtocol.validate({
      type: MessageType.CREATE_SEARCH_SESSION,
      criteria: { titles: ['Engineer'], platforms: ['linkedin'] },
    }).valid).toBe(true);
    expect(MessageProtocol.validate({
      type: MessageType.GET_SEARCH_SESSION,
      sessionId: 'session-1',
      page: 2,
    }).valid).toBe(true);
    expect(MessageProtocol.validate({
      type: MessageType.STATUS,
      applied: 1,
      skipped: 2,
      failed: 0,
    }).valid).toBe(true);
  });

  it('rejects unknown types and invalid payloads', () => {
    expect(MessageProtocol.validate({ type: 'UNKNOWN' })).toEqual({
      valid: false,
      error: 'UNKNOWN_MESSAGE_TYPE',
    });
    expect(MessageProtocol.validate({ type: MessageType.NOTIFICATION, message: '' }).valid).toBe(false);
    expect(MessageProtocol.validate({
      type: MessageType.BACKEND_REQUEST,
      endpoint: 'deleteEverything',
      body: {},
    }).valid).toBe(false);
  });

  it('rejects a mismatched runtime sender id', () => {
    chrome.runtime.id = 'extension-id';
    expect(MessageProtocol.validateSender({ id: 'other-extension' })).toBe(false);
    expect(MessageProtocol.validateSender({ id: 'extension-id' })).toBe(true);
  });
});
