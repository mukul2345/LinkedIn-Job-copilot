// background.js - Service worker for managing bot state and communication

// Unified message handler — single listener for all message types
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Bot control messages
  if (msg.action === 'start') {
    startBot();
    sendResponse({ received: true });
    return true;
  } else if (msg.action === 'stop') {
    stopBot();
    sendResponse({ received: true });
    return true;
  } else if (msg.action === 'startHR') {
    startHRBot();
    sendResponse({ received: true });
    return true;
  } else if (msg.action === 'stopHR') {
    stopHRBot();
    sendResponse({ received: true });
    return true;
  }

  // Gmail scan schedule messages
  if (msg.action === 'startGmailScan') {
    startGmailScanSchedule();
    sendResponse({ success: true });
    return true;
  } else if (msg.action === 'stopGmailScan') {
    stopGmailScanSchedule();
    sendResponse({ success: true });
    return true;
  }

  // Notification messages from content script
  if (msg.type === 'notification') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '../assets/icons/icon128.png',
      title: 'LinkedIn Auto Applier',
      message: msg.message
    });
    sendResponse({ received: true });
    return true;
  }

  sendResponse({ received: true });
  return true;
});

async function startBot() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  let targetTab;

  if (tabs.length > 0) {
    targetTab = tabs[0];
    await chrome.tabs.update(targetTab.id, { active: true });
  } else {
    targetTab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' });
  }

  await waitForTabLoad(targetTab.id);
  sendMessageWithRetry(targetTab.id, { action: 'startBot' }, 3);
}

function stopBot() {
  chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'stopBot' }).catch(() => {});
    });
  });
  chrome.storage.local.set({ botRunning: false });
}

async function startHRBot() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  let targetTab;
  if (tabs.length > 0) {
    targetTab = tabs[0];
    await chrome.tabs.update(targetTab.id, { active: true });
  } else {
    targetTab = await chrome.tabs.create({ url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/' });
  }
  await waitForTabLoad(targetTab.id);
  sendMessageWithRetry(targetTab.id, { action: 'startHRBot' }, 3);
}

function stopHRBot() {
  chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'stopHRBot' }).catch(() => {});
    });
  });
  chrome.storage.local.set({ hrBotRunning: false });
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve();
        return;
      }
      if (tab.status === 'complete') {
        // Extra delay for content script injection (increased for slow connections)
        setTimeout(resolve, 3000);
        return;
      }
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 3000);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Timeout fallback - don't wait forever
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15000);
    });
  });
}

/**
 * Send a message to a tab's content script with limited retries.
 * IMPORTANT: retries is capped and decremented to prevent infinite loops.
 */
function sendMessageWithRetry(tabId, message, retries) {
  if (retries <= 0) {
    console.warn('Failed to send message to content script after all retries:', message.action);
    return;
  }

  chrome.tabs.sendMessage(tabId, message)
    .then(() => {
      // Success - message delivered
    })
    .catch((err) => {
      console.warn(`Message delivery failed (${retries} retries left):`, err.message);
      if (retries > 1) {
        // Wait longer between each retry (exponential backoff)
        const delay = (4 - retries) * 3000; // 3s, 6s, 9s (increased from 2s)
        setTimeout(() => sendMessageWithRetry(tabId, message, retries - 1), delay);
      } else {
        console.error('Failed to send message to content script. Extension may need reload.');
      }
    });
}

// When extension is installed or reloaded, clear all running states
// This prevents the bot from auto-resuming after a manual extension reload.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    botRunning: false,
    hrBotRunning: false,
    pendingAutoLogin: false,
    hrBotState: null,
  });
  chrome.storage.local.remove('botState');

  // Clear any existing Gmail scan alarm on install/update — user must connect Gmail first
  chrome.alarms.clear('gmail-scan-interval');

  console.log('[LinkedIn Auto Applier] Extension loaded. Bot states cleared.');
});

// --- Gmail Scan Scheduling via chrome.alarms API ---

const GMAIL_SCAN_ALARM_NAME = 'gmail-scan-interval';
const GMAIL_SCAN_INTERVAL_MINUTES = 15;

/**
 * Start the periodic Gmail scan alarm (every 15 minutes).
 * Only call this after the user has connected Gmail.
 */
function startGmailScanSchedule() {
  chrome.alarms.create(GMAIL_SCAN_ALARM_NAME, {
    delayInMinutes: GMAIL_SCAN_INTERVAL_MINUTES,
    periodInMinutes: GMAIL_SCAN_INTERVAL_MINUTES,
  });
  console.log('[JobPilot Tracker] Gmail scan alarm started (every 15 min).');
}

/**
 * Stop the periodic Gmail scan alarm.
 * Call this when the user disconnects Gmail.
 */
function stopGmailScanSchedule() {
  chrome.alarms.clear(GMAIL_SCAN_ALARM_NAME);
  console.log('[JobPilot Tracker] Gmail scan alarm stopped.');
}

// Handle alarm firing — trigger Gmail scan if connected
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== GMAIL_SCAN_ALARM_NAME) return;

  try {
    const data = await chrome.storage.local.get(['gmailConnected']);
    if (!data.gmailConnected) {
      // Gmail disconnected since alarm was set — stop the alarm
      stopGmailScanSchedule();
      return;
    }

    // Call the backend scan endpoint
    const token = await getAuthTokenForScan();
    if (!token) {
      console.warn('[JobPilot Tracker] No auth token available for scheduled scan.');
      return;
    }

    const response = await fetch(
      'https://us-central1-linkedin-jobcopilot.cloudfunctions.net/scanGmail',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      console.warn('[JobPilot Tracker] Scheduled scan failed with status:', response.status);
      return;
    }

    const result = await response.json();
    const newEntries = (result.data && result.data.entries) || result.entries || [];

    if (newEntries.length > 0) {
      // Merge with existing local entries (avoid duplicates by ID)
      const stored = await chrome.storage.local.get(['trackerEntries']);
      const existingEntries = stored.trackerEntries || [];
      const existingIds = new Set(existingEntries.map(e => e.id));

      const merged = existingEntries.slice();
      for (const entry of newEntries) {
        if (!existingIds.has(entry.id)) {
          merged.push(entry);
        }
      }

      await chrome.storage.local.set({
        trackerEntries: merged,
        trackerLastScan: Date.now(),
      });
    } else {
      await chrome.storage.local.set({ trackerLastScan: Date.now() });
    }

    console.log('[JobPilot Tracker] Scheduled scan complete. New entries:', newEntries.length);
  } catch (err) {
    console.warn('[JobPilot Tracker] Error during scheduled Gmail scan:', err.message || err);
  }
});

/**
 * Retrieve auth token for background scan operations.
 * Uses chrome.identity.getAuthToken silently (non-interactive).
 * @returns {Promise<string|null>}
 */
function getAuthTokenForScan() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        resolve(null);
      } else {
        resolve(token);
      }
    });
  });
}
