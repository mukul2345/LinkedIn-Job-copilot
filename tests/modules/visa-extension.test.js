// tests/modules/visa-extension.test.js - Unit tests for extension/modules/visa/visa-service.js
// Tests the client-side visa module: badge rendering, filtering, confidence notes, and storage.

const { loadFile } = require('../helpers/load-modules');
const path = require('path');

// Mock callBackend (used by getSponsorshipStatus and getBatchSponsorshipStatus)
global.callBackend = jest.fn();

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/visa/visa-service.js'));
});

beforeEach(() => {
  resetChromeMocks();
  global.callBackend.mockReset();
});

// ===== getSponsorshipBadge() =====
describe('getSponsorshipBadge()', () => {
  it('returns green badge for "available" status', () => {
    const badge = getSponsorshipBadge('available');
    expect(badge).toEqual({
      label: 'Sponsorship',
      cssClass: 'badge-available',
      color: '#10b981',
    });
  });

  it('returns red badge for "unlikely" status', () => {
    const badge = getSponsorshipBadge('unlikely');
    expect(badge).toEqual({
      label: 'No Sponsor',
      cssClass: 'badge-unlikely',
      color: '#ef4444',
    });
  });

  it('returns gray badge for "unknown" status', () => {
    const badge = getSponsorshipBadge('unknown');
    expect(badge).toEqual({
      label: 'Unknown',
      cssClass: 'badge-unknown',
      color: '#6b7280',
    });
  });

  it('falls back to unknown badge for invalid status', () => {
    const badge = getSponsorshipBadge('invalid');
    expect(badge).toEqual({
      label: 'Unknown',
      cssClass: 'badge-unknown',
      color: '#6b7280',
    });
  });

  it('falls back to unknown badge for undefined', () => {
    const badge = getSponsorshipBadge(undefined);
    expect(badge).toEqual({
      label: 'Unknown',
      cssClass: 'badge-unknown',
      color: '#6b7280',
    });
  });

  it('falls back to unknown badge for null', () => {
    const badge = getSponsorshipBadge(null);
    expect(badge).toEqual({
      label: 'Unknown',
      cssClass: 'badge-unknown',
      color: '#6b7280',
    });
  });
});

// ===== getSponsorshipConfidenceNote() =====
describe('getSponsorshipConfidenceNote()', () => {
  it('returns note text for "reduced" confidence', () => {
    const note = getSponsorshipConfidenceNote('reduced');
    expect(note).toBe('Classification based on keyword matching only. AI analysis was unavailable.');
  });

  it('returns empty string for "full" confidence', () => {
    const note = getSponsorshipConfidenceNote('full');
    expect(note).toBe('');
  });

  it('returns empty string for undefined confidence', () => {
    const note = getSponsorshipConfidenceNote(undefined);
    expect(note).toBe('');
  });

  it('returns empty string for null confidence', () => {
    const note = getSponsorshipConfidenceNote(null);
    expect(note).toBe('');
  });
});

// ===== filterBySponsorshipStatus() =====
describe('filterBySponsorshipStatus()', () => {
  const sampleJobs = [
    { id: 'j1', title: 'Engineer', sponsorship: 'available' },
    { id: 'j2', title: 'Designer', sponsorship: 'unlikely' },
    { id: 'j3', title: 'Manager', sponsorship: 'unknown' },
    { id: 'j4', title: 'Intern', sponsorship: 'available' },
    { id: 'j5', title: 'Lead', sponsorship: null },
  ];

  it('returns only jobs matching a single status', () => {
    const result = filterBySponsorshipStatus(sampleJobs, ['available']);
    expect(result).toHaveLength(2);
    expect(result.map(j => j.id)).toEqual(['j1', 'j4']);
  });

  it('returns jobs matching multiple statuses', () => {
    const result = filterBySponsorshipStatus(sampleJobs, ['available', 'unknown']);
    expect(result).toHaveLength(3);
    expect(result.map(j => j.id)).toEqual(['j1', 'j3', 'j4']);
  });

  it('excludes jobs with null sponsorship when filtering', () => {
    const result = filterBySponsorshipStatus(sampleJobs, ['available', 'unlikely', 'unknown']);
    expect(result).toHaveLength(4);
    expect(result.find(j => j.id === 'j5')).toBeUndefined();
  });

  it('returns all jobs when statuses array is empty', () => {
    const result = filterBySponsorshipStatus(sampleJobs, []);
    expect(result).toHaveLength(5);
  });

  it('returns all jobs when statuses is null', () => {
    const result = filterBySponsorshipStatus(sampleJobs, null);
    expect(result).toHaveLength(5);
  });

  it('returns all jobs when statuses is undefined', () => {
    const result = filterBySponsorshipStatus(sampleJobs, undefined);
    expect(result).toHaveLength(5);
  });

  it('returns empty array when jobs is not an array', () => {
    expect(filterBySponsorshipStatus(null, ['available'])).toEqual([]);
    expect(filterBySponsorshipStatus(undefined, ['available'])).toEqual([]);
    expect(filterBySponsorshipStatus('string', ['available'])).toEqual([]);
  });

  it('returns empty array when no jobs match', () => {
    const jobs = [{ id: 'j1', sponsorship: 'unlikely' }];
    const result = filterBySponsorshipStatus(jobs, ['available']);
    expect(result).toEqual([]);
  });

  it('handles empty jobs array', () => {
    const result = filterBySponsorshipStatus([], ['available']);
    expect(result).toEqual([]);
  });
});

