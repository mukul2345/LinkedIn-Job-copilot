// popup.js - Extension popup UI logic

document.addEventListener('DOMContentLoaded', async () => {
  await removeLegacyLinkedInCredentials();
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
  onAuthStateChange(async (user) => {
    if (user) {
      await removeLegacyLinkedInCredentials(user.uid);
      // Cache user email for content script context
      chrome.storage.local.set({ cachedUserEmail: user.email });
      // Small delay to ensure auth token is fully ready before Firestore read
      setTimeout(() => fetchAndCacheUserRole(user), 500);
      // User is signed in — show main app immediately
      checkOnboardingState();
      // Load user profile from Firestore and refresh UI
      const uid = user.uid;
      loadUserProfile(uid).then(() => {
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
    loadUserProfile(result.user.uid).then(() => {
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

// ===== ONBOARDING (manual LinkedIn login) =====
async function checkOnboardingState() {
  const user = getCurrentUser();
  if (!user) return;

  const userData = await loadUserProfile(user.uid);
  const isComplete = userData && userData.onboardingComplete;
  const localData = await getStorageData(['onboardingComplete']);

  if (isComplete || localData.onboardingComplete) {
    showMainApp();
  } else {
    showScreen('onboarding');
    document.getElementById('continueOnboardingBtn')?.addEventListener(
      'click',
      completeOnboarding,
      { once: true },
    );
  }
}

async function completeOnboarding() {
  const user = getCurrentUser();
  if (!user) return;

  await removeLegacyLinkedInCredentials(user.uid);
  try {
    await db.collection('users').doc(user.uid).update({
      onboardingComplete: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.warn('[Popup] Could not persist onboarding status.', error);
  }

  await chrome.storage.local.set({
    onboardingComplete: true,
    setupDate: new Date().toISOString(),
  });
  await trackSession('setup');
  showMainApp();
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
  loadSkillMapEditor();
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

// Load all saved settings from Firestore (with cache)
async function loadAllSettings() {
  const user = getCurrentUser();
  if (!user) return;

  // Load full user profile from Firestore (uses cache if valid)
  const userData = await loadUserProfile(user.uid);
  if (!userData) {
    console.warn('[Popup] User profile not found in Firestore. Showing empty form.');
    return; // Don't show error — user might be new and doc is being created
  }

  const profile = userData.profile || {};
  const prefs = userData.preferences || {};
  const templates = userData.templates || {};
  const botSettings = userData.botSettings || {};

  await removeLegacyLinkedInCredentials(user.uid);

  // Profile
  setVal('firstName', profile.firstName);
  setVal('middleName', profile.middleName);
  setVal('lastName', profile.lastName);
  setVal('phoneNumber', profile.phoneNumber);
  setVal('currentCity', profile.currentCity);
  setVal('street', profile.street);
  setVal('state', profile.state);
  setVal('zipcode', profile.zipcode);
  setVal('country', profile.country);
  setVal('ethnicity', profile.ethnicity);
  setVal('gender', profile.gender);
  setVal('disabilityStatus', profile.disabilityStatus);
  setVal('veteranStatus', profile.veteranStatus);

  // Search preferences
  if (prefs.searchTerms) document.getElementById('searchTerms').value = prefs.searchTerms.join('\n');
  setVal('searchLocation', prefs.searchLocation);
  setVal('datePosted', prefs.datePosted);
  setVal('experienceLevel', prefs.experienceLevel ? prefs.experienceLevel.join(', ') : '');
  setVal('jobType', prefs.jobType ? prefs.jobType.join(', ') : '');
  setVal('workStyle', prefs.workStyle ? prefs.workStyle.join(', ') : '');
  setChecked('easyApplyOnly', prefs.easyApplyOnly !== false);
  if (prefs.badWords) document.getElementById('badWords').value = prefs.badWords.join('\n');
  if (prefs.blacklistCompanies) document.getElementById('blacklistCompanies').value = prefs.blacklistCompanies.join('\n');
  setVal('currentExperience', prefs.currentExperience ?? '');
  setVal('switchNumber', prefs.switchNumber ?? 30);

  // Questions (extended profile fields)
  setVal('yearsOfExperience', profile.yearsOfExperience);
  setVal('requireVisa', profile.requireVisa);
  setVal('website', profile.website);
  setVal('linkedInUrl', profile.linkedInUrl);
  setVal('usCitizenship', profile.usCitizenship);
  setVal('desiredSalary', profile.desiredSalary);
  setVal('currentCtc', profile.currentCtc);
  setVal('noticePeriod', profile.noticePeriod);
  setVal('recentEmployer', profile.recentEmployer);
  setVal('confidenceLevel', profile.confidenceLevel);
  setVal('linkedinHeadline', profile.linkedinHeadline);
  setVal('linkedinSummary', profile.linkedinSummary);
  setVal('coverLetter', templates.coverLetter);

  // Settings - Bot
  setChecked('pauseBeforeSubmit', botSettings.pauseBeforeSubmit === true);
  setChecked('followCompanies', botSettings.followCompanies === true);
  setChecked('messageRecruiter', botSettings.messageRecruiter !== false);
  setVal('clickGap', botSettings.clickGap ?? 2);
  setChecked('useAI', botSettings.useAI === true);
  // Remove legacy client-side provider credentials; AI now runs only in Cloud Functions.
  chrome.storage.local.remove(['aiProvider', 'aiApiUrl', 'aiApiKey', 'aiModel']);

  // HR Outreach — no hardcoded default template
  setVal('hrMessageTemplate', templates.hrMessage || '');
  setVal('recruiterMessageTemplate', templates.recruiterMessage || '');
  setVal('hrDailyLimit', templates.hrDailyLimit ?? 25);
  setVal('hrDelayBetween', templates.hrDelayBetween ?? 60);

  // Stats — read from Firestore usage data
  const today = new Date().toISOString().split('T')[0];
  const todayUsage = (userData.usage && userData.usage[today]) || { applications: 0, hrMessages: 0 };
  document.getElementById('appliedCount').textContent = todayUsage.applications || 0;
  document.getElementById('skippedCount').textContent = 0; // Skipped/failed are session-local, not persisted
  document.getElementById('failedCount').textContent = 0;
}

async function loadActivityData() {
  // Activity stats are kept in chrome.storage.local (session tracking is ephemeral)
  const data = await getStorageData(['totalSessions', 'totalAppliedAllTime', 'lastActiveDate']);

  document.getElementById('totalSessions').textContent = data.totalSessions || 0;
  document.getElementById('totalApplied').textContent = data.totalAppliedAllTime || 0;

  if (data.lastActiveDate) {
    const date = new Date(data.lastActiveDate);
    document.getElementById('lastActive').textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

/**
 * Load and render the skill map editor with the user's saved skills.
 */
async function loadSkillMapEditor() {
  const user = getCurrentUser();
  if (!user) return;

  const container = document.getElementById('skillMapEditorContainer');
  if (!container) return;

  const userData = await loadUserProfile(user.uid);
  const skillMap = (userData && userData.skillMap) || {};
  renderSkillMapEditor(container, skillMap);
}

/**
 * Save skill map from the editor to Firestore.
 */
async function handleSaveSkillMap() {
  const user = getCurrentUser();
  if (!user) { showNotification('Please sign in first.', 'error'); return; }

  const container = document.getElementById('skillMapEditorContainer');
  if (!container) return;

  const skillMap = getSkillMapFromEditor(container);

  if (Object.keys(skillMap).length === 0) {
    showNotification('Please add at least one skill.', 'warning');
    return;
  }

  const success = await saveSkillMap(user.uid, skillMap);
  if (success) {
    showNotification('Skills saved!');
  } else {
    showNotification('Failed to save skills. Check your connection.', 'error');
  }
}

function initButtons() {
  // Save buttons
  document.getElementById('saveProfile').addEventListener('click', saveProfile);
  document.getElementById('saveSearch').addEventListener('click', saveSearch);
  document.getElementById('saveQuestions').addEventListener('click', saveQuestions);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('saveSkillMap')?.addEventListener('click', handleSaveSkillMap);

  // Action buttons
  document.getElementById('startBtn').addEventListener('click', startApplying);
  document.getElementById('stopBtn').addEventListener('click', stopApplying);
  document.getElementById('messageHRsBtn').addEventListener('click', startHRMessages);
  document.getElementById('stopHRBtn').addEventListener('click', stopHRMessages);
  document.getElementById('exportData').addEventListener('click', exportHistory);
  document.getElementById('clearData').addEventListener('click', clearAllData);
}

// Save functions — Write to Firestore first, then update local cache
async function saveProfile() {
  const user = getCurrentUser();
  if (!user) { showNotification('Please sign in first.', 'error'); return; }

  const profileData = {
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
    veteranStatus: getVal('veteranStatus'),
  };

  if (!profileData.firstName || !profileData.lastName) {
    showNotification('First name and last name are required.', 'error');
    return;
  }

  const success = await saveUserProfile(user.uid, profileData);
  if (success) {
    showNotification('Profile saved!');
  } else {
    showNotification('Failed to save profile. Check your connection.', 'error');
  }
}

async function saveSearch() {
  const user = getCurrentUser();
  if (!user) { showNotification('Please sign in first.', 'error'); return; }

  const currentExperienceValue = getVal('currentExperience');
  const parsedCurrentExperience = currentExperienceValue === '' ? null : Number(currentExperienceValue);
  const prefs = {
    searchTerms: getVal('searchTerms').split('\n').map(s => s.trim()).filter(Boolean),
    searchLocation: getVal('searchLocation'),
    datePosted: getVal('datePosted'),
    experienceLevel: getVal('experienceLevel').split(',').map(s => s.trim()).filter(Boolean),
    jobType: getVal('jobType').split(',').map(s => s.trim()).filter(Boolean),
    workStyle: getVal('workStyle').split(',').map(s => s.trim()).filter(Boolean),
    easyApplyOnly: getChecked('easyApplyOnly'),
    badWords: getVal('badWords').split('\n').map(s => s.trim()).filter(Boolean),
    blacklistCompanies: getVal('blacklistCompanies').split('\n').map(s => s.trim()).filter(Boolean),
    currentExperience: Number.isFinite(parsedCurrentExperience) ? parsedCurrentExperience : null,
    switchNumber: parseInt(getVal('switchNumber')) || 30,
  };

  const success = await savePreferences(user.uid, prefs);
  if (success) {
    await saveSearchPreferences({ location: prefs.searchLocation });
    showNotification('Search preferences saved!');
  } else {
    showNotification('Failed to save preferences. Check your connection.', 'error');
  }
}

async function saveQuestions() {
  const user = getCurrentUser();
  if (!user) { showNotification('Please sign in first.', 'error'); return; }

  const parseOptionalNumber = value => {
    if (value === '') return null;
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null;
  };

  // Questions are part of the profile (extended personal data)
  const questionData = {
    yearsOfExperience: getVal('yearsOfExperience'),
    requireVisa: getVal('requireVisa'),
    website: getVal('website'),
    linkedInUrl: getVal('linkedInUrl'),
    usCitizenship: getVal('usCitizenship'),
    desiredSalary: parseOptionalNumber(getVal('desiredSalary')),
    currentCtc: parseOptionalNumber(getVal('currentCtc')),
    noticePeriod: parseOptionalNumber(getVal('noticePeriod')),
    recentEmployer: getVal('recentEmployer'),
    confidenceLevel: getVal('confidenceLevel'),
    linkedinHeadline: getVal('linkedinHeadline'),
    linkedinSummary: getVal('linkedinSummary'),
  };

  // Templates are separate (cover letter goes there)
  const templates = {
    coverLetter: getVal('coverLetter'),
  };

  // Merge question data into profile
  try {
    await db.collection('users').doc(user.uid).update({
      'profile.yearsOfExperience': questionData.yearsOfExperience,
      'profile.requireVisa': questionData.requireVisa,
      'profile.website': questionData.website,
      'profile.linkedInUrl': questionData.linkedInUrl,
      'profile.usCitizenship': questionData.usCitizenship,
      'profile.desiredSalary': questionData.desiredSalary,
      'profile.currentCtc': questionData.currentCtc,
      'profile.noticePeriod': questionData.noticePeriod,
      'profile.recentEmployer': questionData.recentEmployer,
      'profile.confidenceLevel': questionData.confidenceLevel,
      'profile.linkedinHeadline': questionData.linkedinHeadline,
      'profile.linkedinSummary': questionData.linkedinSummary,
      'templates.coverLetter': templates.coverLetter,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await invalidateCache('profile');
    await invalidateCache('templates');
    await invalidateCache('fullProfile');
    showNotification('Answers saved!');
  } catch (err) {
    console.error('[Popup] Failed to save questions:', err.message);
    showNotification('Failed to save answers. Check your connection.', 'error');
  }
}

async function saveSettings() {
  const user = getCurrentUser();
  if (!user) { showNotification('Please sign in first.', 'error'); return; }

  const botSettings = {
    pauseBeforeSubmit: getChecked('pauseBeforeSubmit'),
    followCompanies: getChecked('followCompanies'),
    messageRecruiter: getChecked('messageRecruiter'),
    clickGap: parseInt(getVal('clickGap')) || 2,
    useAI: getChecked('useAI'),
  };
  chrome.storage.local.remove(['aiProvider', 'aiApiUrl', 'aiApiKey', 'aiModel']);

  const templates = {
    hrMessage: getVal('hrMessageTemplate'),
    recruiterMessage: getVal('recruiterMessageTemplate'),
    hrDailyLimit: parseInt(getVal('hrDailyLimit')) || 25,
    hrDelayBetween: parseInt(getVal('hrDelayBetween')) || 60,
  };

  // Read existing templates to preserve coverLetter
  const existingTemplates = await getCached('templates') || {};

  const mergedTemplates = {
    ...existingTemplates,
    hrMessage: templates.hrMessage,
    recruiterMessage: templates.recruiterMessage,
    hrDailyLimit: templates.hrDailyLimit,
    hrDelayBetween: templates.hrDelayBetween,
  };

  const botSuccess = await saveBotSettings(user.uid, botSettings);
  const templateSuccess = await saveTemplates(user.uid, mergedTemplates);

  if (botSuccess && templateSuccess) {
    showNotification('Settings saved!');
  } else {
    showNotification('Failed to save some settings. Check your connection.', 'error');
  }
}

// Start/Stop
async function startApplying() {
  const user = getCurrentUser();
  if (!user) { showNotification('Please sign in first.', 'error'); return; }

  const userData = await loadUserProfile(user.uid);
  if (!userData) { showNotification('Failed to load your profile.', 'error'); return; }

  const prefs = userData.preferences || {};
  const profile = userData.profile || {};
  if (!Array.isArray(prefs.searchTerms) || prefs.searchTerms.length === 0) {
    showNotification('Please configure search terms first!', 'error');
    return;
  }
  if (!profile.firstName) {
    showNotification('Please fill in your profile first!', 'error');
    return;
  }

  const storedBotSettings = userData.botSettings || {};
  const parsedClickGap = Number(storedBotSettings.clickGap);
  const botSettings = {
    pauseBeforeSubmit: storedBotSettings.pauseBeforeSubmit === true,
    followCompanies: storedBotSettings.followCompanies === true,
    messageRecruiter: storedBotSettings.messageRecruiter !== false,
    clickGap: Number.isFinite(parsedClickGap) ? parsedClickGap : 2,
    useAI: storedBotSettings.useAI === true,
  };

  await trackSession('start');
  await removeLegacyLinkedInCredentials(user.uid);
  await chrome.storage.local.set({
    ...profile,
    ...prefs,
    ...botSettings,
    skillMap: userData.skillMap || {},
    templates: userData.templates || {},
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url || '';
  const isOnLinkedIn = tabUrl.includes('linkedin.com');
  const requiresManualLogin = /linkedin\.com\/(login|checkpoint)|linkedin\.com\/authwall/.test(tabUrl);

  await chrome.storage.local.set({ botRunning: true });
  updateUI(true);

  if (!isOnLinkedIn) {
    await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' });
    showNotification('Opening LinkedIn. Sign in manually if prompted; the bot will continue after login.', 'info');
    return;
  }

  if (requiresManualLogin) {
    showNotification('Please sign in to LinkedIn manually. The bot will continue after login.', 'info');
    return;
  }

  chrome.runtime.sendMessage(MessageProtocol.create(MessageType.START_BOT));
}

function stopApplying() {
  chrome.storage.local.set({ botRunning: false });
  chrome.storage.local.remove('pendingAutoLogin');
  chrome.runtime.sendMessage(MessageProtocol.create(MessageType.STOP_BOT));
  updateUI(false);
  trackSession('stop');
}

async function startHRMessages() {
  const data = await getStorageData(['hrBotRunning']);

  if (data.hrBotRunning) {
    stopHRMessages();
    return;
  }

  // Check template from Firestore (via cache)
  const user = getCurrentUser();
  if (!user) { showNotification('Please sign in first.', 'error'); return; }

  const userData = await loadUserProfile(user.uid);
  const templates = (userData && userData.templates) || {};

  if (!templates.hrMessage) {
    showNotification('Please set an HR message template in Settings first!', 'error');
    return;
  }

  // Check daily limit — get today's sent count from messagedHRs
  const messagedHRs = await getStorageData(['messagedHRs']);
  const allMessaged = messagedHRs.messagedHRs || [];
  const today = new Date().toISOString().split('T')[0];
  const todaySent = allMessaged.filter(h => h.date && h.date.startsWith(today)).length;
  const dailyLimit = templates.hrDailyLimit || 25;

  if (todaySent >= dailyLimit) {
    showNotification(`Daily limit reached (${todaySent}/${dailyLimit}). Try again tomorrow.`, 'warning');
    return;
  }

  // Warn if approaching LinkedIn's spam threshold (20+ messages)
  if (todaySent >= 20) {
    const proceed = confirm(
      `⚠️ LinkedIn Security Warning\n\nYou've already sent ${todaySent} messages today. ` +
      `LinkedIn may flag your account as spam if you send more than 20 messages per day.\n\n` +
      `Are you sure you want to continue?`
    );
    if (!proceed) {
      showNotification('HR outreach cancelled. Your account is safe.', 'info');
      return;
    }
  }

  // Push templates + config to chrome.storage.local for the content script bot to read
  await chrome.storage.local.set({
    hrBotRunning: true,
    templates: templates,
    hrDailyLimit: dailyLimit,
    hrDelayBetween: templates.hrDelayBetween || 60,
  });

  // Check if on LinkedIn
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('linkedin.com')) {
    await chrome.tabs.create({ url: 'https://www.linkedin.com/search/results/people/?keywords=recruiter%20OR%20HR%20OR%20talent%20acquisition&network=%5B%22F%22%5D&origin=FACETED_SEARCH' });
  }

  chrome.runtime.sendMessage(MessageProtocol.create(MessageType.START_HR));

  document.getElementById('messageHRsBtn').disabled = true;
  document.getElementById('stopHRBtn').disabled = false;
  document.getElementById('hrStatus').textContent = '💬 HR messaging active...';
  showNotification('HR outreach started!', 'info');
}

function stopHRMessages() {
  chrome.storage.local.set({ hrBotRunning: false });
  chrome.runtime.sendMessage(MessageProtocol.create(MessageType.STOP_HR));
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
  chrome.runtime.onMessage.addListener((message, sender) => {
    const validation = MessageProtocol.validate(message);
    if (!MessageProtocol.validateSender(sender) || !validation.valid) return false;
    if (message.type === MessageType.STATUS) {
      document.getElementById('appliedCount').textContent = message.applied || 0;
      document.getElementById('skippedCount').textContent = message.skipped || 0;
      document.getElementById('failedCount').textContent = message.failed || 0;
    }
    if (message.type === MessageType.LOG) addLogEntry(message.message, message.level || 'info');
    if (message.type === MessageType.STOPPED) updateUI(false);
    return false;
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
  const user = getCurrentUser();
  if (!user) { showNotification('Please sign in first.', 'error'); return; }

  const userData = await loadUserProfile(user.uid);
  const history = (userData && userData.applicationHistory) || [];

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

async function clearAllData() {
  if (confirm('Are you sure you want to clear ALL extension data? This cannot be undone.')) {
    // Sign out first to prevent auth state listener from firing on empty storage
    try {
      await signOutUser();
    } catch (e) { /* ignore if auth fails */ }

    // Only remove known extension keys, not all of chrome.storage
    const keysToRemove = [
      'linkedinEmail', 'linkedinPassword', 'credentialsObfuscated',
      'credentialOwnerUid',
      'onboardingComplete', 'loginMode', 'setupDate',
      'firstName', 'middleName', 'lastName', 'phoneNumber',
      'currentCity', 'street', 'state', 'zipcode', 'country',
      'ethnicity', 'gender', 'disabilityStatus', 'veteranStatus',
      'searchTerms', 'searchLocation', 'datePosted',
      'experienceLevel', 'jobType', 'workStyle', 'easyApplyOnly',
      'badWords', 'blacklistCompanies', 'currentExperience', 'switchNumber',
      'yearsOfExperience', 'requireVisa', 'website', 'linkedInUrl',
      'usCitizenship', 'desiredSalary', 'currentCtc', 'noticePeriod',
      'recentEmployer', 'confidenceLevel', 'linkedinHeadline',
      'linkedinSummary', 'coverLetter',
      'pauseBeforeSubmit', 'followCompanies', 'messageRecruiter',
      'clickGap', 'useAI', 'aiProvider', 'aiApiUrl', 'aiApiKey', 'aiModel',
      'applicationStatesV1',
      'hrMessageTemplate', 'hrDailyLimit', 'hrDelayBetween',
      'botRunning', 'hrBotRunning', 'botState', 'hrBotState',
      'pendingAutoLogin', 'applicationHistory', 'messagedHRs',
      'appliedCount', 'skippedCount', 'failedCount',
      'totalSessions', 'totalAppliedAllTime', 'lastActiveDate',
      'activityLog', 'userPlan', 'planExpiresAt', 'planCachedAt',
      'userRole', 'cachedUserEmail', 'cachedUserId', 'pendingPayment',
      'gmailConnected', 'trackerEntries', 'trackerLastScan',
    ];

    chrome.storage.local.remove(keysToRemove, () => {
      showNotification('All data cleared!');
      showScreen('authLogin');
    });
  }
}

// Helpers
function getVal(id) { return document.getElementById(id)?.value || ''; }
function setVal(id, val) { const el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; }
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
// No longer needed — save functions now write directly to Firestore.
// Local cache is updated after successful Firestore writes via firestore-service.js.
