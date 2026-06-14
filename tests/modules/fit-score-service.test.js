// tests/modules/fit-score-service.test.js - Unit tests for fit-score-service.js

const { loadFile } = require('../helpers/load-modules');
const path = require('path');

beforeAll(() => {
  loadFile(path.resolve(__dirname, '../../extension/modules/fit-score/fit-score-service.js'));
});

beforeEach(() => {
  global.resetChromeMocks();
});

// ===== getFitScore() =====
describe('getFitScore()', () => {
  let mockCallBackend;

  beforeEach(() => {
    mockCallBackend = jest.fn().mockResolvedValue({
      score: 85,
      explanation: 'Strong skills match and location fit.',
      excludedDimensions: [],
    });
    global.callBackend = mockCallBackend;
  });

  afterEach(() => {
    delete global.callBackend;
  });

  it('returns cached score when available', async () => {
    global.setMockStorageData({
      'fitScoreCache_job123': {
        score: 72,
        explanation: 'Good match on skills.',
        excludedDimensions: ['salary'],
        ts: Date.now(),
      },
    });
    const result = await getFitScore('job123');
    expect(result).toEqual({
      score: 72,
      explanation: 'Good match on skills.',
      excludedDimensions: ['salary'],
    });
    expect(mockCallBackend).not.toHaveBeenCalled();
  });

  it('calls backend when no cache exists', async () => {
    const result = await getFitScore('job456');
    expect(mockCallBackend).toHaveBeenCalledWith('computeFitScore', { jobId: 'job456' });
    expect(result).toEqual({
      score: 85,
      explanation: 'Strong skills match and location fit.',
      excludedDimensions: [],
    });
  });

  it('caches the backend result after fetching', async () => {
    await getFitScore('job789');
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'fitScoreCache_job789': expect.objectContaining({
          score: 85,
          explanation: 'Strong skills match and location fit.',
          excludedDimensions: [],
          ts: expect.any(Number),
        }),
      }),
      expect.any(Function)
    );
  });

  it('returns null and clears cache on backend failure', async () => {
    mockCallBackend.mockRejectedValue(new Error('AI unavailable'));
    // No cached data — force backend call which will fail
    const result = await getFitScore('jobFail');
    expect(result).toBeNull();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(
      ['fitScoreCache_jobFail'],
      expect.any(Function)
    );
  });

  it('handles backend returning excludedDimensions', async () => {
    mockCallBackend.mockResolvedValue({
      score: 60,
      explanation: 'Partial scoring.',
      excludedDimensions: ['education', 'salary'],
    });
    const result = await getFitScore('jobPartial');
    expect(result.excludedDimensions).toEqual(['education', 'salary']);
  });
});

// ===== getBatchFitScores() =====
describe('getBatchFitScores()', () => {
  let mockCallBackend;

  beforeEach(() => {
    mockCallBackend = jest.fn().mockResolvedValue({
      job1: { score: 90, explanation: 'Excellent', excludedDimensions: [] },
      job2: { score: 45, explanation: 'Fair', excludedDimensions: ['location'] },
    });
    global.callBackend = mockCallBackend;
  });

  afterEach(() => {
    delete global.callBackend;
  });

  it('returns empty object for empty array', async () => {
    const result = await getBatchFitScores([]);
    expect(result).toEqual({});
    expect(mockCallBackend).not.toHaveBeenCalled();
  });

  it('uses cache for already-scored jobs', async () => {
    global.setMockStorageData({
      'fitScoreCache_job1': { score: 88, explanation: 'Cached', excludedDimensions: [], ts: Date.now() },
    });
    const result = await getBatchFitScores(['job1', 'job2']);
    expect(result.job1.score).toBe(88);
    // Only job2 should be fetched from backend
    expect(mockCallBackend).toHaveBeenCalledWith('computeFitScore', { jobIds: ['job2'] });
  });

  it('marks uncached jobs as null on batch failure', async () => {
    mockCallBackend.mockRejectedValue(new Error('Network error'));
    const result = await getBatchFitScores(['jobA', 'jobB']);
    expect(result.jobA).toBeNull();
    expect(result.jobB).toBeNull();
  });

  it('handles mixed results from backend', async () => {
    mockCallBackend.mockResolvedValue({
      jobX: { score: 75, explanation: 'Good', excludedDimensions: [] },
      jobY: null,
    });
    const result = await getBatchFitScores(['jobX', 'jobY']);
    expect(result.jobX.score).toBe(75);
    expect(result.jobY).toBeNull();
  });
});

