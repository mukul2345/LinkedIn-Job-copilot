// message-protocol.js - Typed and allowlisted extension messaging.

// eslint-disable-next-line no-var
var MessageType = Object.freeze({
  START_BOT: 'START_BOT',
  STOP_BOT: 'STOP_BOT',
  START_HR: 'START_HR',
  STOP_HR: 'STOP_HR',
  CONTENT_START_BOT: 'CONTENT_START_BOT',
  CONTENT_STOP_BOT: 'CONTENT_STOP_BOT',
  CONTENT_START_HR: 'CONTENT_START_HR',
  CONTENT_STOP_HR: 'CONTENT_STOP_HR',
  START_GMAIL_SCHEDULE: 'START_GMAIL_SCHEDULE',
  STOP_GMAIL_SCHEDULE: 'STOP_GMAIL_SCHEDULE',
  BACKEND_REQUEST: 'BACKEND_REQUEST',
  CREATE_SEARCH_SESSION: 'CREATE_SEARCH_SESSION',
  RESUME_SEARCH_SESSION: 'RESUME_SEARCH_SESSION',
  GET_SEARCH_SESSION: 'GET_SEARCH_SESSION',
  CANCEL_SEARCH_SESSION: 'CANCEL_SEARCH_SESSION',
  GET_FIREBASE_ID_TOKEN: 'GET_FIREBASE_ID_TOKEN',
  NOTIFICATION: 'NOTIFICATION',
  STATUS: 'STATUS',
  LOG: 'LOG',
  STOPPED: 'STOPPED',
  OPEN_PRICING: 'OPEN_PRICING',
});

const ALLOWED_BACKEND_ENDPOINTS = Object.freeze([
  'searchJobs', 'tailorResume', 'uploadResume', 'computeFitScore', 'recomputeScores',
  'scanGmail', 'classifySponsorship', 'matchJobsForUser', 'matchCurrentJobForUser',
  'generateAiAssistance', 'checkAndConsumeQuota', 'correctTrackerEntry',
  'createSearchSession', 'resumeSearchSession', 'getSearchSession', 'cancelSearchSession',
  'recordApplicationOutcome', 'getApplicationHistory', 'checkApplicationApplied',
]);

function isPlainMessageObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeText(value, maximumLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function hasNoPayload(message) {
  return Object.keys(message).every(key => key === 'type');
}

function validateBackendRequest(message) {
  return ALLOWED_BACKEND_ENDPOINTS.includes(message.endpoint) &&
    isPlainMessageObject(message.body) &&
    JSON.stringify(message.body).length <= 100000;
}

const MESSAGE_VALIDATORS = Object.freeze({
  [MessageType.START_BOT]: hasNoPayload,
  [MessageType.STOP_BOT]: hasNoPayload,
  [MessageType.START_HR]: hasNoPayload,
  [MessageType.STOP_HR]: hasNoPayload,
  [MessageType.CONTENT_START_BOT]: hasNoPayload,
  [MessageType.CONTENT_STOP_BOT]: hasNoPayload,
  [MessageType.CONTENT_START_HR]: hasNoPayload,
  [MessageType.CONTENT_STOP_HR]: hasNoPayload,
  [MessageType.START_GMAIL_SCHEDULE]: hasNoPayload,
  [MessageType.STOP_GMAIL_SCHEDULE]: hasNoPayload,
  [MessageType.GET_FIREBASE_ID_TOKEN]: hasNoPayload,
  [MessageType.STOPPED]: hasNoPayload,
  [MessageType.OPEN_PRICING]: hasNoPayload,
  [MessageType.BACKEND_REQUEST]: validateBackendRequest,
  [MessageType.CREATE_SEARCH_SESSION]: message => isPlainMessageObject(message.criteria),
  [MessageType.RESUME_SEARCH_SESSION]: message => isSafeText(message.sessionId, 200),
  [MessageType.GET_SEARCH_SESSION]: message => isSafeText(message.sessionId, 200) &&
    (message.page === undefined || (Number.isInteger(message.page) && message.page > 0)),
  [MessageType.CANCEL_SEARCH_SESSION]: message => isSafeText(message.sessionId, 200),
  [MessageType.NOTIFICATION]: message => isSafeText(message.message, 500),
  [MessageType.LOG]: message => isSafeText(message.message, 500) && ['debug', 'info', 'warning', 'error', 'success'].includes(message.level),
  [MessageType.STATUS]: message => ['applied', 'skipped', 'failed'].every(key => Number.isInteger(message[key]) && message[key] >= 0),
});
/** Validate a message at the trust boundary. */
function validateExtensionMessage(message) {
  if (!isPlainMessageObject(message) || !Object.values(MessageType).includes(message.type)) {
    return { valid: false, error: 'UNKNOWN_MESSAGE_TYPE' };
  }
  const validator = MESSAGE_VALIDATORS[message.type];
  try {
    return validator(message)
      ? { valid: true, value: message }
      : { valid: false, error: 'INVALID_MESSAGE_PAYLOAD' };
  } catch (_) {
    return { valid: false, error: 'INVALID_MESSAGE_PAYLOAD' };
  }
}

/** Verify the message originated from this extension when sender identity is available. */
function validateExtensionSender(sender) {
  if (!sender || typeof sender !== 'object') return false;
  if (typeof chrome !== 'undefined' && chrome.runtime?.id && sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }
  return true;
}

/** Extension pages have no tab and use the extension origin. */
function isExtensionOwnedSender(sender) {
  if (!validateExtensionSender(sender) || sender.tab) return false;
  if (!sender.url || typeof chrome === 'undefined' || !chrome.runtime?.getURL) return false;
  return sender.url.startsWith(chrome.runtime.getURL(''));
}

/** Create a protocol message after validating the payload. */
function createExtensionMessage(type, payload = {}) {
  const message = { type, ...payload };
  const validation = validateExtensionMessage(message);
  if (!validation.valid) throw new TypeError(validation.error);
  return message;
}

// eslint-disable-next-line no-var
var MessageProtocol = Object.freeze({
  types: MessageType,
  allowedBackendEndpoints: ALLOWED_BACKEND_ENDPOINTS,
  validate: validateExtensionMessage,
  validateSender: validateExtensionSender,
  isExtensionOwnedSender,
  createMessage: createExtensionMessage,
  create: createExtensionMessage,
});
