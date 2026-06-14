// fit-score-service.js - Job fit scoring module for JobPilot Enhanced Features
// Retrieves, caches, and displays AI-computed fit scores for job listings.
// Handles single and batch scoring, threshold management, and graceful degradation.

/**
 * Score display configuration mapping score ranges to colors and labels.
 */
// eslint-disable-next-line no-var
var SCORE_DISPLAY_CONFIG = {
  excellent: { minScore: 80, color: '#10b981', label: 'Excellent match' },
  good: { minScore: 60, color: '#3b82f6', label: 'Good match' },
  fair: { minScore: 40, color: '#eab308', label: 'Fair match' },
  low: { minScore: 0, color: '#ef4444', label: 'Low match' },
  unavailable: { minScore: null, color: '#6b7280', label: 'Score unavailable' },
};

/**
 * Get fit score for a single job.
 * Checks chrome.storage.local cache first; calls backend if not cached.
 *
 * @param {string} jobId - The Job_Record ID to score
 * @returns {Promise<{score: number, explanation: string, excludedDimensions: string[]}|null>}
 *   Score result or null if unavailable
 */
async function getFitScore(jobId) {
  // Check cache first
  var cached = await getCachedScore(jobId);
  if (cached) {
    return {
      score: cached.score,
      explanation: cached.explanation,
      excludedDimensions: cached.excludedDimensions || [],
    };
  }

  // Call backend for fresh score
  try {
    var result = await callBackend('computeFitScore', { jobId: jobId });
    var scoreData = {
      score: result.score,
      explanation: result.explanation,
      excludedDimensions: result.excludedDimensions || [],
    };

    // Cache the result
    await cacheFitScore(jobId, scoreData.score, scoreData.explanation, scoreData.excludedDimensions);
    return scoreData;
  } catch (err) {
    // On failure, clear any stale cached score and return null
    await clearCachedScore(jobId);
    return null;
  }
}

/**
 * Get fit scores for multiple jobs in a single batch request.
 * Checks cache for each job; fetches uncached jobs from backend in one call.
 *
 * @param {string[]} jobIds - Array of Job_Record IDs to score
 * @returns {Promise<Object.<string, {score: number, explanation: string, excludedDimensions: string[]}|null>>}
 *   Map of jobId → score result (null for unavailable scores)
 */
async function getBatchFitScores(jobIds) {
  if (!Array.isArray(jobIds) || jobIds.length === 0) return {};

  var results = {};
  var uncachedIds = [];

  // Check cache for each job
  for (var i = 0; i < jobIds.length; i++) {
    var jobId = jobIds[i];
    var cached = await getCachedScore(jobId);
    if (cached) {
      results[jobId] = {
        score: cached.score,
        explanation: cached.explanation,
        excludedDimensions: cached.excludedDimensions || [],
      };
    } else {
      uncachedIds.push(jobId);
    }
  }

  // Fetch uncached scores from backend in batch
  if (uncachedIds.length > 0) {
    try {
      var batchResult = await callBackend('computeFitScore', { jobIds: uncachedIds });

      // batchResult is expected to be a map of jobId → score data
      for (var j = 0; j < uncachedIds.length; j++) {
        var id = uncachedIds[j];
        var data = batchResult[id];
        if (data && data.score != null) {
          results[id] = {
            score: data.score,
            explanation: data.explanation,
            excludedDimensions: data.excludedDimensions || [],
          };
          await cacheFitScore(id, data.score, data.explanation, data.excludedDimensions);
        } else {
          results[id] = null;
        }
      }
    } catch (err) {
      // On batch failure, mark all uncached as unavailable
      for (var k = 0; k < uncachedIds.length; k++) {
        results[uncachedIds[k]] = null;
      }
    }
  }

  return results;
}

/**
 * Trigger backend recompute of all cached jobs after a profile update.
 * Clears all locally cached scores since they are now stale.
 *
 * @returns {Promise<void>}
 * @throws {ApiError} On authentication failure or backend error
 */
async function recomputeAllScores() {
  // Clear all locally cached scores first
  await clearAllCachedScores();

  // Trigger backend recompute
  await callBackend('recomputeScores', {});
}

