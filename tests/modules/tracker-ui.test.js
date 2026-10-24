// tests/modules/tracker-ui.test.js - Unit tests for tracker-ui.js

const fs = require('fs');
const path = require('path');

beforeEach(() => {
  resetChromeMocks();
  // Load tracker-ui.js into global scope (simulates content script injection)
  const code = fs.readFileSync(
    path.resolve(__dirname, '../../extension/modules/tracker/tracker-ui.js'),
    'utf8'
  );
  (0, eval)(code);
});

describe('getStatusBadge()', () => {
  it('should return interview badge config', () => {
    const badge = getStatusBadge('interview');
    expect(badge).toEqual({ label: 'Interview', color: '#10b981', icon: '📞' });
  });

  it('should return rejection badge config', () => {
    const badge = getStatusBadge('rejection');
    expect(badge).toEqual({ label: 'Rejected', color: '#ef4444', icon: '❌' });
  });

  it('should return offer badge config', () => {
    const badge = getStatusBadge('offer');
    expect(badge).toEqual({ label: 'Offer!', color: '#f59e0b', icon: '🎉' });
  });

  it('should return unknown badge config for unknown status', () => {
    const badge = getStatusBadge('unknown');
    expect(badge).toEqual({ label: 'Unknown', color: '#6b7280', icon: '❓' });
  });

  it('should default to unknown badge for unrecognized status', () => {
    const badge = getStatusBadge('something-else');
    expect(badge).toEqual({ label: 'Unknown', color: '#6b7280', icon: '❓' });
  });
});

describe('formatTrackerDate()', () => {
  it('should format a valid ISO date string', () => {
    const result = formatTrackerDate('2024-06-05T10:00:00Z');
    expect(result).toBe('Jun 5, 2024');
  });

  it('should handle January 1st correctly', () => {
    const result = formatTrackerDate('2024-01-01T00:00:00Z');
    expect(result).toBe('Jan 1, 2024');
  });

  it('should return empty string for null input', () => {
    expect(formatTrackerDate(null)).toBe('');
  });

  it('should return empty string for undefined input', () => {
    expect(formatTrackerDate(undefined)).toBe('');
  });

  it('should return empty string for invalid date', () => {
    expect(formatTrackerDate('not-a-date')).toBe('');
  });

  it('should return empty string for empty string', () => {
    expect(formatTrackerDate('')).toBe('');
  });
});

describe('groupEntriesByCompany()', () => {
  it('should group entries by company name', () => {
    const entries = [
      { id: '1', company: 'Google', status: 'interview', emailSubject: 'Interview', emailDate: '2024-06-05', dismissed: false },
      { id: '2', company: 'Meta', status: 'rejection', emailSubject: 'Update', emailDate: '2024-06-04', dismissed: false },
      { id: '3', company: 'Google', status: 'offer', emailSubject: 'Offer letter', emailDate: '2024-06-06', dismissed: false },
    ];

    const groups = groupEntriesByCompany(entries);
    expect(groups.size).toBe(2);
    expect(groups.get('Google').length).toBe(2);
    expect(groups.get('Meta').length).toBe(1);
  });

  it('should exclude dismissed entries', () => {
    const entries = [
      { id: '1', company: 'Google', status: 'interview', emailSubject: 'Test', emailDate: '2024-06-05', dismissed: true },
      { id: '2', company: 'Google', status: 'offer', emailSubject: 'Offer', emailDate: '2024-06-06', dismissed: false },
    ];

    const groups = groupEntriesByCompany(entries);
    expect(groups.get('Google').length).toBe(1);
    expect(groups.get('Google')[0].id).toBe('2');
  });

  it('should use "Unknown Company" for entries without company', () => {
    const entries = [
      { id: '1', company: null, status: 'unknown', emailSubject: 'Re: application', emailDate: '2024-06-05', dismissed: false },
    ];

    const groups = groupEntriesByCompany(entries);
    expect(groups.has('Unknown Company')).toBe(true);
    expect(groups.get('Unknown Company').length).toBe(1);
  });

  it('should return empty Map for null/undefined entries', () => {
    expect(groupEntriesByCompany(null).size).toBe(0);
    expect(groupEntriesByCompany(undefined).size).toBe(0);
  });

  it('should return empty Map for empty array', () => {
    expect(groupEntriesByCompany([]).size).toBe(0);
  });

  it('should return empty Map if all entries dismissed', () => {
    const entries = [
      { id: '1', company: 'Google', status: 'interview', emailSubject: 'Test', emailDate: '2024-06-05', dismissed: true },
    ];
    expect(groupEntriesByCompany(entries).size).toBe(0);
  });
});

