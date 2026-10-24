// tests/modules/search-service.test.js - Unit tests for search-service.js

const { loadFile } = require('../helpers/load-modules');
const path = require('path');

beforeAll(() => {
  // Load dependencies first (validators provides validateSearchInput, api-client provides ApiError & callBackend)
  loadFile(path.resolve(__dirname, '../../extension/core/runtime-config.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/message-protocol.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/validators.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/shared/api-client.js'));
  loadFile(path.resolve(__dirname, '../../extension/modules/search/search-service.js'));
});

beforeEach(() => {
  global.resetChromeMocks();
});

// ===== searchJobs() =====
describe('searchJobs()', () => {
  let mockCallBackend;

  beforeEach(() => {
    // Mock callBackend since we don't want to make real API calls
    mockCallBackend = jest.fn().mockResolvedValue({
      jobs: [{ id: 'job1', title: 'Dev' }],
      total: 1,
      failedBoards: [],
    });
    global.callBackend = mockCallBackend;
  });

  afterEach(() => {
    delete global.callBackend;
  });

  it('calls backend with correct params', async () => {
    await searchJobs({ query: 'Backend Developer', boards: ['linkedin', 'indeed'], page: 1 });
    expect(mockCallBackend).toHaveBeenCalledWith('searchJobs', {
      query: 'Backend Developer',
      boards: ['linkedin', 'indeed'],
      page: 1,
    });
  });

  it('includes optional location and jobType when provided', async () => {
    await searchJobs({
      query: 'Frontend Dev',
      boards: ['glassdoor'],
      location: 'NYC',
      jobType: 'full-time',
      datePosted: 'week',
    });
    expect(mockCallBackend).toHaveBeenCalledWith('searchJobs', {
      query: 'Frontend Dev',
      boards: ['glassdoor'],
      page: 1,
      location: 'NYC',
      jobType: 'full-time',
      datePosted: 'week',
    });
  });

  it('includes the durable session ID for later snapshot pages', async () => {
    await searchJobs({
      query: 'Frontend Dev',
      boards: ['glassdoor'],
      page: 2,
      searchSessionId: 'session-123',
    });
    expect(mockCallBackend).toHaveBeenCalledWith('searchJobs', {
      query: 'Frontend Dev',
      boards: ['glassdoor'],
      page: 2,
      searchSessionId: 'session-123',
    });
  });

  it('throws ApiError when query is too short', async () => {
    await expect(searchJobs({ query: 'a', boards: ['linkedin'] }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(mockCallBackend).not.toHaveBeenCalled();
  });

  it('throws ApiError when no boards selected', async () => {
    await expect(searchJobs({ query: 'Developer', boards: [] }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(mockCallBackend).not.toHaveBeenCalled();
  });

  it('throws ApiError when query exceeds 200 chars', async () => {
    const longQuery = 'a'.repeat(201);
    await expect(searchJobs({ query: longQuery, boards: ['indeed'] }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(mockCallBackend).not.toHaveBeenCalled();
  });

  it('saves search preferences on each search', async () => {
    await searchJobs({ query: 'Node.js', boards: ['linkedin', 'indeed'] });
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        searchPrefs_boards: ['linkedin', 'indeed'],
        searchPrefs_lastQuery: 'Node.js',
      }),
      expect.any(Function)
    );
  });

  it('defaults page to 1 when not provided', async () => {
    await searchJobs({ query: 'Python', boards: ['indeed'] });
    expect(mockCallBackend).toHaveBeenCalledWith('searchJobs', expect.objectContaining({ page: 1 }));
  });

  it('returns backend result as-is', async () => {
    const expected = { jobs: [{ id: 'j1' }], total: 1, failedBoards: [{ board: 'glassdoor', error: 'timeout' }] };
    mockCallBackend.mockResolvedValue(expected);
    const result = await searchJobs({ query: 'Go Developer', boards: ['linkedin'] });
    expect(result).toEqual(expected);
  });
});

// ===== getSearchPreferences() =====
describe('getSearchPreferences()', () => {
  it('returns stored boards and lastQuery', async () => {
    global.setMockStorageData({
      searchPrefs_boards: ['linkedin', 'indeed'],
      searchPrefs_lastQuery: 'React Developer',
    });
    const prefs = await getSearchPreferences();
    expect(prefs.boards).toEqual(['linkedin', 'indeed']);
    expect(prefs.lastQuery).toBe('React Developer');
  });

  it('returns empty defaults when nothing stored', async () => {
    const prefs = await getSearchPreferences();
    expect(prefs.boards).toEqual([]);
    expect(prefs.lastQuery).toBe('');
  });
});

// ===== saveSearchPreferences() =====
describe('saveSearchPreferences()', () => {
  it('persists only boards supported by the production scraper', async () => {
    await saveSearchPreferences({ boards: ['glassdoor', 'naukri'] });
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ searchPrefs_boards: ['glassdoor'] }),
      expect.any(Function)
    );
  });

  it('persists lastQuery to chrome.storage.local', async () => {
    await saveSearchPreferences({ lastQuery: 'DevOps Engineer' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ searchPrefs_lastQuery: 'DevOps Engineer' }),
      expect.any(Function)
    );
  });

  it('drops unsupported boards while persisting the last query', async () => {
    await saveSearchPreferences({ boards: ['adzuna'], lastQuery: 'ML Engineer' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { searchPrefs_boards: [], searchPrefs_lastQuery: 'ML Engineer' },
      expect.any(Function)
    );
  });
});