// ===== getSponsorshipStatus() =====
describe('getSponsorshipStatus()', () => {
  it('calls callBackend with correct endpoint and payload', async () => {
    global.callBackend.mockResolvedValue({ status: 'available', confidence: 'full' });

    const result = await getSponsorshipStatus('job-123');

    expect(global.callBackend).toHaveBeenCalledWith('classifySponsorship', { jobId: 'job-123' });
    expect(result).toEqual({ status: 'available', confidence: 'full' });
  });

  it('returns unlikely status from backend', async () => {
    global.callBackend.mockResolvedValue({ status: 'unlikely', confidence: 'full' });

    const result = await getSponsorshipStatus('job-456');
    expect(result).toEqual({ status: 'unlikely', confidence: 'full' });
  });

  it('returns reduced confidence from backend', async () => {
    global.callBackend.mockResolvedValue({ status: 'unknown', confidence: 'reduced' });

    const result = await getSponsorshipStatus('job-789');
    expect(result).toEqual({ status: 'unknown', confidence: 'reduced' });
  });

  it('propagates errors from callBackend', async () => {
    global.callBackend.mockRejectedValue(new Error('UNAUTHORIZED'));

    await expect(getSponsorshipStatus('job-err')).rejects.toThrow('UNAUTHORIZED');
  });
});

// ===== getBatchSponsorshipStatus() =====
describe('getBatchSponsorshipStatus()', () => {
  it('calls callBackend with jobIds array', async () => {
    const mockResult = {
      'job-1': { status: 'available', confidence: 'full' },
      'job-2': { status: 'unlikely', confidence: 'full' },
    };
    global.callBackend.mockResolvedValue(mockResult);

    const result = await getBatchSponsorshipStatus(['job-1', 'job-2']);

    expect(global.callBackend).toHaveBeenCalledWith('classifySponsorship', { jobIds: ['job-1', 'job-2'] });
    expect(result).toEqual(mockResult);
  });

  it('propagates errors from callBackend', async () => {
    global.callBackend.mockRejectedValue(new Error('NETWORK_ERROR'));

    await expect(getBatchSponsorshipStatus(['job-1'])).rejects.toThrow('NETWORK_ERROR');
  });
});

// ===== saveVisaFilterPreference() and getVisaFilterPreference() =====
describe('visa filter preference persistence', () => {
  it('saves filter statuses to chrome.storage.local', async () => {
    await saveVisaFilterPreference(['available', 'unknown']);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { visaFilterStatuses: ['available', 'unknown'] },
      expect.any(Function)
    );
  });

  it('reads saved filter statuses from chrome.storage.local', async () => {
    setMockStorageData({ visaFilterStatuses: ['unlikely'] });

    const result = await getVisaFilterPreference();
    expect(result).toEqual(['unlikely']);
  });

  it('returns empty array when no preference saved', async () => {
    const result = await getVisaFilterPreference();
    expect(result).toEqual([]);
  });

  it('round-trips save and read', async () => {
    const statuses = ['available', 'unlikely'];
    await saveVisaFilterPreference(statuses);
    const result = await getVisaFilterPreference();
    expect(result).toEqual(statuses);
  });
});

// ===== SPONSORSHIP_BADGE_CONFIG =====
describe('SPONSORSHIP_BADGE_CONFIG', () => {
  it('defines all three sponsorship statuses', () => {
    expect(SPONSORSHIP_BADGE_CONFIG).toHaveProperty('available');
    expect(SPONSORSHIP_BADGE_CONFIG).toHaveProperty('unlikely');
    expect(SPONSORSHIP_BADGE_CONFIG).toHaveProperty('unknown');
  });

  it('each config has label, cssClass, and color', () => {
    for (const key of ['available', 'unlikely', 'unknown']) {
      const config = SPONSORSHIP_BADGE_CONFIG[key];
      expect(config).toHaveProperty('label');
      expect(config).toHaveProperty('cssClass');
      expect(config).toHaveProperty('color');
      expect(typeof config.label).toBe('string');
      expect(typeof config.cssClass).toBe('string');
      expect(config.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('uses distinct colors for each status', () => {
    const colors = Object.values(SPONSORSHIP_BADGE_CONFIG).map(c => c.color);
    const unique = new Set(colors);
    expect(unique.size).toBe(3);
  });
});
