// tracker-service.js - Gmail OAuth and application tracking module for JobPilot Enhanced Features
// Handles Gmail connection/disconnection via chrome.identity API, token lifecycle management,
// application status tracking, and local cache synchronization.

/**
 * Gmail OAuth scope required for read-only inbox access.
 */
// eslint-disable-next-line no-var
var GMAIL_OAUTH_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/**
 * Chrome storage keys used by the tracker module.
 */
// eslint-disable-next-line no-var
var TRACKER_STORAGE_KEYS = {
  gmailConnected: 'gmailConnected',
  gmailToken: 'gmailToken',
  trackerEntries: 'trackerEntries',
  trackerLastScan: 'trackerLastScan',
};

/** Return whether the extension manifest contains usable Gmail OAuth configuration. */
function getGmailOAuthConfigurationError() {
  if (!chrome.identity || typeof chrome.identity.getAuthToken !== 'function') {
    return 'Gmail OAuth is unavailable because the Chrome Identity API is not configured for this extension.';
  }
  if (!chrome.runtime || typeof chrome.runtime.getManifest !== 'function') {
    return 'Gmail OAuth is not configured. Add a valid oauth2 client_id and Gmail read-only scope to the extension manifest.';
  }

  var manifest = chrome.runtime.getManifest();
  var oauth = manifest && manifest.oauth2;
  var clientId = oauth && oauth.client_id;
  var scopes = oauth && oauth.scopes;
  var hasPlaceholder = typeof clientId !== 'string' || /[<>]|GOOGLE_CLIENT_ID/i.test(clientId);
  var hasGmailScope = Array.isArray(scopes) && scopes.indexOf(GMAIL_OAUTH_SCOPE) !== -1;

  if (hasPlaceholder || !hasGmailScope) {
    return 'Gmail OAuth is not configured. Set a valid oauth2 client_id and Gmail read-only scope in the extension manifest.';
  }
  return null;
}

/** Return whether a tracker identifier is safe for storage, DOM attributes, and backend calls. */
function isValidTrackerServiceEntryId(entryId) {
  return typeof entryId === 'string' &&
    entryId.length > 0 &&
    entryId.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(entryId);
}

/**
 * Initiate Gmail OAuth flow using chrome.identity.getAuthToken.
 * On success, stores the access token in chrome.storage.local and sets gmailConnected to true.
 * On failure, returns an error object without throwing.
 *
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function connectGmail() {
  var configurationError = getGmailOAuthConfigurationError();
  if (configurationError) return { success: false, error: configurationError };

  try {
    await new Promise(function (resolve, reject) {
      chrome.identity.getAuthToken({ interactive: true }, function (accessToken) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!accessToken) {
          reject(new Error('No access token received from the Gmail OAuth flow.'));
          return;
        }
        resolve();
      });
    });

    // Identity owns the access token; local storage retains connection state only.
    await new Promise(function (resolve) {
      var connectionState = {};
      connectionState[TRACKER_STORAGE_KEYS.gmailConnected] = true;
      chrome.storage.local.set(connectionState, resolve);
    });
    await new Promise(function (resolve) {
      chrome.storage.local.remove(TRACKER_STORAGE_KEYS.gmailToken, resolve);
    });

    return { success: true };
  } catch (error) {
    var errorMessage = (error && error.message) || 'Gmail connection failed. Please try again.';
    return { success: false, error: errorMessage };
  }
}

/**
 * Disconnect Gmail by removing the cached auth token and clearing tracker state.
 * Calls chrome.identity.removeCachedAuthToken to invalidate the token,
 * then clears gmailConnected, gmailToken, trackerEntries, and trackerLastScan from storage.
 *
 * @returns {Promise<void>}
 */
async function disconnectGmail() {
  var currentToken = await getGmailToken();

  if (currentToken) {
    await new Promise(function (resolve) {
      chrome.identity.removeCachedAuthToken({ token: currentToken }, resolve);
    });
  }

  await new Promise(function (resolve) {
    chrome.storage.local.set(
      {
        gmailConnected: false,
        trackerEntries: [],
        trackerLastScan: null,
      },
      resolve
    );
  });
  await new Promise(function (resolve) {
    chrome.storage.local.remove(TRACKER_STORAGE_KEYS.gmailToken, resolve);
  });
}

/**
 * Check if Gmail is currently connected.
 * Reads the gmailConnected flag from chrome.storage.local.
 *
 * @returns {Promise<boolean>}
 */
async function isGmailConnected() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([TRACKER_STORAGE_KEYS.gmailConnected], function (data) {
      resolve(data[TRACKER_STORAGE_KEYS.gmailConnected] === true);
    });
  });
}

/**
 * Retrieve the Gmail access token from Chrome Identity's in-memory cache.
 * Access tokens are never persisted in extension storage.
 *
 * @returns {Promise<string|null>}
 */
async function getGmailToken() {
  if (!chrome.identity || typeof chrome.identity.getAuthToken !== 'function') return null;

  return new Promise(function (resolve) {
    chrome.identity.getAuthToken({ interactive: false }, function (accessToken) {
      if (chrome.runtime.lastError || !accessToken) {
        resolve(null);
        return;
      }
      resolve(accessToken);
    });
  });
}

/**
 * Check whether Chrome Identity can silently provide a current token.
 * The token remains inside Chrome's identity cache and is never placed in a
 * URL, extension storage, or application log.
 *
 * @returns {Promise<'valid'|'expired'|'revoked'>}
 */
async function checkGmailTokenStatus() {
  if (!(await isGmailConnected())) return 'revoked';

  try {
    var token = await getGmailToken();
    return token ? 'valid' : 'expired';
  } catch (error) {
    return 'expired';
  }
}