describe('renderTrackerEntry()', () => {
  it('should render an entry with status badge, date, and subject', () => {
    const entry = {
      id: 'entry-1',
      company: 'Google',
      status: 'interview',
      emailSubject: 'Interview Invitation',
      emailDate: '2024-06-05T10:00:00Z',
      dismissed: false,
    };

    const element = renderTrackerEntry(entry);
    expect(element.dataset.entryId).toBe('entry-1');
    expect(element.textContent).toContain('Jun 5, 2024');
    expect(element.textContent).toContain('Interview Invitation');
    expect(element.querySelector('.tracker-badge').style.backgroundColor).toBe('rgb(16, 185, 129)');
    expect(element.querySelector('.tracker-btn-correct')).not.toBeNull();
    expect(element.querySelector('.tracker-btn-dismiss')).not.toBeNull();
  });

  it('should render malicious subject text without creating executable elements', () => {
    const entry = {
      id: 'entry-2',
      company: 'Test',
      status: 'unknown',
      emailSubject: '<img src=x onerror=alert("xss")><script>alert("xss")</script>',
      emailDate: '2024-06-05T10:00:00Z',
      dismissed: false,
    };

    const element = renderTrackerEntry(entry);
    expect(element.querySelector('script')).toBeNull();
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('.tracker-subject').textContent).toBe(entry.emailSubject);
  });

  it('should reject an invalid entry ID', () => {
    expect(renderTrackerEntry({
      id: '\"><img src=x onerror=alert(1)>',
      company: 'Test',
      status: 'unknown',
    })).toBeNull();
  });

  it('should show "(No subject)" when emailSubject is empty', () => {
    const element = renderTrackerEntry({
      id: 'entry-3',
      company: 'Test',
      status: 'rejection',
      emailSubject: '',
      emailDate: '2024-06-05T10:00:00Z',
      dismissed: false,
    });

    expect(element.textContent).toContain('(No subject)');
  });
});

describe('renderTrackerDashboard()', () => {
  it('should show empty state for no entries', () => {
    expect(renderTrackerDashboard([]).textContent).toContain('No tracked applications yet');
  });

  it('should show empty state for null entries', () => {
    expect(renderTrackerDashboard(null).textContent).toContain('No tracked applications yet');
  });

  it('should render entries grouped by company', () => {
    const entries = [
      { id: '1', company: 'Google', status: 'interview', emailSubject: 'Interview', emailDate: '2024-06-05T10:00:00Z', dismissed: false },
      { id: '2', company: 'Meta', status: 'rejection', emailSubject: 'Update', emailDate: '2024-06-04T10:00:00Z', dismissed: false },
      { id: '3', company: 'Google', status: 'offer', emailSubject: 'Congratulations!', emailDate: '2024-06-06T10:00:00Z', dismissed: false },
    ];

    const dashboard = renderTrackerDashboard(entries);
    expect(dashboard.textContent).toContain('Google');
    expect(dashboard.textContent).toContain('Meta');
    expect(dashboard.classList.contains('tracker-dashboard')).toBe(true);
    expect(dashboard.querySelectorAll('.tracker-company-group')).toHaveLength(2);
  });

  it('should show all dismissed message when all entries are dismissed', () => {
    const entries = [
      { id: '1', company: 'Google', status: 'interview', emailSubject: 'Test', emailDate: '2024-06-05T10:00:00Z', dismissed: true },
    ];

    expect(renderTrackerDashboard(entries).textContent).toContain('All entries have been dismissed');
  });

  it('should render malicious company text without creating elements', () => {
    const entries = [
      { id: '1', company: '<b>Evil Corp</b>', status: 'offer', emailSubject: 'Offer', emailDate: '2024-06-05T10:00:00Z', dismissed: false },
    ];

    const dashboard = renderTrackerDashboard(entries);
    expect(dashboard.querySelector('b')).toBeNull();
    expect(dashboard.querySelector('.tracker-company-name').textContent).toBe('<b>Evil Corp</b>');
  });
});