/**
 * Get or set the minimum fit score threshold.
 * When called with a value, persists it to chrome.storage.local.
 * When called without a value, reads the current threshold.
 *
 * @param {number} [threshold] - If provided, sets the threshold (0-100)
 * @returns {Promise<number>} - Current threshold value
 */
async function fitScoreThreshold(threshold) {
  if (threshold != null) {
    // Clamp to valid range
    var value = Math.max(0, Math.min(100, Math.round(threshold)));
    return new Promise(function (resolve) {
      chrome.storage.local.set({ fitScoreThreshold: value }, function () {
        resolve(value);
      });
    });
  }

  // Getter: read current value
  return new Promise(function (resolve) {
    chrome.storage.local.get(['fitScoreThreshold'], function (data) {
      resolve(data.fitScoreThreshold != null ? data.fitScoreThreshold : 0);
    });
  });
}

/**
 * Cache a fit score result in chrome.storage.local.
 * Stored as `fitScoreCache_{jobId}` with a timestamp for staleness checks.
 *
 * @param {string} jobId - The Job_Record ID
 * @param {number} score - Computed score (0-100)
 * @param {string} explanation - Score explanation text
 * @param {string[]} [excludedDimensions] - Dimensions excluded from scoring
 * @returns {Promise<void>}
 */
async function cacheFitScore(jobId, score, explanation, excludedDimensions) {
  var key = 'fitScoreCache_' + jobId;
  var entry = {};
  entry[key] = {
    score: score,
    explanation: explanation,
    excludedDimensions: excludedDimensions || [],
    ts: Date.now(),
  };

  return new Promise(function (resolve) {
    chrome.storage.local.set(entry, function () {
      resolve();
    });
  });
}

/**
 * Retrieve a cached fit score from chrome.storage.local.
 *
 * @param {string} jobId - The Job_Record ID
 * @returns {Promise<{score: number, explanation: string, excludedDimensions: string[], ts: number}|null>}
 *   Cached score data or null if not found
 */
async function getCachedScore(jobId) {
  var key = 'fitScoreCache_' + jobId;
  return new Promise(function (resolve) {
    chrome.storage.local.get([key], function (data) {
      var cached = data[key];
      if (cached && cached.score != null) {
        resolve(cached);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Remove a cached score for a specific job.
 * Used when scoring fails to prevent displaying stale/incorrect scores.
 *
 * @param {string} jobId - The Job_Record ID
 * @returns {Promise<void>}
 */
async function clearCachedScore(jobId) {
  var key = 'fitScoreCache_' + jobId;
  return new Promise(function (resolve) {
    chrome.storage.local.remove([key], function () {
      resolve();
    });
  });
}

/**
 * Remove all cached fit scores from chrome.storage.local.
 * Used during recompute to avoid serving stale data.
 *
 * @returns {Promise<void>}
 */
async function clearAllCachedScores() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(null, function (allData) {
      var keysToRemove = Object.keys(allData).filter(function (key) {
        return key.indexOf('fitScoreCache_') === 0;
      });

      if (keysToRemove.length === 0) {
        resolve();
        return;
      }

      chrome.storage.local.remove(keysToRemove, function () {
        resolve();
      });
    });
  });
}

/**
 * Get display information for a score value.
 * Returns color and label based on score range for UI rendering.
 *
 * @param {number|null} score - Fit score (0-100) or null if unavailable
 * @returns {{color: string, label: string}} Display configuration for the score
 */
function getScoreDisplayInfo(score) {
  if (score == null) {
    return {
      color: SCORE_DISPLAY_CONFIG.unavailable.color,
      label: SCORE_DISPLAY_CONFIG.unavailable.label,
    };
  }

  if (score >= 80) {
    return {
      color: SCORE_DISPLAY_CONFIG.excellent.color,
      label: SCORE_DISPLAY_CONFIG.excellent.label,
    };
  }

  if (score >= 60) {
    return {
      color: SCORE_DISPLAY_CONFIG.good.color,
      label: SCORE_DISPLAY_CONFIG.good.label,
    };
  }

  if (score >= 40) {
    return {
      color: SCORE_DISPLAY_CONFIG.fair.color,
      label: SCORE_DISPLAY_CONFIG.fair.label,
    };
  }

  return {
    color: SCORE_DISPLAY_CONFIG.low.color,
    label: SCORE_DISPLAY_CONFIG.low.label,
  };
}
