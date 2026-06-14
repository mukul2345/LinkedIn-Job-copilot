// search-service.js - Multi-board job search module for JobPilot Enhanced Features
// Handles search requests, preferences persistence, and result caching via chrome.storage.local.

/**
 * Default number of results per page for client-side pagination.
 */
// eslint-disable-next-line no-var
var SEARCH_PAGE_SIZE = 20;

/**
 * Cache freshness duration in milliseconds (5 minutes).
 */
// eslint-disable-next-line no-var
var SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Initiate a multi-board job search.
 * Validates input client-side, then calls the backend 'searchJobs' endpoint.
 *
 * @param {Object} params
 * @param {string} params.query - Search query (2-200 chars)
 * @param {string[]} params.boards - Selected boards (min 1 from VALID_BOARDS)
 * @param {string} [params.location] - Optional location filter
 * @param {string} [params.jobType] - full-time|part-time|contract|internship
 * @param {string} [params.datePosted] - Date filter (e.g. '24h', 'week', 'month')
 * @param {number} [params.page] - Page number (default 1)
 * @returns {Promise<{jobs: JobRecord[], total: number, failedBoards: FailedBoard[]}>}
 * @throws {ApiError} On validation failure or backend error
 */
async function searchJobs(params) {
  var query = params.query || '';
  var boards = params.boards || [];
  var page = params.page || 1;

  // Client-side validation before calling backend
  var validation = validateSearchInput(query, boards);
  if (!validation.valid) {
    throw new ApiError('INVALID_REQUEST', validation.error);
  }

  var body = {
    query: query.trim(),
    boards: boards,
    page: page,
  };

  if (params.location) {
    body.location = params.location;
  }
  if (params.jobType) {
    body.jobType = params.jobType;
  }
  if (params.datePosted) {
    body.datePosted = params.datePosted;
  }

  // Save preferences on every search
  saveSearchPreferences({ boards: boards, lastQuery: query.trim() });

  var result = await callBackend('searchJobs', body);

  return result;
}

/**
 * Read saved search preferences (board selection and last query) from chrome.storage.local.
 *
 * @returns {Promise<{boards: string[], lastQuery: string}>}
 */
async function getSearchPreferences() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['searchPrefs_boards', 'searchPrefs_lastQuery'], function (data) {
      resolve({
        boards: data.searchPrefs_boards || [],
        lastQuery: data.searchPrefs_lastQuery || '',
      });
    });
  });
}

/**
 * Save board selection and search terms to chrome.storage.local.
 *
 * @param {Object} prefs
 * @param {string[]} [prefs.boards] - Selected board identifiers
 * @param {string} [prefs.lastQuery] - Most recent search query
 * @returns {Promise<void>}
 */
async function saveSearchPreferences(prefs) {
  return new Promise(function (resolve) {
    var data = {};
    if (prefs.boards !== undefined) {
      data.searchPrefs_boards = prefs.boards;
    }
    if (prefs.lastQuery !== undefined) {
      data.searchPrefs_lastQuery = prefs.lastQuery;
    }
    chrome.storage.local.set(data, function () {
      resolve();
    });
  });
}

/**
 * Cache search results in chrome.storage.local with a timestamp.
 * Stored under key "searchCache_{searchId}".
 *
 * @param {string} searchId - Hash of query params used as cache key
 * @param {JobRecord[]} jobs - Job results to cache
 * @returns {Promise<void>}
 */
async function cacheSearchResults(searchId, jobs) {
  return new Promise(function (resolve) {
    var key = 'searchCache_' + searchId;
    var entry = {
      jobs: jobs,
      timestamp: Date.now(),
    };
    var data = {};
    data[key] = entry;
    chrome.storage.local.set(data, function () {
      resolve();
    });
  });
}

/**
 * Retrieve cached search results if they are still fresh (< 5 minutes old).
 * Returns null if no cache exists or the cache has expired.
 *
 * @param {string} searchId - Hash of query params used as cache key
 * @returns {Promise<JobRecord[]|null>}
 */
async function getCachedResults(searchId) {
  return new Promise(function (resolve) {
    var key = 'searchCache_' + searchId;
    chrome.storage.local.get([key], function (data) {
      var entry = data[key];
      if (!entry || !entry.timestamp || !entry.jobs) {
        resolve(null);
        return;
      }
      var age = Date.now() - entry.timestamp;
      if (age >= SEARCH_CACHE_TTL_MS) {
        // Cache expired, remove stale entry
        chrome.storage.local.remove([key]);
        resolve(null);
        return;
      }
      resolve(entry.jobs);
    });
  });
}

/**
 * Paginate an array of jobs client-side.
 * Returns the slice for the requested page (1-indexed) at SEARCH_PAGE_SIZE items per page.
 *
 * @param {JobRecord[]} jobs - Full array of job results
 * @param {number} page - Page number (1-indexed)
 * @returns {{jobs: JobRecord[], page: number, pageSize: number, totalPages: number, total: number}}
 */
function paginateResults(jobs, page) {
  var total = jobs.length;
  var totalPages = Math.ceil(total / SEARCH_PAGE_SIZE) || 1;
  var currentPage = Math.max(1, Math.min(page || 1, totalPages));
  var startIndex = (currentPage - 1) * SEARCH_PAGE_SIZE;
  var pageJobs = jobs.slice(startIndex, startIndex + SEARCH_PAGE_SIZE);

  return {
    jobs: pageJobs,
    page: currentPage,
    pageSize: SEARCH_PAGE_SIZE,
    totalPages: totalPages,
    total: total,
  };
}
