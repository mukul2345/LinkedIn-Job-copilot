// service-worker.js - Validated extension messaging, bot control, and scheduling.

if (typeof importScripts === 'function') {
  importScripts(
    '../core/constants.js',
    '../core/runtime-config.js',
    '../modules/shared/errors.js',
    '../modules/shared/logger.js',
    '../modules/shared/message-protocol.js',
    '../assets/lib/firebase-app-compat.js',
    '../assets/lib/firebase-auth-compat.js',
    '../core/firebase-config.js'
  );
  if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(JOBPILOT_FIREBASE_CONFIG);
  }
}

const GMAIL_SCAN_ALARM_NAME = 'gmail-scan-interval';
const STALE_RUN_KEYS = ['botState', 'hrBotState', 'hrBotStateTimestamp'];
const CREDENTIAL_KEYS = [
  'linkedinEmail', 'linkedinPassword', 'credentialsObfuscated',
  'credentialOwnerUid', 'pendingAutoLogin', 'gmailToken',
];

/** Read local storage through the callback contract used by all supported Chromium builds. */
function readLocalStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

/** Reconcile resumable execution state without deleting valid MV3 navigation state. */
async function reconcileRunState() {
  const stored = await readLocalStorage([
    'botRunning', 'botState', 'hrBotRunning', 'hrBotStateTimestamp',
  ]);
  const updates = {};
  const removals = [...CREDENTIAL_KEYS];
  if (stored.botRunning && !stored.botState) updates.botRunning = false;
  const hrStateIsStale = Date.now() - Number(stored.hrBotStateTimestamp || 0) > 2 * 60 * 1000;
  if (stored.hrBotRunning && hrStateIsStale) {
    updates.hrBotRunning = false;
    removals.push('hrBotState', 'hrBotStateTimestamp');
  }
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  await chrome.storage.local.remove(removals);
}
reconcileRunState().catch(error => {
  ExtensionLogger.warn('Run-state reconciliation failed.', { code: error?.code });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ botRunning: false, hrBotRunning: false });
  chrome.storage.local.remove([
    ...STALE_RUN_KEYS,
    ...CREDENTIAL_KEYS,
    'aiApiKey', 'aiApiUrl', 'aiProvider', 'aiModel',
  ]);
  chrome.alarms.clear(GMAIL_SCAN_ALARM_NAME);
});

/** Validate and dispatch one protocol message. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const validation = MessageProtocol.validate(message);
  if (!MessageProtocol.validateSender(sender) || !validation.valid) {
    sendResponse({ ok: false, error: { code: validation.error || 'INVALID_SENDER' } });
    return false;
  }

  dispatchMessage(validation.value, sender)
    .then(data => sendResponse({ ok: true, data }))
    .catch(error => sendResponse({
      ok: false,
      error: {
        code: error.code || 'MESSAGE_FAILED',
        message: error.message || 'Message handling failed.',
        status: error.status ?? null,
      },
    }));
  return true;
});
/** Route allowlisted messages to privileged operations. */
async function dispatchMessage(message, sender) {
  switch (message.type) {
    case MessageType.START_BOT: return startBot();
    case MessageType.STOP_BOT: return stopBot();
    case MessageType.START_HR: return startHRBot();
    case MessageType.STOP_HR: return stopHRBot();
    case MessageType.START_GMAIL_SCHEDULE: return startGmailScanSchedule();
    case MessageType.STOP_GMAIL_SCHEDULE: return stopGmailScanSchedule();
    case MessageType.BACKEND_REQUEST: return proxyAuthenticatedBackendRequest(message);
    case MessageType.CREATE_SEARCH_SESSION:
      return proxyAuthenticatedBackendRequest({ endpoint: 'createSearchSession', body: { criteria: message.criteria } });
    case MessageType.RESUME_SEARCH_SESSION:
      return proxyAuthenticatedBackendRequest({ endpoint: 'resumeSearchSession', body: { sessionId: message.sessionId } });
    case MessageType.GET_SEARCH_SESSION:
      return proxyAuthenticatedBackendRequest({ endpoint: 'getSearchSession', body: { sessionId: message.sessionId, page: message.page || 1 } });
    case MessageType.CANCEL_SEARCH_SESSION:
      return proxyAuthenticatedBackendRequest({ endpoint: 'cancelSearchSession', body: { sessionId: message.sessionId } });
    case MessageType.GET_FIREBASE_ID_TOKEN:
      if (!MessageProtocol.isExtensionOwnedSender(sender)) {
        throw new AuthenticationExtensionError({ message: 'Token access is restricted to extension pages.' });
      }
      return { token: await getFirebaseIdToken() };
    case MessageType.NOTIFICATION:
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icons/icon128.png',
        title: APP_NAME || 'JobPilot AI',
        message: message.message,
      });
      return { received: true };
    case MessageType.OPEN_PRICING:
      chrome.tabs.create({ url: chrome.runtime.getURL('ui/popup.html#pricing') });
      return { opened: true };
    default:
      throw new ValidationExtensionError({ message: 'Unknown message type.' });
  }
}

async function startBot() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  const targetTab = tabs.length
    ? tabs[0]
    : await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' });
  if (tabs.length) await chrome.tabs.update(targetTab.id, { active: true });
  await waitForTabLoad(targetTab.id);
  return sendMessageWithRetry(targetTab.id, MessageProtocol.create(MessageType.CONTENT_START_BOT), 3);
}

function stopBot() {
  chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, tabs => {
    tabs.forEach(tab => chrome.tabs.sendMessage(
      tab.id,
      MessageProtocol.create(MessageType.CONTENT_STOP_BOT)
    ).catch(() => {}));
  });
  chrome.storage.local.set({ botRunning: false });
  return Promise.resolve({ stopped: true });
}

