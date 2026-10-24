// tracker-ui.js - Tracker dashboard rendering logic for JobPilot Enhanced Features
// Provides UI helper functions to render application tracker entries grouped by company,
// with status badges, date formatting, and correction/dismissal controls.

/** Return whether a value is a safe tracker entry identifier. */
function isValidTrackerEntryId(entryId) {
  return typeof entryId === 'string' &&
    entryId.length > 0 &&
    entryId.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(entryId);
}

/** Return the status badge configuration for a tracker status. */
function getStatusBadge(status) {
  var badges = {
    interview: { label: 'Interview', color: '#10b981', icon: '📞' },
    rejection: { label: 'Rejected', color: '#ef4444', icon: '❌' },
    offer: { label: 'Offer!', color: '#f59e0b', icon: '🎉' },
    unknown: { label: 'Unknown', color: '#6b7280', icon: '❓' },
  };

  return badges[status] || badges.unknown;
}

/** Format an ISO date string into a human-readable date. */
function formatTrackerDate(isoString) {
  if (!isoString) return '';

  try {
    var date = new Date(isoString);
    if (isNaN(date.getTime())) return '';

    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  } catch (error) {
    return '';
  }
}

/** Group non-dismissed entries with valid identifiers by company name. */
function groupEntriesByCompany(entries) {
  var groups = new Map();
  if (!Array.isArray(entries)) return groups;

  for (var index = 0; index < entries.length; index++) {
    var entry = entries[index];
    if (!entry || entry.dismissed || !isValidTrackerEntryId(entry.id)) continue;

    var company = String(entry.company || 'Unknown Company');
    if (!groups.has(company)) groups.set(company, []);
    groups.get(company).push(entry);
  }

  return groups;
}

/** Create an element with a class and text without interpreting untrusted markup. */
function createTrackerTextElement(tagName, className, text) {
  var element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

/** Render one tracker entry as a DOM node, or null for an invalid entry. */
function renderTrackerEntry(entry) {
  if (!entry || !isValidTrackerEntryId(entry.id)) return null;

  var badge = getStatusBadge(entry.status);
  var entryElement = document.createElement('div');
  entryElement.className = 'tracker-entry';
  entryElement.dataset.entryId = entry.id;

  entryElement.appendChild(createTrackerTextElement(
    'span',
    'tracker-date',
    '📅 ' + formatTrackerDate(entry.emailDate)
  ));

  var badgeElement = createTrackerTextElement(
    'span',
    'tracker-badge',
    badge.icon + ' ' + badge.label
  );
  badgeElement.style.backgroundColor = badge.color;
  badgeElement.style.color = '#fff';
  badgeElement.style.padding = '2px 8px';
  badgeElement.style.borderRadius = '4px';
  badgeElement.style.fontSize = '12px';
  entryElement.appendChild(badgeElement);

  entryElement.appendChild(createTrackerTextElement(
    'span',
    'tracker-subject',
    String(entry.emailSubject || '(No subject)')
  ));

  var actions = document.createElement('span');
  actions.className = 'tracker-actions';

  var correctButton = createTrackerTextElement('button', 'tracker-btn-correct', '✏️');
  correctButton.type = 'button';
  correctButton.dataset.entryId = entry.id;
  correctButton.title = 'Correct status';
  actions.appendChild(correctButton);

  var dismissButton = createTrackerTextElement('button', 'tracker-btn-dismiss', '🗑️');
  dismissButton.type = 'button';
  dismissButton.dataset.entryId = entry.id;
  dismissButton.title = 'Dismiss entry';
  actions.appendChild(dismissButton);

  entryElement.appendChild(actions);
  return entryElement;
}

/** Render the tracker dashboard as a DOM node. */
function renderTrackerDashboard(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    var emptyState = document.createElement('div');
    emptyState.className = 'tracker-empty';
    emptyState.appendChild(createTrackerTextElement('p', '', 'No tracked applications yet.'));
    emptyState.appendChild(createTrackerTextElement(
      'p',
      '',
      'Connect Gmail and scan your inbox to detect interview invitations, rejections, and offers.'
    ));
    return emptyState;
  }

  var groups = groupEntriesByCompany(entries);
  if (groups.size === 0) {
    var dismissedState = document.createElement('div');
    dismissedState.className = 'tracker-empty';
    dismissedState.appendChild(createTrackerTextElement('p', '', 'All entries have been dismissed.'));
    return dismissedState;
  }

  var dashboard = document.createElement('div');
  dashboard.className = 'tracker-dashboard';

  groups.forEach(function (companyEntries, company) {
    companyEntries.sort(function (firstEntry, secondEntry) {
      var firstDate = firstEntry.emailDate ? new Date(firstEntry.emailDate).getTime() : 0;
      var secondDate = secondEntry.emailDate ? new Date(secondEntry.emailDate).getTime() : 0;
      return secondDate - firstDate;
    });

    var companyGroup = document.createElement('div');
    companyGroup.className = 'tracker-company-group';
    companyGroup.appendChild(createTrackerTextElement('h3', 'tracker-company-name', company));

    for (var index = 0; index < companyEntries.length; index++) {
      var entryElement = renderTrackerEntry(companyEntries[index]);
      if (entryElement) companyGroup.appendChild(entryElement);
    }
    dashboard.appendChild(companyGroup);
  });

  return dashboard;
}
