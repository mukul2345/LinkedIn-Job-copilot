// popup.js - Extension popup UI logic

document.addEventListener('DOMContentLoaded', () => {
  initAuthUI();
});

// ===== AUTH UI INITIALIZATION =====
function initAuthUI() {
  // Auth screen navigation
  document.getElementById('showSignup')?.addEventListener('click', (e) => {
    e.preventDefault();
    showScreen('authSignup');
  });
  document.getElementById('showLoginFromSignup')?.addEventListener('click', (e) => {
    e.preventDefault();
    showScreen('authLogin');
  });
  document.getElementById('showForgotPassword')?.addEventListener('click', (e) => {
    e.preventDefault();
    showScreen('authForgot');
  });
  document.getElementById('showLoginFromForgot')?.addEventListener('click', (e) => {
    e.preventDefault();
    showScreen('authLogin');
  });

  // Auth action buttons
  document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
  document.getElementById('signupBtn')?.addEventListener('click', handleSignup);
  document.getElementById('forgotBtn')?.addEventListener('click', handleForgotPassword);
  document.getElementById('googleLoginBtn')?.addEventListener('click', handleGoogleLogin);

  // Enter key support for auth forms
  document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('signupPassword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSignup();
  });
  document.getElementById('forgotEmail')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleForgotPassword();
  });

  // Listen for auth state changes
  onAuthStateChange((user) => {
    if (user) {
      // Cache user email for content script context
      chrome.storage.local.set({ cachedUserEmail: user.email });
      // Small delay to ensure auth token is fully ready before Firestore read
      setTimeout(() => fetchAndCacheUserRole(user), 500);
      // User is signed in — show main app immediately
      checkOnboardingState();
      // Load cloud data and refresh UI when done
      loadUserDataFromCloud().then((loaded) => {
        if (document.getElementById('mainApp').style.display !== 'none') {
          loadAllSettings();
          updateUserAccountUI();
        }
      }).catch(() => {});
    } else {
      // User is signed out — clear cached data and show login screen
      chrome.storage.local.remove(['cachedUserEmail', 'userRole']);
      showScreen('authLogin');
    }
  });
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const statusEl = document.getElementById('loginStatus');

  if (!email || !password) {
    statusEl.textContent = 'Please enter both email and password.';
    statusEl.className = 'auth-status error';
    return;
  }

  statusEl.textContent = 'Signing in...';
  statusEl.className = 'auth-status info';

  const result = await signInUser(email, password);
  if (result.success) {
    statusEl.textContent = '✓ Signed in! Loading your data...';
    statusEl.className = 'auth-status success';
    // Fetch role immediately so UI shows correct badge
    await fetchAndCacheUserRole(result.user);
    checkOnboardingState();
    loadUserDataFromCloud().then(() => {
      if (document.getElementById('mainApp').style.display !== 'none') {
        loadAllSettings();
        updateUserAccountUI();
      }
    }).catch(() => {});
  } else {
    statusEl.textContent = result.error;
    statusEl.className = 'auth-status error';
  }
}

async function handleSignup() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const statusEl = document.getElementById('signupStatus');

  if (!name || !email || !password) {
    statusEl.textContent = 'Please fill in all fields.';
    statusEl.className = 'auth-status error';
    return;
  }

  if (password.length < 6) {
    statusEl.textContent = 'Password must be at least 6 characters.';
    statusEl.className = 'auth-status error';
    return;
  }

  statusEl.textContent = 'Creating account...';
  statusEl.className = 'auth-status info';

  const result = await signUpUser(email, password, name);
  if (result.success) {
    statusEl.textContent = '✓ Account created!';
    statusEl.className = 'auth-status success';
    checkOnboardingState();
    loadUserDataFromCloud().catch(() => {});
  } else {
    statusEl.textContent = result.error;
    statusEl.className = 'auth-status error';
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  const statusEl = document.getElementById('forgotStatus');

  if (!email) {
    statusEl.textContent = 'Please enter your email.';
    statusEl.className = 'auth-status error';
    return;
  }

  statusEl.textContent = 'Sending reset link...';
  statusEl.className = 'auth-status info';

  const result = await resetPassword(email);
  if (result.success) {
    statusEl.textContent = '✓ Reset link sent! Check your inbox.';
    statusEl.className = 'auth-status success';
  } else {
    statusEl.textContent = result.error;
    statusEl.className = 'auth-status error';
  }
}