async function startHRBot() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  const targetTab = tabs.length
    ? tabs[0]
    : await chrome.tabs.create({ url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/' });
  if (tabs.length) await chrome.tabs.update(targetTab.id, { active: true });
  await waitForTabLoad(targetTab.id);
  return sendMessageWithRetry(targetTab.id, MessageProtocol.create(MessageType.CONTENT_START_HR), 3);
}

function stopHRBot() {
  chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, tabs => {
    tabs.forEach(tab => chrome.tabs.sendMessage(
      tab.id,
      MessageProtocol.create(MessageType.CONTENT_STOP_HR)
    ).catch(() => {}));
  });
  chrome.storage.local.set({ hrBotRunning: false });
  return Promise.resolve({ stopped: true });
}
/** Wait for a tab to finish loading and clean up both listener and timeout. */
function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    let settled = false;
    let settleDelayId;
    const timeoutId = setTimeout(finish, 15000);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (settleDelayId) clearTimeout(settleDelayId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function finishAfterInjectionDelay() {
      clearTimeout(timeoutId);
      settleDelayId = setTimeout(finish, 3000);
    }
    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finishAfterInjectionDelay();
    }
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError || tab?.status === 'complete') {
        finishAfterInjectionDelay();
        return;
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

/** Send a content message with bounded retry. */
async function sendMessageWithRetry(tabId, message, retries) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return { delivered: true };
    } catch (error) {
      lastError = error;
      if (attempt < retries - 1) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 3000));
    }
  }
  throw new NetworkExtensionError({ message: 'Content script did not respond.', cause: lastError });
}

function startGmailScanSchedule() {
  chrome.alarms.create(GMAIL_SCAN_ALARM_NAME, {
    delayInMinutes: RuntimeConfig.defaults.gmailScanIntervalMinutes,
    periodInMinutes: RuntimeConfig.defaults.gmailScanIntervalMinutes,
  });
  return Promise.resolve({ scheduled: true });
}

function stopGmailScanSchedule() {
  chrome.alarms.clear(GMAIL_SCAN_ALARM_NAME);
  return Promise.resolve({ scheduled: false });
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== GMAIL_SCAN_ALARM_NAME) return;
  const stored = await chrome.storage.local.get(['gmailConnected']);
  if (!stored.gmailConnected) {
    await stopGmailScanSchedule();
    return;
  }
  try {
    const scanResult = await proxyAuthenticatedBackendRequest({
      endpoint: 'scanGmail',
      body: {},
    });
    const incoming = Array.isArray(scanResult?.entries) ? scanResult.entries : [];
    const current = await chrome.storage.local.get(['trackerEntries']);
    const entriesById = new Map((current.trackerEntries || []).map(entry => [entry.id, entry]));
    incoming.forEach(entry => {
      if (entry?.id) entriesById.set(entry.id, entry);
    });
    await chrome.storage.local.set({ trackerEntries: [...entriesById.values()], trackerLastScan: Date.now() });
  } catch (error) {
    ExtensionLogger.warn('Scheduled Gmail scan failed.', { code: error.code, status: error.status });
  }
});
/** Call an allowlisted backend endpoint with the worker-owned Firebase token. */
async function proxyAuthenticatedBackendRequest(message) {
  if (!MessageProtocol.allowedBackendEndpoints.includes(message.endpoint)) {
    throw new ValidationExtensionError({ message: 'Backend endpoint is not allowed.' });
  }
  const token = await getFirebaseIdToken();
  if (!token) throw new AuthenticationExtensionError({ message: 'Sign in to continue.', status: 401 });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RuntimeConfig.defaults.requestTimeoutMs);
  try {
    const response = await fetch(RuntimeConfig.buildEndpointUrl(message.endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(message.body),
      signal: controller.signal,
    });
    const rawBody = await response.text();
    let envelope;
    try { envelope = rawBody ? JSON.parse(rawBody) : null; } catch (cause) {
      throw new MalformedResponseExtensionError({ message: 'Backend response was not valid JSON.', cause, status: response.status });
    }
    if (!envelope || typeof envelope.ok !== 'boolean') {
      throw new MalformedResponseExtensionError({ message: 'Backend response envelope was invalid.', status: response.status });
    }
    if (!response.ok || !envelope.ok) {
      const options = { message: envelope.error?.message || 'Backend request failed.', status: response.status };
      if (response.status === 401 || response.status === 403) throw new AuthenticationExtensionError(options);
      if (response.status === 429) throw new RateLimitExtensionError(options);
      throw new ExtensionError({ ...options, code: envelope.error?.code || 'HTTP_ERROR', retryable: response.status >= 500 });
    }
    return envelope.data;
  } catch (error) {
    if (error instanceof ExtensionError) throw error;
    if (error?.name === 'AbortError') throw new TimeoutExtensionError({ message: 'Backend request timed out.', cause: error });
    throw new NetworkExtensionError({ message: 'Unable to reach backend.', cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Resolve the current Firebase user after auth persistence initializes. */
async function getFirebaseIdToken() {
  if (typeof firebase === 'undefined') return null;
  const authInstance = firebase.auth();
  if (authInstance.currentUser) return authInstance.currentUser.getIdToken(false);
  const user = await new Promise(resolve => {
    let unsubscribe = () => {};
    const timeoutId = setTimeout(() => { unsubscribe(); resolve(null); }, 3000);
    unsubscribe = authInstance.onAuthStateChanged(currentUser => {
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(currentUser);
    }, () => {
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(null);
    });
  });
  return user ? user.getIdToken(false) : null;
}
