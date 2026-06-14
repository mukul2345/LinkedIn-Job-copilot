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

/**
 * Initiate Gmail OAuth flow using chrome.identity.getAuthToken.
 * On success, stores the access token in chrome.storage.local and sets gmailConnected to true.
 * On failure, returns an error object without throwing.
 *
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function connectGmail() {
  try {
    var token = await new Promise(function (resolve, reject) {
      chrome.identity.getAuthToken({ interactive: true }, function (accessToken) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!accessToken) {
          reject(new Error('No access token received from OAuth flow.'));
          return;
        }
        resolve(accessToken);
      });
    });

    // Store token and connection state in chrome.storage.local
    await new Promise(function (resolve) {
      var data = {};
      data[TRACKER_STORAGE_KEYS.gmailConnected] = true;
      data[TRACKER_STORAGE_KEYS.gmailToken] = token;
      chrome.storage.local.set(data, function () {
        resolve();
      });
    });

    return { success: true };
  } catch (err) {
    var errorMessage = (err && err.message) || 'Gmail connection failed. Please try again.';
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
  // First, read the current token to remove it from the identity cache
  var currentToken = await getGmailToken();

  if (currentToken) {
    await new Promise(function (resolve) {
      chrome.identity.removeCachedAuthToken({ token: currentToken }, function () {
        resolve();
      });
    });
  }

  // Clear all tracker-related storage
  await new Promise(function (resolve) {
    chrome.storage.local.set(
      {
        gmailConnected: false,
        gmailToken: null,
        trackerEntries: [],
        trackerLastScan: null,
      },
      function () {
        resolve();
      }
    );
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
 * Retrieve the stored Gmail access token from chrome.storage.local.
 * Returns null if no token is stored.
 *
 * @returns {Promise<string|null>}
 */
async function getGmailToken() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([TRACKER_STORAGE_KEYS.gmailToken], function (data) {
      resolve(data[TRACKER_STORAGE_KEYS.gmailToken] || null);
    });
  });
}

/**
 * Check the current Gmail token status by attempting a lightweight validation.
 * Uses chrome.identity.getAuthToken with interactive: false to silently check token validity.
 *
 * @returns {Promise<'valid'|'expired'|'revoked'>}
 */
async function checkGmailTokenStatus() {
  var connected = await isGmailConnected();
  if (!connected) {
    return 'revoked';
  }

  try {
    var token = await new Promise(function (resolve, reject) {
      chrome.identity.getAuthToken({ interactive: false }, function (accessToken) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(accessToken);
      });
    });

    if (!token) {
      return 'expired';
    }

    // Verify token is still valid by making a lightweight API call
    var response = await fetch(
      'https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=' + encodeURIComponent(token)
    );

    if (response.status === 200) {
      return 'valid';
    } else if (response.status === 401) {
      return 'revoked';
    } else {
      return 'expired';
    }
  } catch (err) {
    // If we cannot get a token silently, it is likely expired
    var errorMsg = (err && err.message) || '';
    if (errorMsg.indexOf('revoked') !== -1 || errorMsg.indexOf('invalid') !== -1) {
      return 'revoked';
    }
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
  // Clear stored token and mark as disconnected
  await new Promise(function (resolve) {
    chrome.storage.local.set(
      {
        gmailConnected: false,
        gmailToken: null,
      },
      function () {
        resolve();
      }
    );
  });

  // Set badge to indicate re-auth needed
  await new Promise(function (resolve) {
    chrome.action.setBadgeText({ text: '!' }, function () {
      resolve();
    });
  });
  await new Promise(function (resolve) {
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }, function () {
      resolve();
    });
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
      resolve(data[TRACKER_STORAGE_KEYS.trackerEntries] || []);
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
  var entries = await getTrackedApplications();

  var updatedEntries = entries.map(function (entry) {
    if (entry.id !== entryId) {
      return entry;
    }

    var correctedEntry = Object.assign({}, entry);

    if (correction.status !== undefined) {
      correctedEntry.status = correction.status;
      correctedEntry.manualCorrection = correction.status;
    }
    if (correction.dismissed !== undefined) {
      correctedEntry.dismissed = correction.dismissed;
    }

    return correctedEntry;
  });

  // Persist updated entries locally
  await new Promise(function (resolve) {
    var data = {};
    data[TRACKER_STORAGE_KEYS.trackerEntries] = updatedEntries;
    chrome.storage.local.set(data, function () {
      resolve();
    });
  });

  // Sync correction to backend (fire-and-forget)
  try {
    await callBackend('correctTrackerEntry', {
      entryId: entryId,
      correction: correction,
    });
  } catch (err) {
    // Non-critical: local state is already updated.
    // Backend sync will catch up on next scan.
    console.warn('[JobPilot Tracker] Failed to sync correction to backend:', err && err.message);
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

  // result is expected to be an array of TrackerEntry from the backend
  var newEntries = result.entries || result || [];

  // Merge with existing local entries (avoid duplicates by ID)
  var existingEntries = await getTrackedApplications();
  var existingIds = {};
  existingEntries.forEach(function (entry) {
    existingIds[entry.id] = true;
  });

  var mergedEntries = existingEntries.slice();
  newEntries.forEach(function (entry) {
    if (!existingIds[entry.id]) {
      mergedEntries.push(entry);
    }
  });

  // Update local cache and last scan timestamp
  await new Promise(function (resolve) {
    var data = {};
    data[TRACKER_STORAGE_KEYS.trackerEntries] = mergedEntries;
    data[TRACKER_STORAGE_KEYS.trackerLastScan] = Date.now();
    chrome.storage.local.set(data, function () {
      resolve();
    });
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