async function handleGoogleLogin() {
  const statusEl = document.getElementById('loginStatus');
  statusEl.textContent = 'Opening Google sign-in...';
  statusEl.className = 'auth-status info';

  const result = await signInWithGoogle();
  if (result.success) {
    statusEl.textContent = '✓ Signed in with Google!';
    statusEl.className = 'auth-status success';
    checkOnboardingState();
    loadUserDataFromCloud().catch(() => {});
  } else {
    statusEl.textContent = result.error;
    statusEl.className = 'auth-status error';
  }
}

function showScreen(screenId) {
  // Hide all auth screens and main app
  const screens = ['authLogin', 'authSignup', 'authForgot', 'onboarding', 'mainApp'];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
      el.classList.remove('active');
    }
  });

  // Show the target screen
  const target = document.getElementById(screenId);
  if (target) {
    target.style.display = 'block';
    target.classList.add('active');
  }
}

// ===== ONBOARDING (LinkedIn credentials) =====
async function checkOnboardingState() {
  const data = await getStorageData(['linkedinEmail', 'linkedinPassword', 'onboardingComplete']);

  if (data.onboardingComplete) {
    showMainApp();
  } else {
    showScreen('onboarding');
    // Attach listeners for onboarding buttons
    document.getElementById('saveLoginBtn').addEventListener('click', saveLogin);
    document.getElementById('skipLoginBtn').addEventListener('click', skipLogin);
  }
}

function showMainApp() {
  showScreen('mainApp');
  document.getElementById('mainApp').style.display = 'block';

  initTabs();
  loadAllSettings();
  initButtons();
  initStatusUpdates();
  loadActivityData();
  updateUserAccountUI();
  restoreActivityLog();
  checkAndShowExpiryAlert();
}

/**
 * Check subscription expiry and show alert in the status tab.
 */
async function checkAndShowExpiryAlert() {
  if (typeof checkSubscriptionExpiry !== 'function') return;

  const expiry = await checkSubscriptionExpiry();
  if (expiry.message) {
    addLogEntry(expiry.message, expiry.daysLeft <= 1 ? 'error' : 'warning');
  }
}

async function saveLogin() {
  const email = document.getElementById('linkedinEmail').value.trim();
  const password = document.getElementById('linkedinPassword').value;
  const statusEl = document.getElementById('linkedinLoginStatus');

  if (!email || !password) {
    statusEl.textContent = '⚠ Please enter both email and password.';
    statusEl.className = 'login-status error';
    return;
  }

  if (!email.includes('@')) {
    statusEl.textContent = '⚠ Please enter a valid email address.';
    statusEl.className = 'login-status error';
    return;
  }

  statusEl.textContent = '✓ Credentials saved securely!';
  statusEl.className = 'login-status success';

  await chrome.storage.local.set({
    linkedinEmail: email,
    linkedinPassword: password,
    onboardingComplete: true,
    setupDate: new Date().toISOString()
  });

  await trackSession('setup');
  setTimeout(() => showMainApp(), 800);
}

function skipLogin() {
  chrome.storage.local.set({ onboardingComplete: true, loginMode: 'manual' });
  showMainApp();
}

// Tab Navigation
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('#mainApp .tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');

      // Render pricing page when tab is selected
      if (tab.dataset.tab === 'pricing') {
        renderPricingPage();
        updatePricingStatus();
      }
    });
  });
}