// ===== cacheSearchResults() =====
describe('cacheSearchResults()', () => {
  it('stores jobs with timestamp under searchCache_{id} key', async () => {
    const jobs = [{ id: 'j1', title: 'Dev' }];
    const before = Date.now();
    await cacheSearchResults('abc123', jobs);
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'searchCache_abc123': expect.objectContaining({
          jobs: jobs,
          timestamp: expect.any(Number),
        }),
      }),
      expect.any(Function)
    );
    const callArgs = chrome.storage.local.set.mock.calls[0][0];
    expect(callArgs['searchCache_abc123'].timestamp).toBeGreaterThanOrEqual(before);
  });
});

// ===== getCachedResults() =====
describe('getCachedResults()', () => {
  it('returns cached jobs when within TTL', async () => {
    const jobs = [{ id: 'j1' }, { id: 'j2' }];
    global.setMockStorageData({
      'searchCache_xyz': { jobs: jobs, timestamp: Date.now() - 1000 }, // 1 second ago
    });
    const result = await getCachedResults('xyz');
    expect(result).toEqual(jobs);
  });

  it('returns null when cache is expired (>= 5 minutes)', async () => {
    global.setMockStorageData({
      'searchCache_old': { jobs: [{ id: 'j1' }], timestamp: Date.now() - 6 * 60 * 1000 },
    });
    const result = await getCachedResults('old');
    expect(result).toBeNull();
  });

  it('returns null when no cache exists', async () => {
    const result = await getCachedResults('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when cache entry has no timestamp', async () => {
    global.setMockStorageData({
      'searchCache_bad': { jobs: [{ id: 'j1' }] },
    });
    const result = await getCachedResults('bad');
    expect(result).toBeNull();
  });
});

// ===== paginateResults() =====
describe('paginateResults()', () => {
  const jobs = Array.from({ length: 50 }, (_, i) => ({ id: `job${i + 1}` }));

  it('returns first 20 items for page 1', () => {
    const result = paginateResults(jobs, 1);
    expect(result.jobs).toHaveLength(20);
    expect(result.jobs[0].id).toBe('job1');
    expect(result.jobs[19].id).toBe('job20');
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.totalPages).toBe(3);
    expect(result.total).toBe(50);
  });

  it('returns correct slice for page 2', () => {
    const result = paginateResults(jobs, 2);
    expect(result.jobs).toHaveLength(20);
    expect(result.jobs[0].id).toBe('job21');
    expect(result.jobs[19].id).toBe('job40');
    expect(result.page).toBe(2);
  });

  it('returns remaining items for last page', () => {
    const result = paginateResults(jobs, 3);
    expect(result.jobs).toHaveLength(10);
    expect(result.jobs[0].id).toBe('job41');
    expect(result.jobs[9].id).toBe('job50');
    expect(result.page).toBe(3);
  });

  it('clamps page to max when exceeding total pages', () => {
    const result = paginateResults(jobs, 99);
    expect(result.page).toBe(3);
    expect(result.jobs).toHaveLength(10);
  });

  it('clamps page to 1 when page is 0 or negative', () => {
    const result = paginateResults(jobs, 0);
    expect(result.page).toBe(1);
    expect(result.jobs[0].id).toBe('job1');

    const result2 = paginateResults(jobs, -5);
    expect(result2.page).toBe(1);
  });

  it('returns all items when fewer than page size', () => {
    const smallList = [{ id: 'a' }, { id: 'b' }];
    const result = paginateResults(smallList, 1);
    expect(result.jobs).toHaveLength(2);
    expect(result.totalPages).toBe(1);
    expect(result.total).toBe(2);
  });

  it('handles empty array', () => {
    const result = paginateResults([], 1);
    expect(result.jobs).toHaveLength(0);
    expect(result.totalPages).toBe(1);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
  });
});

describe('saved search location', () => {
  it('should persist and forward the saved user search location', async () => {
    const backend = jest.fn().mockResolvedValue({ jobs: [], total: 0, failedBoards: [] });
    global.callBackend = backend;

    await searchJobs({
      query: 'Platform Engineer',
      boards: ['linkedin'],
      location: 'Saved location',
    });

    expect(backend).toHaveBeenCalledWith('searchJobs', expect.objectContaining({
      location: 'Saved location',
    }));
    expect(chrome.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      searchPrefs_location: 'Saved location',
    }), expect.any(Function));
    delete global.callBackend;
  });
});