/**
 * Handle token expiry by setting a badge notification ("!") on the extension icon.
 * This alerts the user that their Gmail connection needs attention.
 *
 * @returns {Promise<void>}
 */
async function handleTokenExpiry() {
  await new Promise(function (resolve) {
    chrome.action.setBadgeText({ text: '!' }, function () {
      resolve();
    });
  });
  await new Promise(function (resolve) {
    chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' }, function () {
      resolve();
    });
  });
}

/**
 * Handle token revocation by clearing the token, setting gmailConnected to false,
 * and setting a badge notification. The popup will detect the revoked state
 * and prompt re-authentication.
 *
 * @returns {Promise<void>}
 */
async function handleTokenRevoked() {
  await new Promise(function (resolve) {
    chrome.storage.local.set({ gmailConnected: false }, resolve);
  });
  await new Promise(function (resolve) {
    chrome.storage.local.remove(TRACKER_STORAGE_KEYS.gmailToken, resolve);
  });

  await new Promise(function (resolve) {
    chrome.action.setBadgeText({ text: '!' }, resolve);
  });
  await new Promise(function (resolve) {
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }, resolve);
  });
}

/**
 * Clear the extension badge (called after user re-authenticates or reconnects).
 *
 * @returns {Promise<void>}
 */
async function clearTrackerBadge() {
  await new Promise(function (resolve) {
    chrome.action.setBadgeText({ text: '' }, function () {
      resolve();
    });
  });
}

/**
 * Get all tracked application entries from the local cache in chrome.storage.local.
 *
 * @returns {Promise<TrackerEntry[]>}
 */
async function getTrackedApplications() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([TRACKER_STORAGE_KEYS.trackerEntries], function (data) {
      var entries = data[TRACKER_STORAGE_KEYS.trackerEntries];
      if (!Array.isArray(entries)) {
        resolve([]);
        return;
      }
      resolve(entries.filter(function (entry) {
        return entry && isValidTrackerServiceEntryId(entry.id);
      }));
    });
  });
}

/**
 * Manually correct or dismiss a tracker entry.
 * Updates the entry locally in chrome.storage.local, then syncs the correction to the backend.
 *
 * @param {string} entryId - The tracker entry ID to correct
 * @param {Object} correction - Correction data
 * @param {string} [correction.status] - New status value (interview|rejection|offer|unknown)
 * @param {boolean} [correction.dismissed] - Whether to dismiss the entry
 * @returns {Promise<void>}
 */
async function correctTrackerEntry(entryId, correction) {
  if (!isValidTrackerServiceEntryId(entryId)) {
    throw new TypeError('A valid tracker entry ID is required.');
  }
  if (!correction || typeof correction !== 'object') {
    throw new TypeError('Tracker correction data is required.');
  }

  var entries = await getTrackedApplications();
  var entryExists = entries.some(function (entry) { return entry.id === entryId; });
  if (!entryExists) throw new Error('Tracker entry was not found.');

  var updatedEntries = entries.map(function (entry) {
    if (entry.id !== entryId) return entry;

    var correctedEntry = Object.assign({}, entry);
    if (correction.status !== undefined) {
      var validStatuses = ['interview', 'rejection', 'offer', 'unknown'];
      if (validStatuses.indexOf(correction.status) === -1) {
        throw new TypeError('Tracker status is invalid.');
      }
      correctedEntry.status = correction.status;
      correctedEntry.manualCorrection = correction.status;
    }
    if (correction.dismissed !== undefined) {
      correctedEntry.dismissed = correction.dismissed === true;
    }
    return correctedEntry;
  });

  await new Promise(function (resolve) {
    var storageUpdate = {};
    storageUpdate[TRACKER_STORAGE_KEYS.trackerEntries] = updatedEntries;
    chrome.storage.local.set(storageUpdate, resolve);
  });

  try {
    await callBackend('correctTrackerEntry', {
      entryId: entryId,
      correction: correction,
    });
  } catch (error) {
    console.warn('[JobPilot Tracker] Failed to sync correction to backend:', error && error.message);
  }
}

/**
 * Trigger an immediate Gmail inbox scan via the backend.
 * Calls the 'scanGmail' Cloud Function, updates the local tracker cache with results.
 *
 * @returns {Promise<TrackerEntry[]>}
 * @throws {ApiError} On backend failure or auth issues
 */
async function scanGmailNow() {
  var result = await callBackend('scanGmail', {});
  var returnedEntries = result && (result.entries || result);
  var newEntries = Array.isArray(returnedEntries) ? returnedEntries.filter(function (entry) {
    return entry && isValidTrackerServiceEntryId(entry.id);
  }) : [];

  var existingEntries = await getTrackedApplications();
  var existingIds = Object.create(null);
  existingEntries.forEach(function (entry) {
    existingIds[entry.id] = true;
  });

  var mergedEntries = existingEntries.slice();
  newEntries.forEach(function (entry) {
    if (!existingIds[entry.id]) {
      existingIds[entry.id] = true;
      mergedEntries.push(entry);
    }
  });

  await new Promise(function (resolve) {
    var storageUpdate = {};
    storageUpdate[TRACKER_STORAGE_KEYS.trackerEntries] = mergedEntries;
    storageUpdate[TRACKER_STORAGE_KEYS.trackerLastScan] = Date.now();
    chrome.storage.local.set(storageUpdate, resolve);
  });

  return mergedEntries;
}

/**
 * Get the timestamp of the last Gmail scan.
 * Returns the epoch milliseconds value, or null if no scan has occurred.
 *
 * @returns {Promise<number|null>}
 */
async function getTrackerLastScan() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([TRACKER_STORAGE_KEYS.trackerLastScan], function (data) {
      resolve(data[TRACKER_STORAGE_KEYS.trackerLastScan] || null);
    });
  });
}