// Load all saved settings from chrome.storage
async function loadAllSettings() {
  const data = await getStorageData(null);

  // Profile
  setVal('firstName', data.firstName);
  setVal('middleName', data.middleName);
  setVal('lastName', data.lastName);
  setVal('phoneNumber', data.phoneNumber);
  setVal('currentCity', data.currentCity);
  setVal('street', data.street);
  setVal('state', data.state);
  setVal('zipcode', data.zipcode);
  setVal('country', data.country);
  setVal('ethnicity', data.ethnicity);
  setVal('gender', data.gender);
  setVal('disabilityStatus', data.disabilityStatus);
  setVal('veteranStatus', data.veteranStatus);

  // Search
  if (data.searchTerms) document.getElementById('searchTerms').value = data.searchTerms.join('\n');
  setVal('searchLocation', data.searchLocation);
  setVal('datePosted', data.datePosted);
  setVal('experienceLevel', data.experienceLevel ? data.experienceLevel.join(', ') : '');
  setVal('jobType', data.jobType ? data.jobType.join(', ') : '');
  setVal('workStyle', data.workStyle ? data.workStyle.join(', ') : '');
  setChecked('easyApplyOnly', data.easyApplyOnly !== false);
  if (data.badWords) document.getElementById('badWords').value = data.badWords.join('\n');
  if (data.blacklistCompanies) document.getElementById('blacklistCompanies').value = data.blacklistCompanies.join('\n');
  setVal('currentExperience', data.currentExperience ?? 3);
  setVal('switchNumber', data.switchNumber ?? 30);

  // Questions
  setVal('yearsOfExperience', data.yearsOfExperience);
  setVal('requireVisa', data.requireVisa);
  setVal('website', data.website);
  setVal('linkedInUrl', data.linkedInUrl);
  setVal('usCitizenship', data.usCitizenship);
  setVal('desiredSalary', data.desiredSalary);
  setVal('currentCtc', data.currentCtc);
  setVal('noticePeriod', data.noticePeriod);
  setVal('recentEmployer', data.recentEmployer);
  setVal('confidenceLevel', data.confidenceLevel);
  setVal('linkedinHeadline', data.linkedinHeadline);
  setVal('linkedinSummary', data.linkedinSummary);
  setVal('coverLetter', data.coverLetter);

  // Settings - Account
  if (data.linkedinEmail) {
    document.getElementById('accountEmail').textContent = data.linkedinEmail;
    document.getElementById('accountBadge').style.color = '#28a745';
  }

  // Settings - Bot
  setChecked('pauseBeforeSubmit', data.pauseBeforeSubmit === true);
  setChecked('followCompanies', data.followCompanies === true);
  setChecked('messageRecruiter', data.messageRecruiter !== false);
  setVal('clickGap', data.clickGap ?? 2);
  setChecked('useAI', data.useAI === true);
  setVal('aiProvider', data.aiProvider);
  setVal('aiApiUrl', data.aiApiUrl);
  setVal('aiApiKey', data.aiApiKey);
  setVal('aiModel', data.aiModel);

  // HR Outreach
  setVal('hrMessageTemplate', data.hrMessageTemplate || "Hi {name}, I hope you're doing well! I'm a Backend Developer with 3+ years of experience in Node.js, TypeScript, and AWS. I'm currently exploring new opportunities and wanted to check if there are any relevant openings at your organization. I'd appreciate any guidance. Thank you!");
  setVal('hrDailyLimit', data.hrDailyLimit ?? 25);
  setVal('hrDelayBetween', data.hrDelayBetween ?? 60);

  // Stats - show today's actual usage (persists across logout/login)
  const today = new Date().toISOString().split('T')[0];
  const usageKey = `usage_${today}`;
  const todayUsage = data[usageKey] || { applications: 0, hrMessages: 0 };
  // Use the higher of session count or today's tracked usage
  const appliedDisplay = Math.max(data.appliedCount || 0, todayUsage.applications || 0);
  const skippedDisplay = data.skippedCount || 0;
  const failedDisplay = data.failedCount || 0;
  document.getElementById('appliedCount').textContent = appliedDisplay;
  document.getElementById('skippedCount').textContent = skippedDisplay;
  document.getElementById('failedCount').textContent = failedDisplay;
}