// ===== recomputeAllScores() =====
describe('recomputeAllScores()', () => {
  let mockCallBackend;

  beforeEach(() => {
    mockCallBackend = jest.fn().mockResolvedValue({});
    global.callBackend = mockCallBackend;
  });

  afterEach(() => {
    delete global.callBackend;
  });

  it('clears all cached scores before recomputing', async () => {
    global.setMockStorageData({
      'fitScoreCache_a': { score: 80, explanation: 'A', excludedDimensions: [], ts: 1000 },
      'fitScoreCache_b': { score: 60, explanation: 'B', excludedDimensions: [], ts: 2000 },
      'otherKey': 'should remain',
    });
    await recomputeAllScores();
    // Should remove only fitScoreCache_ keys
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(
      expect.arrayContaining(['fitScoreCache_a', 'fitScoreCache_b']),
      expect.any(Function)
    );
  });

  it('calls backend recomputeScores endpoint', async () => {
    await recomputeAllScores();
    expect(mockCallBackend).toHaveBeenCalledWith('recomputeScores', {});
  });

  it('propagates backend errors', async () => {
    mockCallBackend.mockRejectedValue(new Error('Timeout'));
    await expect(recomputeAllScores()).rejects.toThrow('Timeout');
  });
});

// ===== fitScoreThreshold() =====
describe('fitScoreThreshold()', () => {
  it('returns 0 as default when nothing stored', async () => {
    const result = await fitScoreThreshold();
    expect(result).toBe(0);
  });

  it('returns stored threshold value', async () => {
    global.setMockStorageData({ fitScoreThreshold: 65 });
    const result = await fitScoreThreshold();
    expect(result).toBe(65);
  });

  it('sets and returns the threshold', async () => {
    const result = await fitScoreThreshold(70);
    expect(result).toBe(70);
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { fitScoreThreshold: 70 },
      expect.any(Function)
    );
  });

  it('clamps threshold to 0 when negative', async () => {
    const result = await fitScoreThreshold(-10);
    expect(result).toBe(0);
  });

  it('clamps threshold to 100 when exceeding max', async () => {
    const result = await fitScoreThreshold(150);
    expect(result).toBe(100);
  });

  it('rounds fractional threshold values', async () => {
    const result = await fitScoreThreshold(72.7);
    expect(result).toBe(73);
  });
});

// ===== cacheFitScore() =====
describe('cacheFitScore()', () => {
  it('stores score data with timestamp', async () => {
    const before = Date.now();
    await cacheFitScore('jobCache', 88, 'Great fit', ['salary']);
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'fitScoreCache_jobCache': expect.objectContaining({
          score: 88,
          explanation: 'Great fit',
          excludedDimensions: ['salary'],
          ts: expect.any(Number),
        }),
      }),
      expect.any(Function)
    );
    const callArgs = chrome.storage.local.set.mock.calls[0][0];
    expect(callArgs['fitScoreCache_jobCache'].ts).toBeGreaterThanOrEqual(before);
  });

  it('defaults excludedDimensions to empty array', async () => {
    await cacheFitScore('jobSimple', 55, 'OK match');
    const callArgs = chrome.storage.local.set.mock.calls[0][0];
    expect(callArgs['fitScoreCache_jobSimple'].excludedDimensions).toEqual([]);
  });
});

// ===== clearCachedScore() =====
describe('clearCachedScore()', () => {
  it('removes the cache key for a specific job', async () => {
    await clearCachedScore('jobDel');
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(
      ['fitScoreCache_jobDel'],
      expect.any(Function)
    );
  });
});

// ===== getScoreDisplayInfo() =====
describe('getScoreDisplayInfo()', () => {
  it('returns excellent (green) for scores 80-100', () => {
    expect(getScoreDisplayInfo(80)).toEqual({ color: '#10b981', label: 'Excellent match' });
    expect(getScoreDisplayInfo(100)).toEqual({ color: '#10b981', label: 'Excellent match' });
    expect(getScoreDisplayInfo(95)).toEqual({ color: '#10b981', label: 'Excellent match' });
  });

  it('returns good (blue) for scores 60-79', () => {
    expect(getScoreDisplayInfo(60)).toEqual({ color: '#3b82f6', label: 'Good match' });
    expect(getScoreDisplayInfo(79)).toEqual({ color: '#3b82f6', label: 'Good match' });
  });

  it('returns fair (yellow) for scores 40-59', () => {
    expect(getScoreDisplayInfo(40)).toEqual({ color: '#eab308', label: 'Fair match' });
    expect(getScoreDisplayInfo(59)).toEqual({ color: '#eab308', label: 'Fair match' });
  });

  it('returns low (red) for scores 0-39', () => {
    expect(getScoreDisplayInfo(0)).toEqual({ color: '#ef4444', label: 'Low match' });
    expect(getScoreDisplayInfo(39)).toEqual({ color: '#ef4444', label: 'Low match' });
  });

  it('returns unavailable (gray) for null score', () => {
    expect(getScoreDisplayInfo(null)).toEqual({ color: '#6b7280', label: 'Score unavailable' });
  });

  it('returns unavailable (gray) for undefined score', () => {
    expect(getScoreDisplayInfo(undefined)).toEqual({ color: '#6b7280', label: 'Score unavailable' });
  });
});
