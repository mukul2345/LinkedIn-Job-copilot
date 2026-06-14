// tests/modules/filters.test.js - Unit tests for filters.js

const { loadFile } = require('../helpers/load-modules');
const path = require('path');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/filters.js'));
});

// ===== filterJobs() =====
describe('filterJobs()', () => {
  const baseJobs = [
    {
      id: 'job1',
      title: 'Backend Developer',
      company: 'Acme Corp',
      location: 'New York, NY',
      sourceBoard: 'linkedin',
      jobType: 'full-time',
      postedDate: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12h ago
      fitScore: 85,
      sponsorship: 'available',
    },
    {
      id: 'job2',
      title: 'Frontend Developer',
      company: 'Startup Inc',
      location: 'San Francisco, CA',
      sourceBoard: 'indeed',
      jobType: 'contract',
      postedDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
      fitScore: 60,
      sponsorship: 'unlikely',
    },
    {
      id: 'job3',
      title: 'Data Scientist',
      company: 'BigData Ltd',
      location: 'London, UK',
      sourceBoard: 'glassdoor',
      jobType: 'full-time',
      postedDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), // 20 days ago
      fitScore: null,
      sponsorship: 'unknown',
    },
    {
      id: 'job4',
      title: 'DevOps Engineer',
      company: 'Cloud Co',
      location: 'Remote',
      sourceBoard: 'naukri',
      jobType: 'part-time',
      postedDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(), // 45 days ago
      fitScore: 40,
      sponsorship: null,
    },
  ];

  describe('edge cases', () => {
    it('returns empty array when jobs is not an array', () => {
      expect(filterJobs(null, {})).toEqual([]);
      expect(filterJobs(undefined, {})).toEqual([]);
      expect(filterJobs('not-array', {})).toEqual([]);
    });

    it('returns all jobs when filters is null or undefined', () => {
      expect(filterJobs(baseJobs, null)).toEqual(baseJobs);
      expect(filterJobs(baseJobs, undefined)).toEqual(baseJobs);
    });

    it('returns all jobs when filters is an empty object', () => {
      expect(filterJobs(baseJobs, {})).toEqual(baseJobs);
    });
  });

  describe('board filter', () => {
    it('filters by a single board', () => {
      const result = filterJobs(baseJobs, { boards: ['linkedin'] });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job1');
    });

    it('filters by multiple boards', () => {
      const result = filterJobs(baseJobs, { boards: ['linkedin', 'indeed'] });
      expect(result).toHaveLength(2);
    });

    it('does not filter when boards is an empty array', () => {
      const result = filterJobs(baseJobs, { boards: [] });
      expect(result).toHaveLength(4);
    });
  });

  describe('location filter', () => {
    it('matches case-insensitive substring', () => {
      const result = filterJobs(baseJobs, { location: 'new york' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job1');
    });

    it('matches partial location string', () => {
      const result = filterJobs(baseJobs, { location: 'remote' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job4');
    });

    it('returns empty when no match', () => {
      const result = filterJobs(baseJobs, { location: 'Tokyo' });
      expect(result).toHaveLength(0);
    });

    it('handles jobs with null/empty location gracefully', () => {
      const jobsWithEmpty = [...baseJobs, { id: 'job5', location: null, sourceBoard: 'linkedin' }];
      const result = filterJobs(jobsWithEmpty, { location: 'new york' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job1');
    });
  });

  describe('jobType filter', () => {
    it('matches exact job type case-insensitively', () => {
      const result = filterJobs(baseJobs, { jobType: 'Full-Time' });
      expect(result).toHaveLength(2);
    });

    it('matches contract type', () => {
      const result = filterJobs(baseJobs, { jobType: 'contract' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job2');
    });
  });

  describe('datePosted filter', () => {
    it('filters 24h - includes only jobs from last 24 hours', () => {
      const result = filterJobs(baseJobs, { datePosted: '24h' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job1');
    });

    it('filters week - includes jobs from last 7 days', () => {
      const result = filterJobs(baseJobs, { datePosted: 'week' });
      expect(result).toHaveLength(2);
    });

    it('filters month - includes jobs from last 30 days', () => {
      const result = filterJobs(baseJobs, { datePosted: 'month' });
      expect(result).toHaveLength(3);
    });
  });

  describe('minFitScore filter', () => {
    it('filters out jobs below threshold', () => {
      const result = filterJobs(baseJobs, { minFitScore: 70 });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job1');
    });

    it('excludes jobs with null score when threshold > 0', () => {
      const result = filterJobs(baseJobs, { minFitScore: 1 });
      expect(result.find(j => j.fitScore == null)).toBeUndefined();
    });

    it('does not filter when threshold is 0', () => {
      const result = filterJobs(baseJobs, { minFitScore: 0 });
      expect(result).toHaveLength(4);
    });

    it('does not filter when threshold is null', () => {
      const result = filterJobs(baseJobs, { minFitScore: null });
      expect(result).toHaveLength(4);
    });
  });

  describe('sponsorshipStatuses filter', () => {
    it('filters by single sponsorship status', () => {
      const result = filterJobs(baseJobs, { sponsorshipStatuses: ['available'] });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job1');
    });

    it('filters by multiple sponsorship statuses', () => {
      const result = filterJobs(baseJobs, { sponsorshipStatuses: ['available', 'unknown'] });
      expect(result).toHaveLength(2);
    });

    it('excludes jobs with null sponsorship', () => {
      const result = filterJobs(baseJobs, { sponsorshipStatuses: ['available'] });
      expect(result.find(j => j.sponsorship == null)).toBeUndefined();
    });

    it('does not filter when array is empty', () => {
      const result = filterJobs(baseJobs, { sponsorshipStatuses: [] });
      expect(result).toHaveLength(4);
    });
  });

  describe('combined filters (AND logic)', () => {
    it('applies all criteria simultaneously', () => {
      const result = filterJobs(baseJobs, {
        boards: ['linkedin', 'indeed', 'glassdoor'],
        jobType: 'full-time',
        minFitScore: 50,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('job1');
    });

    it('returns empty when no job satisfies all criteria', () => {
      const result = filterJobs(baseJobs, {
        boards: ['linkedin'],
        jobType: 'contract',
      });
      expect(result).toHaveLength(0);
    });
  });
});

// ===== sortByFitScore() =====
describe('sortByFitScore()', () => {
  it('sorts jobs in descending order by fitScore', () => {
    const jobs = [
      { id: 'a', fitScore: 50 },
      { id: 'b', fitScore: 90 },
      { id: 'c', fitScore: 70 },
    ];
    const result = sortByFitScore(jobs);
    expect(result.map(j => j.fitScore)).toEqual([90, 70, 50]);
  });

  it('places null scores at the end', () => {
    const jobs = [
      { id: 'a', fitScore: null },
      { id: 'b', fitScore: 80 },
      { id: 'c', fitScore: null },
      { id: 'd', fitScore: 60 },
    ];
    const result = sortByFitScore(jobs);
    expect(result[0].fitScore).toBe(80);
    expect(result[1].fitScore).toBe(60);
    expect(result[2].fitScore).toBeNull();
    expect(result[3].fitScore).toBeNull();
  });

  it('does not mutate the input array', () => {
    const jobs = [
      { id: 'a', fitScore: 50 },
      { id: 'b', fitScore: 90 },
    ];
    const original = [...jobs];
    sortByFitScore(jobs);
    expect(jobs).toEqual(original);
  });

  it('handles all null scores', () => {
    const jobs = [
      { id: 'a', fitScore: null },
      { id: 'b', fitScore: null },
    ];
    const result = sortByFitScore(jobs);
    expect(result).toHaveLength(2);
  });

  it('handles empty array', () => {
    expect(sortByFitScore([])).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(sortByFitScore(null)).toEqual([]);
    expect(sortByFitScore(undefined)).toEqual([]);
  });
});

// ===== getDateCutoff() =====
describe('getDateCutoff()', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 24 hours ago for "24h"', () => {
    const cutoff = getDateCutoff('24h');
    const expected = new Date('2024-06-14T12:00:00Z');
    expect(cutoff.getTime()).toBe(expected.getTime());
  });

  it('returns 7 days ago for "week"', () => {
    const cutoff = getDateCutoff('week');
    const expected = new Date('2024-06-08T12:00:00Z');
    expect(cutoff.getTime()).toBe(expected.getTime());
  });

  it('returns 30 days ago for "month"', () => {
    const cutoff = getDateCutoff('month');
    const expected = new Date('2024-05-16T12:00:00Z');
    expect(cutoff.getTime()).toBe(expected.getTime());
  });

  it('returns epoch (no cutoff) for unknown period', () => {
    const cutoff = getDateCutoff('unknown');
    expect(cutoff.getTime()).toBe(0);
  });

  it('returns epoch for empty string', () => {
    const cutoff = getDateCutoff('');
    expect(cutoff.getTime()).toBe(0);
  });
});