async function loadActivityData() {
  const data = await getStorageData(['totalSessions', 'totalAppliedAllTime', 'lastActiveDate', 'linkedinEmail']);

  document.getElementById('totalSessions').textContent = data.totalSessions || 0;
  document.getElementById('totalApplied').textContent = data.totalAppliedAllTime || 0;

  if (data.lastActiveDate) {
    const date = new Date(data.lastActiveDate);
    document.getElementById('lastActive').textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function initButtons() {
  // Save buttons
  document.getElementById('saveProfile').addEventListener('click', saveProfile);
  document.getElementById('saveSearch').addEventListener('click', saveSearch);
  document.getElementById('saveQuestions').addEventListener('click', saveQuestions);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);

  // Action buttons
  document.getElementById('startBtn').addEventListener('click', startApplying);
  document.getElementById('stopBtn').addEventListener('click', stopApplying);
  document.getElementById('messageHRsBtn').addEventListener('click', startHRMessages);
  document.getElementById('stopHRBtn').addEventListener('click', stopHRMessages);
  document.getElementById('exportData').addEventListener('click', exportHistory);
  document.getElementById('clearData').addEventListener('click', clearAllData);

  // Account management
  document.getElementById('changeLoginBtn').addEventListener('click', () => {
    const form = document.getElementById('changeLoginForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('updateLoginBtn').addEventListener('click', updateLogin);
}

async function updateLogin() {
  const email = document.getElementById('updateEmail').value.trim();
  const password = document.getElementById('updatePassword').value;

  if (!email || !password) {
    showNotification('Please enter both email and password.', 'error');
    return;
  }

  await chrome.storage.local.set({ linkedinEmail: email, linkedinPassword: password });
  document.getElementById('accountEmail').textContent = email;
  document.getElementById('changeLoginForm').style.display = 'none';
  showNotification('Credentials updated!');
}

// Save functions
function saveProfile() {
  chrome.storage.local.set({
    firstName: getVal('firstName'),
    middleName: getVal('middleName'),
    lastName: getVal('lastName'),
    phoneNumber: getVal('phoneNumber'),
    currentCity: getVal('currentCity'),
    street: getVal('street'),
    state: getVal('state'),
    zipcode: getVal('zipcode'),
    country: getVal('country'),
    ethnicity: getVal('ethnicity'),
    gender: getVal('gender'),
    disabilityStatus: getVal('disabilityStatus'),
    veteranStatus: getVal('veteranStatus')
  }, () => showNotification('Profile saved!'));
}

function saveSearch() {
  const searchTerms = getVal('searchTerms').split('\n').map(s => s.trim()).filter(Boolean);
  const badWords = getVal('badWords').split('\n').map(s => s.trim()).filter(Boolean);
  const blacklistCompanies = getVal('blacklistCompanies').split('\n').map(s => s.trim()).filter(Boolean);
  const experienceLevel = getVal('experienceLevel').split(',').map(s => s.trim()).filter(Boolean);
  const jobType = getVal('jobType').split(',').map(s => s.trim()).filter(Boolean);
  const workStyle = getVal('workStyle').split(',').map(s => s.trim()).filter(Boolean);

  chrome.storage.local.set({
    searchTerms,
    searchLocation: getVal('searchLocation'),
    datePosted: getVal('datePosted'),
    experienceLevel,
    jobType,
    workStyle,
    easyApplyOnly: getChecked('easyApplyOnly'),
    badWords,
    blacklistCompanies,
    currentExperience: parseInt(getVal('currentExperience')) || 3,
    switchNumber: parseInt(getVal('switchNumber')) || 30
  }, () => showNotification('Search preferences saved!'));
}

function saveQuestions() {
  chrome.storage.local.set({
    yearsOfExperience: getVal('yearsOfExperience'),
    requireVisa: getVal('requireVisa'),
    website: getVal('website'),
    linkedInUrl: getVal('linkedInUrl'),
    usCitizenship: getVal('usCitizenship'),
    desiredSalary: parseInt(getVal('desiredSalary')) || 0,
    currentCtc: parseInt(getVal('currentCtc')) || 0,
    noticePeriod: parseInt(getVal('noticePeriod')) || 0,
    recentEmployer: getVal('recentEmployer'),
    confidenceLevel: getVal('confidenceLevel'),
    linkedinHeadline: getVal('linkedinHeadline'),
    linkedinSummary: getVal('linkedinSummary'),
    coverLetter: getVal('coverLetter')
  }, () => showNotification('Answers saved!'));
}

function saveSettings() {
  chrome.storage.local.set({
    pauseBeforeSubmit: getChecked('pauseBeforeSubmit'),
    followCompanies: getChecked('followCompanies'),
    messageRecruiter: getChecked('messageRecruiter'),
    clickGap: parseInt(getVal('clickGap')) || 2,
    useAI: getChecked('useAI'),
    aiProvider: getVal('aiProvider'),
    aiApiUrl: getVal('aiApiUrl'),
    aiApiKey: getVal('aiApiKey'),
    aiModel: getVal('aiModel'),
    hrMessageTemplate: getVal('hrMessageTemplate'),
    hrDailyLimit: parseInt(getVal('hrDailyLimit')) || 25,
    hrDelayBetween: parseInt(getVal('hrDelayBetween')) || 60
  }, () => showNotification('Settings saved!'));
}

// Start/Stop
async function startApplying() {
  const data = await getStorageData(['searchTerms', 'firstName', 'linkedinEmail', 'loginMode']);

  if (!data.searchTerms || data.searchTerms.length === 0) {
    showNotification('Please configure search terms first!', 'error');
    return;
  }
  if (!data.firstName) {
    showNotification('Please fill in your profile first!', 'error');
    return;
  }

  // Track this session
  await trackSession('start');

  // Check if we're on LinkedIn
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOnLinkedIn = tab && tab.url && tab.url.includes('linkedin.com');

  if (!isOnLinkedIn) {
    if (data.loginMode === 'manual' || !data.linkedinEmail) {
      // Open LinkedIn feed directly, user will log in manually
      await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' });
      chrome.storage.local.set({ botRunning: true, pendingAutoLogin: false });
      showNotification('Opening LinkedIn... Please log in, then bot will start.', 'info');
    } else {
      // Open LinkedIn login for auto-login
      await chrome.tabs.create({ url: 'https://www.linkedin.com/login' });
      chrome.storage.local.set({ botRunning: true, pendingAutoLogin: true });
      showNotification('Opening LinkedIn... Auto-login will be attempted.', 'info');
    }
    updateUI(true);
    return;
  }

  chrome.storage.local.set({ botRunning: true, pendingAutoLogin: false });
  chrome.runtime.sendMessage({ action: 'start' });
  updateUI(true);
}

function stopApplying() {
  chrome.storage.local.set({ botRunning: false, pendingAutoLogin: false });
  chrome.runtime.sendMessage({ action: 'stop' });
  updateUI(false);
  trackSession('stop');
}

async function startHRMessages() {
  const data = await getStorageData(['hrMessageTemplate', 'hrBotRunning']);

  if (data.hrBotRunning) {
    // Bot is already running - stop it
    stopHRMessages();
    return;
  }

  if (!data.hrMessageTemplate) {
    showNotification('Please set a message template in Settings first!', 'error');
    return;
  }

  chrome.storage.local.set({ hrBotRunning: true });

  // Check if on LinkedIn
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('linkedin.com')) {
    await chrome.tabs.create({ url: 'https://www.linkedin.com/search/results/people/?keywords=recruiter%20OR%20HR%20OR%20talent%20acquisition&network=%5B%22F%22%5D&origin=FACETED_SEARCH' });
  }

  chrome.runtime.sendMessage({ action: 'startHR' });

  document.getElementById('messageHRsBtn').disabled = true;
  document.getElementById('stopHRBtn').disabled = false;
  document.getElementById('hrStatus').textContent = '💬 HR messaging active...';
  showNotification('HR outreach started!', 'info');
}

function stopHRMessages() {
  chrome.storage.local.set({ hrBotRunning: false });
  chrome.runtime.sendMessage({ action: 'stopHR' });
  document.getElementById('messageHRsBtn').disabled = false;
  document.getElementById('stopHRBtn').disabled = true;
  document.getElementById('hrStatus').textContent = '';
  showNotification('HR outreach stopped.', 'info');
}

function updateUI(running) {
  document.getElementById('startBtn').disabled = running;
  document.getElementById('stopBtn').disabled = !running;
  const indicator = document.getElementById('statusIndicator');
  indicator.className = 'status-indicator ' + (running ? 'running' : '');
  document.getElementById('statusText').textContent = running ? 'Running...' : 'Idle';
}

// Activity tracking
async function trackSession(type) {
  const data = await getStorageData(['totalSessions', 'totalAppliedAllTime', 'appliedCount']);

  const updates = { lastActiveDate: new Date().toISOString() };

  if (type === 'start' || type === 'setup') {
    updates.totalSessions = (data.totalSessions || 0) + 1;
  }

  if (type === 'stop') {
    updates.totalAppliedAllTime = (data.totalAppliedAllTime || 0) + (data.appliedCount || 0);
  }

  await chrome.storage.local.set(updates);
}

// Status updates listener
function initStatusUpdates() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'status') {
      document.getElementById('appliedCount').textContent = msg.applied || 0;
      document.getElementById('skippedCount').textContent = msg.skipped || 0;
      document.getElementById('failedCount').textContent = msg.failed || 0;
    }
    if (msg.type === 'log') {
      addLogEntry(msg.message, msg.level || 'info');
    }
    if (msg.type === 'stopped') {
      updateUI(false);
    }
  });

  // Check if bot is currently running
  chrome.storage.local.get(['botRunning', 'hrBotRunning'], (data) => {
    updateUI(data.botRunning === true);
    if (data.hrBotRunning) {
      document.getElementById('messageHRsBtn').disabled = true;
      document.getElementById('stopHRBtn').disabled = false;
      document.getElementById('hrStatus').textContent = '💬 HR messaging active...';
    }
  });
}

