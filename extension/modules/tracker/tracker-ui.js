// tracker-ui.js - Tracker dashboard rendering logic for JobPilot Enhanced Features
// Provides UI helper functions to render application tracker entries grouped by company,
// with status badges, date formatting, and correction/dismissal controls.

/**
 * Status badge configuration for each tracker status type.
 * @param {string} status - The tracker entry status
 * @returns {{label: string, color: string, icon: string}}
 */
function getStatusBadge(status) {
  var badges = {
    interview: { label: 'Interview', color: '#10b981', icon: '📞' },
    rejection: { label: 'Rejected', color: '#ef4444', icon: '❌' },
    offer: { label: 'Offer!', color: '#f59e0b', icon: '🎉' },
    unknown: { label: 'Unknown', color: '#6b7280', icon: '❓' },
  };

  return badges[status] || badges.unknown;
}

/**
 * Format an ISO date string into a human-readable date (e.g. "Jun 5, 2024").
 * @param {string} isoString - ISO 8601 date string
 * @returns {string} Formatted date string
 */
function formatTrackerDate(isoString) {
  if (!isoString) return '';

  try {
    var date = new Date(isoString);
    if (isNaN(date.getTime())) return '';

    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var month = months[date.getMonth()];
    var day = date.getDate();
    var year = date.getFullYear();

    return month + ' ' + day + ', ' + year;
  } catch (e) {
    return '';
  }
}

/**
 * Group tracker entries by company name.
 * @param {TrackerEntry[]} entries - Array of tracker entries
 * @returns {Map<string, TrackerEntry[]>} Map of company name to entries
 */
function groupEntriesByCompany(entries) {
  var groups = new Map();

  if (!entries || !Array.isArray(entries)) return groups;

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (entry.dismissed) continue;

    var company = entry.company || 'Unknown Company';
    if (!groups.has(company)) {
      groups.set(company, []);
    }
    groups.get(company).push(entry);
  }

  return groups;
}

/**
 * Render a single tracker entry as an HTML string with status badge, date, subject,
 * and correct/dismiss action buttons.
 * @param {TrackerEntry} entry - A single tracker entry
 * @returns {string} HTML string for the entry
 */
function renderTrackerEntry(entry) {
  var badge = getStatusBadge(entry.status);
  var dateStr = formatTrackerDate(entry.emailDate);
  var subject = entry.emailSubject || '(No subject)';

  // Escape HTML in subject to prevent XSS
  var escapedSubject = subject
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  var html = '<div class="tracker-entry" data-entry-id="' + entry.id + '">';
  html += '  <span class="tracker-date">📅 ' + dateStr + '</span>';
  html += '  <span class="tracker-badge" style="background-color: ' + badge.color + '; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 12px;">';
  html += '    ' + badge.icon + ' ' + badge.label;
  html += '  </span>';
  html += '  <span class="tracker-subject">' + escapedSubject + '</span>';
  html += '  <span class="tracker-actions">';
  html += '    <button class="tracker-btn-correct" data-entry-id="' + entry.id + '" title="Correct status">✏️</button>';
  html += '    <button class="tracker-btn-dismiss" data-entry-id="' + entry.id + '" title="Dismiss entry">🗑️</button>';
  html += '  </span>';
  html += '</div>';

  return html;
}

/**
 * Render the full tracker dashboard as an HTML string.
 * Entries are grouped by company, sorted by date descending within each group.
 * Dismissed entries are excluded.
 *
 * @param {TrackerEntry[]} entries - Array of all tracker entries
 * @returns {string} HTML string for the full dashboard
 */
function renderTrackerDashboard(entries) {
  if (!entries || entries.length === 0) {
    return '<div class="tracker-empty"><p>No tracked applications yet.</p><p>Connect Gmail and scan your inbox to detect interview invitations, rejections, and offers.</p></div>';
  }

  var groups = groupEntriesByCompany(entries);

  if (groups.size === 0) {
    return '<div class="tracker-empty"><p>All entries have been dismissed.</p></div>';
  }

  var html = '<div class="tracker-dashboard">';

  groups.forEach(function (companyEntries, company) {
    // Sort entries by date descending (most recent first)
    companyEntries.sort(function (a, b) {
      var dateA = a.emailDate ? new Date(a.emailDate).getTime() : 0;
      var dateB = b.emailDate ? new Date(b.emailDate).getTime() : 0;
      return dateB - dateA;
    });

    // Escape company name for HTML
    var escapedCompany = company
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    html += '<div class="tracker-company-group">';
    html += '  <h3 class="tracker-company-name">' + escapedCompany + '</h3>';

    for (var i = 0; i < companyEntries.length; i++) {
      html += renderTrackerEntry(companyEntries[i]);
    }

    html += '</div>';
  });

  html += '</div>';
  return html;
}
