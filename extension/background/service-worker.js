// background.js - Service worker for managing bot state and communication

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'start') {
    startBot();
  } else if (msg.action === 'stop') {
    stopBot();
  } else if (msg.action === 'startHR') {
    startHRBot();
  } else if (msg.action === 'stopHR') {
    stopHRBot();
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
        // Extra delay for content script injection
        setTimeout(resolve, 1500);
        return;
      }
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 1500);
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
        const delay = (4 - retries) * 2000; // 2s, 4s, 6s
        setTimeout(() => sendMessageWithRetry(tabId, message, retries - 1), delay);
      } else {
        console.error('Failed to send message to content script. Extension may need reload.');
      }
    });
}

// Listen for notifications from content script
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'notification') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '../assets/icons/icon128.png',
      title: 'LinkedIn Auto Applier',
      message: msg.message
    });
  }
});

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
  console.log('[LinkedIn Auto Applier] Extension loaded. Bot states cleared.');
});