function addLogEntry(message, level) {
  const container = document.getElementById('logContainer');
  if (!container) return;
  const empty = container.querySelector('.log-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  container.prepend(entry);

  // Keep only last 50 entries
  while (container.children.length > 50) {
    container.lastChild.remove();
  }

  // Persist activity log to storage so it survives popup close/reopen
  persistActivityLog();
}

/**
 * Persist the current activity log entries to chrome.storage.local.
 * This ensures the log survives popup close/reopen cycles.
 */
function persistActivityLog() {
  const container = document.getElementById('logContainer');
  if (!container) return;
  const entries = Array.from(container.querySelectorAll('.log-entry')).map(el => ({
    text: el.textContent,
    level: el.className.replace('log-entry ', '').trim()
  }));
  chrome.storage.local.set({ activityLog: entries });
}

/**
 * Restore activity log from storage when popup opens.
 */
function restoreActivityLog() {
  chrome.storage.local.get('activityLog', (data) => {
    const container = document.getElementById('logContainer');
    if (!container || !data.activityLog || data.activityLog.length === 0) return;

    const empty = container.querySelector('.log-empty');
    if (empty) empty.remove();

    // Only restore if log is currently empty
    if (container.querySelectorAll('.log-entry').length > 0) return;

    for (const entry of data.activityLog) {
      const el = document.createElement('div');
      el.className = `log-entry ${entry.level}`;
      el.textContent = entry.text;
      container.appendChild(el);
    }
  });
}

// Export/Clear
async function exportHistory() {
  const data = await getStorageData('applicationHistory');
  const history = data.applicationHistory || [];
  if (history.length === 0) {
    showNotification('No application history to export.', 'warning');
    return;
  }

  const csv = convertToCSV(history);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `linkedin_applications_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showNotification('History exported!');
}

function convertToCSV(data) {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => `"${(row[h] || '').toString().replace(/"/g, '""')}"`).join(','));
  return [headers.join(','), ...rows].join('\n');
}

function clearAllData() {
  if (confirm('Are you sure you want to clear ALL data including credentials? This cannot be undone.')) {
    chrome.storage.local.clear(() => {
      showNotification('All data cleared!');
      // Go back to onboarding
      document.getElementById('mainApp').style.display = 'none';
      document.getElementById('onboarding').style.display = 'block';
    });
  }
}

// Helpers
function getVal(id) { return document.getElementById(id)?.value || ''; }
function setVal(id, val) { if (val !== undefined && val !== null) document.getElementById(id).value = val; }
function getChecked(id) { return document.getElementById(id)?.checked || false; }
function setChecked(id, val) { const el = document.getElementById(id); if (el) el.checked = val; }

function getStorageData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data));
  });
}

function showNotification(msg, type = 'success') {
  addLogEntry(msg, type);
}

// ===== USER ACCOUNT UI =====
function updateUserAccountUI() {
  const user = getCurrentUser();
  if (user) {
    const nameEl = document.getElementById('userDisplayName');
    const badgeEl = document.getElementById('userPlanBadge');
    if (nameEl) nameEl.textContent = user.displayName || user.email;

    // Show typed user ID if available
    chrome.storage.local.get('cachedUserId', (data) => {
      if (data.cachedUserId && nameEl) {
        const displayName = user.displayName || user.email;
        nameEl.textContent = `${displayName}`;
        nameEl.title = data.cachedUserId; // Show ID on hover
      }
      // Display user ID in the account card
      const userIdEl = document.getElementById('userIdDisplay');
      if (userIdEl && data.cachedUserId) {
        userIdEl.textContent = `ID: ${data.cachedUserId}`;
      }
    });

    // Update badge based on role and plan from DB (cached locally)
    if (badgeEl) {
      getUserPlanStatus().then(({ plan, isActive, role }) => {
        if (role === USER_ROLES.ADMIN) {
          badgeEl.textContent = 'Admin';
          badgeEl.style.background = 'rgba(16, 185, 129, 0.15)';
          badgeEl.style.color = '#10b981';
          badgeEl.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        } else if (plan === 'pro' && isActive) {
          badgeEl.textContent = 'Pro';
          badgeEl.style.background = 'rgba(99, 102, 241, 0.15)';
          badgeEl.style.color = '#6366f1';
          badgeEl.style.borderColor = 'rgba(99, 102, 241, 0.3)';
        } else {
          badgeEl.textContent = 'Free';
          badgeEl.style.background = '';
          badgeEl.style.color = '';
          badgeEl.style.borderColor = '';
        }
      });
    }
  }

  // Logout button
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOutUser();
    showScreen('authLogin');
  });
}

/**
 * Fetch user role from Firestore and cache it locally.
 * This ensures the content script can check the role without Firebase access.
 * Falls back gracefully if Firestore read fails (e.g., security rules).
 */
async function fetchAndCacheUserRole(user) {
  try {
    const doc = await db.collection('users').doc(user.uid).get();
    if (doc.exists) {
      const data = doc.data();
      const role = data.role || USER_ROLES.USER;
      const plan = data.plan || PLAN_TYPES.FREE;
      const expiresAt = data.planExpiresAt?.toDate() || null;
      await new Promise(resolve => {
        chrome.storage.local.set({
          userRole: role,
          userPlan: plan,
          planExpiresAt: expiresAt ? expiresAt.toISOString() : null,
          planCachedAt: new Date().toISOString(),
          cachedUserId: data.userId || null,
        }, resolve);
      });
      console.log(`[JobPilot] Cached user role: ${role}, plan: ${plan}`);
    } else {
      console.warn('[JobPilot] User document not found in Firestore. Using defaults.');
    }
  } catch (error) {
    console.warn('[JobPilot] Failed to fetch user role:', error.message);
    // If Firestore read fails (e.g., security rules), check if we have
    // locally cached data from a previous successful read
    const cached = await new Promise(resolve => {
      chrome.storage.local.get(['userRole', 'userPlan'], resolve);
    });
    if (!cached.userRole) {
      // No cached data — set defaults
      await new Promise(resolve => {
        chrome.storage.local.set({
          userRole: USER_ROLES.USER,
          userPlan: PLAN_TYPES.FREE,
          planCachedAt: new Date().toISOString(),
        }, resolve);
      });
    }
  }
}

// ===== CLOUD SYNC ON SAVE =====
// Override save functions to also sync to Firestore

const originalSaveProfile = saveProfile;
saveProfile = function() {
  originalSaveProfile();
  saveUserDataToCloud('profile');
};

const originalSaveSearch = saveSearch;
saveSearch = function() {
  originalSaveSearch();
  saveUserDataToCloud('search');
};

const originalSaveQuestions = saveQuestions;
saveQuestions = function() {
  originalSaveQuestions();
  saveUserDataToCloud('questions');
};

const originalSaveSettings = saveSettings;
saveSettings = function() {
  originalSaveSettings();
  saveUserDataToCloud('settings');
};
