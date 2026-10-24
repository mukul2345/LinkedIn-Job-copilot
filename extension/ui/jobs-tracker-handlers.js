// jobs-tracker-handlers.js - UI event handlers for Jobs and Tracker tabs
// Wires DOM elements to service modules (search, resume, fit-score, visa, tracker).
// Loaded after popup.js in popup.html.

(function () {
  'use strict';

  // ===== STATE =====
  var _currentResults = []; // full unfiltered job results from last search
  var _filteredResults = []; // results after filter/sort applied
  var _currentPage = 1;
  var _totalPages = 1;
  var _serverTotal = 0;
  var _usesServerPagination = false;
  var _failedBoards = [];
  var _currentSearchSessionId = null;

  var JOB_URL_ALLOWED_HOSTS = [
    'linkedin.com', 'naukri.com', 'indeed.com', 'glassdoor.com', 'workday.com', 'angel.co',
    'wellfound.com', 'lever.co', 'greenhouse.io', 'smartrecruiters.com', 'ziprecruiter.com',
  ];
  var RESUME_URL_ALLOWED_HOSTS = [
    'storage.googleapis.com', 'firebasestorage.googleapis.com', 'googleusercontent.com',
    'us-central1-linkedin-jobcopilot.cloudfunctions.net',
  ];

  // ===== INITIALIZATION =====
  document.addEventListener('DOMContentLoaded', function () {
    initJobsTab();
    initTrackerTab();
  });

  // ===== JOBS TAB =====
  function initJobsTab() {
    var searchBtn = document.getElementById('jobSearchBtn');
    var searchInput = document.getElementById('jobSearchQuery');
    var uploadBtn = document.getElementById('uploadResumeBtn');
    var prevBtn = document.getElementById('jobPrevPage');
    var nextBtn = document.getElementById('jobNextPage');

    if (searchBtn) {
      searchBtn.addEventListener('click', handleSearch);
    }
    if (searchInput) {
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') handleSearch();
      });
    }
    if (uploadBtn) {
      uploadBtn.addEventListener('click', handleResumeUpload);
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (_currentPage <= 1) return;
        if (_usesServerPagination) {
          handleSearch(_currentPage - 1);
        } else {
          _currentPage--;
          renderCurrentPage();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (_currentPage >= _totalPages) return;
        if (_usesServerPagination) {
          handleSearch(_currentPage + 1);
        } else {
          _currentPage++;
          renderCurrentPage();
        }
      });
    }

    // Filter change listeners
    var filterIds = ['filterJobType', 'filterDatePosted', 'filterSponsorship', 'filterMinScore', 'filterSort'];
    filterIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', handleFilterChange);
      }
    });

    // Load saved search preferences into input
    if (typeof getSearchPreferences === 'function') {
      getSearchPreferences().then(function (prefs) {
        if (prefs.lastQuery && searchInput) {
          searchInput.value = prefs.lastQuery;
        }
        if (prefs.boards && prefs.boards.length > 0) {
          prefs.boards.forEach(function (board) {
            var checkbox = document.getElementById('board-' + board);
            if (checkbox) checkbox.checked = true;
          });
        }
      });
    }
  }

  // ===== SEARCH HANDLER =====
  async function handleSearch(requestedPage) {
    var page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    var query = (document.getElementById('jobSearchQuery').value || '').trim();
    var boards = getSelectedBoards();
    var jobType = (document.getElementById('filterJobType') || {}).value || undefined;
    var datePosted = (document.getElementById('filterDatePosted') || {}).value || undefined;

    // Render feedback before reading preferences so the popup responds immediately.
    var resultsContainer = document.getElementById('jobResults');
    if (resultsContainer) {
      replaceWithTextState(resultsContainer, 'p', 'job-results-loading', '🔍 Searching across job boards...');
    }

    var savedPreferences = typeof getSearchPreferences === 'function'
      ? await getSearchPreferences()
      : {};
    var location = typeof savedPreferences.location === 'string'
      ? savedPreferences.location.trim()
      : '';

    searchJobs({
      query: query,
      boards: boards,
      location: location || undefined,
      jobType: jobType,
      datePosted: datePosted,
      page: page,
      searchSessionId: page > 1 ? _currentSearchSessionId : undefined,
    })
      .then(function (searchResult) {
        _currentResults = searchResult.jobs || [];
        _failedBoards = Array.isArray(searchResult.failedBoards) ? searchResult.failedBoards : [];
        _currentSearchSessionId = searchResult.searchSessionId || (page > 1 ? _currentSearchSessionId : null);
        _usesServerPagination = Number.isInteger(searchResult.totalPages) && searchResult.totalPages > 0;
        _serverTotal = Number.isFinite(searchResult.total) ? searchResult.total : _currentResults.length;
        _currentPage = _usesServerPagination ? (searchResult.page || page) : 1;
        _totalPages = _usesServerPagination ? searchResult.totalPages : 1;
        applyFiltersAndRender();
      })
      .catch(function (error) {
        _failedBoards = [];
        var errorMessage = (error && error.message) || 'Search failed. Please try again.';
        if (resultsContainer) {
          replaceWithTextState(resultsContainer, 'p', 'job-results-error', '❌ ' + errorMessage);
        }
      });
  }

  // ===== FILTERS =====
  function handleFilterChange() {
    _currentPage = 1;
    applyFiltersAndRender();
  }

  function applyFiltersAndRender() {
    var filters = gatherActiveFilters();
    var sortMode = (document.getElementById('filterSort') || {}).value || 'relevance';

    _filteredResults = filterJobs(_currentResults, filters);

    if (sortMode === 'fitScore') {
      _filteredResults = sortByFitScore(_filteredResults);
    } else if (sortMode === 'date') {
      _filteredResults = _filteredResults.slice().sort(function (a, b) {
        var dateA = a.postedDate ? new Date(a.postedDate).getTime() : 0;
        var dateB = b.postedDate ? new Date(b.postedDate).getTime() : 0;
        return dateB - dateA;
      });
    }

    renderCurrentPage();
  }

  function gatherActiveFilters() {
    var filters = {};

    var jobType = (document.getElementById('filterJobType') || {}).value;
    if (jobType) filters.jobType = jobType;

    var datePosted = (document.getElementById('filterDatePosted') || {}).value;
    if (datePosted) filters.datePosted = datePosted;

    var sponsorship = (document.getElementById('filterSponsorship') || {}).value;
    if (sponsorship) filters.sponsorshipStatuses = [sponsorship];

    var minScore = parseInt((document.getElementById('filterMinScore') || {}).value, 10);
    if (!isNaN(minScore) && minScore > 0) filters.minFitScore = minScore;

    return filters;
  }

  // ===== PAGINATION =====
  function renderCurrentPage() {
    var paginated = _usesServerPagination
      ? {
          jobs: _filteredResults,
          page: _currentPage,
          totalPages: _totalPages,
          total: _serverTotal,
        }
      : paginateResults(_filteredResults, _currentPage);
    _currentPage = paginated.page;
    _totalPages = paginated.totalPages;

    var resultsContainer = document.getElementById('jobResults');
    var paginationContainer = document.getElementById('jobPagination');
    var pageInfo = document.getElementById('jobPageInfo');

    if (resultsContainer) {
      resultsContainer.replaceChildren();
      if (paginated.jobs.length === 0) {
        resultsContainer.appendChild(createTextElement(
          'p',
          'job-results-empty',
          'No jobs found matching your criteria.'
        ));
      } else {
        for (var index = 0; index < paginated.jobs.length; index++) {
          resultsContainer.appendChild(renderJobCard(paginated.jobs[index]));
        }
        attachJobCardListeners();
      }
      showFailedBoardsWarning(_failedBoards);
    }

    if (paginationContainer) {
      paginationContainer.style.display = _totalPages > 1 ? 'flex' : 'none';
    }
    if (pageInfo) pageInfo.textContent = 'Page ' + _currentPage + ' of ' + _totalPages;

    var prevBtn = document.getElementById('jobPrevPage');
    var nextBtn = document.getElementById('jobNextPage');
    if (prevBtn) prevBtn.disabled = _currentPage <= 1;
    if (nextBtn) nextBtn.disabled = _currentPage >= _totalPages;

    enrichVisibleJobs();
  }

  // ===== JOB CARD RENDERING =====
  function renderJobCard(job) {
    var scoreDisplay = getScoreDisplayInfo(job.fitScore);
    var visaBadge = getSponsorshipBadge(job.sponsorship || 'unknown');
    var card = document.createElement('div');
    card.className = 'job-card';
    card.dataset.jobId = String(job.id || '');

    var header = document.createElement('div');
    header.className = 'job-card-header';
    var jobUrl = getAllowedHttpsUrl(job.url, JOB_URL_ALLOWED_HOSTS);
    if (jobUrl) {
      var titleLink = createTextElement('a', 'job-card-title', job.title || 'Untitled');
      titleLink.href = jobUrl;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      header.appendChild(titleLink);
    } else {
      header.appendChild(createTextElement('span', 'job-card-title', job.title || 'Untitled'));
    }
    card.appendChild(header);

    var metadata = document.createElement('div');
    metadata.className = 'job-card-meta';
    metadata.appendChild(createTextElement('span', 'job-card-company', job.company || 'Unknown'));
    if (job.location) {
      metadata.appendChild(createTextElement('span', 'job-card-location', '📍 ' + job.location));
    }
    card.appendChild(metadata);

    var badges = document.createElement('div');
    badges.className = 'job-card-badges';
    badges.appendChild(createTextElement('span', 'badge badge-source', job.sourceBoard || ''));

    var scoreBadge = createTextElement(
      'span',
      'badge badge-score',
      job.fitScore != null ? job.fitScore + '%' : '—'
    );
    scoreBadge.style.backgroundColor = scoreDisplay.color;
    scoreBadge.style.color = '#fff';
    scoreBadge.dataset.jobId = String(job.id || '');
    badges.appendChild(scoreBadge);

    var visaBadgeElement = createTextElement('span', 'badge', visaBadge.label);
    visaBadgeElement.classList.add(visaBadge.cssClass);
    visaBadgeElement.style.backgroundColor = visaBadge.color;
    visaBadgeElement.style.color = '#fff';
    badges.appendChild(visaBadgeElement);
    card.appendChild(badges);

    var actions = document.createElement('div');
    actions.className = 'job-card-actions';
    var tailorButton = createTextElement('button', 'btn btn-secondary btn-sm btn-tailor', '✨ Tailor Resume');
    tailorButton.type = 'button';
    tailorButton.dataset.jobId = String(job.id || '');
    actions.appendChild(tailorButton);
    card.appendChild(actions);
    return card;
  }

  // ===== JOB CARD EVENT LISTENERS =====
  function attachJobCardListeners() {
    var tailorButtons = document.querySelectorAll('.btn-tailor');
    tailorButtons.forEach(function (button) {
      function tailorClickHandler() {
        button.removeEventListener('click', tailorClickHandler);
        handleTailorResume(button.getAttribute('data-job-id'), button);
      }
      button.addEventListener('click', tailorClickHandler);
    });
  }

  // ===== RESUME HANDLERS =====
  function handleResumeUpload() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;

      var hint = document.getElementById('resumeUploadHint');
      if (hint) hint.textContent = 'Uploading...';

      uploadBaseResume(file)
        .then(function (result) {
          if (result.success) {
            if (hint) hint.textContent = '✓ Resume uploaded: ' + file.name;
          } else {
            if (hint) hint.textContent = '❌ ' + (result.error || 'Upload failed');
          }
        })
        .catch(function (err) {
          if (hint) hint.textContent = '❌ ' + ((err && err.message) || 'Upload failed');
        });
    });

    input.click();
  }

  function handleTailorResume(jobId, button) {
    button.textContent = '⏳ Tailoring...';
    button.disabled = true;

    tailorResumeForJob(jobId)
      .then(function (tailoredResume) {
        var pdfUrl = getAllowedHttpsUrl(tailoredResume && tailoredResume.pdfUrl, RESUME_URL_ALLOWED_HOSTS);
        if (!pdfUrl) throw new Error('The tailored resume download URL is invalid.');

        button.textContent = '📥 Download';
        button.disabled = false;
        button.classList.remove('btn-tailor');
        button.classList.add('btn-download');
        button.addEventListener('click', function downloadClickHandler() {
          var openedWindow = window.open(pdfUrl, '_blank', 'noopener,noreferrer');
          if (openedWindow) openedWindow.opener = null;
        });
      })
      .catch(function () {
        button.textContent = '❌ Retry';
        button.disabled = false;
        button.addEventListener('click', function retryHandler() {
          button.removeEventListener('click', retryHandler);
          handleTailorResume(jobId, button);
        });
      });
  }

  // ===== ENRICHMENT (fit score + visa auto-fetch) =====
  function enrichVisibleJobs() {
    var jobIds = (_usesServerPagination
      ? _filteredResults
      : _filteredResults.slice(
          (_currentPage - 1) * SEARCH_PAGE_SIZE,
          _currentPage * SEARCH_PAGE_SIZE
        ))
      .map(function (job) { return job.id; })
      .filter(Boolean);

    if (jobIds.length === 0) return;

    if (typeof getBatchFitScores === 'function') {
      getBatchFitScores(jobIds).then(function (scores) {
        var updated = false;
        for (var index = 0; index < _currentResults.length; index++) {
          var job = _currentResults[index];
          if (scores[job.id] && scores[job.id].score != null &&
              job.fitScore !== scores[job.id].score) {
            job.fitScore = scores[job.id].score;
            job.fitExplanation = scores[job.id].explanation;
            updated = true;
          }
        }
        if (updated) applyFiltersAndRender();
      }).catch(function () { /* Fit scores unavailable — silent fail */ });
    }

    if (typeof getBatchSponsorshipStatus === 'function') {
      getBatchSponsorshipStatus(jobIds).then(function (statuses) {
        var updated = false;
        for (var index = 0; index < _currentResults.length; index++) {
          var job = _currentResults[index];
          if (statuses[job.id] && statuses[job.id].status &&
              job.sponsorship !== statuses[job.id].status) {
            job.sponsorship = statuses[job.id].status;
            updated = true;
          }
        }
        if (updated) applyFiltersAndRender();
      }).catch(function () { /* Visa status unavailable — silent fail */ });
    }
  }

  // ===== TRACKER TAB =====
  function initTrackerTab() {
    var connectBtn = document.getElementById('gmailConnectBtn');
    var scanNowBtn = document.getElementById('scanNowBtn');
    var disconnectLink = document.getElementById('gmailDisconnectLink');

    if (connectBtn) {
      connectBtn.addEventListener('click', handleGmailConnect);
    }
    if (scanNowBtn) {
      scanNowBtn.addEventListener('click', handleScanNow);
    }
    if (disconnectLink) {
      disconnectLink.addEventListener('click', function (e) {
        e.preventDefault();
        handleGmailDisconnect();
      });
    }

    // On popup open: check Gmail connection and show appropriate view
    if (typeof isGmailConnected === 'function') {
      isGmailConnected().then(function (connected) {
        if (connected) {
          showTrackerDashboard();
          loadTrackerEntries();
          startScanSchedule();
        } else {
          showGmailConnect();
        }
      });
    }
  }

  function handleGmailConnect() {
    var connectBtn = document.getElementById('gmailConnectBtn');
    if (connectBtn) {
      connectBtn.textContent = '⏳ Connecting...';
      connectBtn.disabled = true;
    }

    connectGmail()
      .then(function (result) {
        if (result.success) {
          showTrackerDashboard();
          startScanSchedule();
          // Trigger initial scan
          handleScanNow();
        } else {
          if (connectBtn) {
            connectBtn.textContent = '📧 Connect Gmail';
            connectBtn.disabled = false;
          }
          showTrackerError(result.error || 'Connection failed. Please try again.');
        }
      })
      .catch(function (err) {
        if (connectBtn) {
          connectBtn.textContent = '📧 Connect Gmail';
          connectBtn.disabled = false;
        }
        showTrackerError((err && err.message) || 'Connection failed.');
      });
  }

  function handleScanNow() {
    var scanBtn = document.getElementById('scanNowBtn');
    if (scanBtn) {
      scanBtn.textContent = '⏳ Scanning...';
      scanBtn.disabled = true;
    }

    scanGmailNow()
      .then(function (entries) {
        renderTrackerEntriesUI(entries);
        updateLastScanTime();
        if (scanBtn) {
          scanBtn.textContent = '🔄 Scan Now';
          scanBtn.disabled = false;
        }
      })
      .catch(function (err) {
        if (scanBtn) {
          scanBtn.textContent = '🔄 Scan Now';
          scanBtn.disabled = false;
        }
        showTrackerError((err && err.message) || 'Scan failed. Please try again.');
      });
  }

  function handleGmailDisconnect() {
    disconnectGmail().then(function () {
      showGmailConnect();
      stopScanSchedule();
    });
  }

  function loadTrackerEntries() {
    if (typeof getTrackedApplications === 'function') {
      getTrackedApplications().then(function (entries) {
        renderTrackerEntriesUI(entries);
      });
    }
    updateLastScanTime();
  }

  function renderTrackerEntriesUI(entries) {
    var container = document.getElementById('trackerEntries');
    if (!container) return;

    var dashboard = renderTrackerDashboard(entries);
    container.replaceChildren(dashboard);
    attachTrackerEntryListeners();
  }

  function attachTrackerEntryListeners() {
    // Correct buttons
    var correctBtns = document.querySelectorAll('.tracker-btn-correct');
    correctBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var entryId = btn.getAttribute('data-entry-id');
        handleCorrectEntry(entryId);
      });
    });

    // Dismiss buttons
    var dismissBtns = document.querySelectorAll('.tracker-btn-dismiss');
    dismissBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var entryId = btn.getAttribute('data-entry-id');
        handleDismissEntry(entryId);
      });
    });
  }

  function handleCorrectEntry(entryId) {
    var newStatus = prompt('Enter corrected status (interview, rejection, offer, unknown):');
    if (!newStatus) return;

    var validStatuses = ['interview', 'rejection', 'offer', 'unknown'];
    if (validStatuses.indexOf(newStatus.toLowerCase()) === -1) {
      alert('Invalid status. Please use: interview, rejection, offer, or unknown.');
      return;
    }

    correctTrackerEntry(entryId, { status: newStatus.toLowerCase() })
      .then(function () {
        loadTrackerEntries();
      });
  }

  function handleDismissEntry(entryId) {
    correctTrackerEntry(entryId, { dismissed: true })
      .then(function () {
        loadTrackerEntries();
      });
  }

  function showTrackerDashboard() {
    var connectSection = document.getElementById('gmailConnectSection');
    var dashboard = document.getElementById('trackerDashboard');
    if (connectSection) connectSection.style.display = 'none';
    if (dashboard) dashboard.style.display = 'block';
  }

  function showGmailConnect() {
    var connectSection = document.getElementById('gmailConnectSection');
    var dashboard = document.getElementById('trackerDashboard');
    if (connectSection) connectSection.style.display = 'block';
    if (dashboard) dashboard.style.display = 'none';
  }

  function showTrackerError(message) {
    var container = document.getElementById('trackerEntries');
    if (container) {
      replaceWithTextState(container, 'p', 'tracker-error', '❌ ' + message);
    }
  }

  function updateLastScanTime() {
    if (typeof getTrackerLastScan !== 'function') return;

    getTrackerLastScan().then(function (timestamp) {
      var el = document.getElementById('trackerLastScan');
      if (!el) return;

      if (!timestamp) {
        el.textContent = 'Last scan: Never';
      } else {
        var date = new Date(timestamp);
        el.textContent = 'Last scan: ' + date.toLocaleString();
      }
    });
  }

  // ===== SCAN SCHEDULE =====
  function startScanSchedule() {
    sendScheduleMessage('START_GMAIL_SCHEDULE');
  }

  function stopScanSchedule() {
    sendScheduleMessage('STOP_GMAIL_SCHEDULE');
  }

  function sendScheduleMessage(messageType) {
    if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return;
    var runtimeMessage = createScheduleMessage(messageType);
    var response = chrome.runtime.sendMessage(runtimeMessage);
    if (response && typeof response.catch === 'function') {
      response.catch(function () { /* Background scheduling is best-effort. */ });
    }
  }

  function createScheduleMessage(messageType) {
    if (typeof MessageProtocol !== 'undefined' && MessageProtocol) {
      if (typeof MessageProtocol.createMessage === 'function') {
        return MessageProtocol.createMessage(messageType);
      }
      if (typeof MessageProtocol.create === 'function') {
        return MessageProtocol.create(messageType);
      }
    }
    return { type: messageType };
  }

  // ===== HELPERS =====
  function getSelectedBoards() {
    var boards = [];
    var checkboxes = document.querySelectorAll('.board-checkbox input[type="checkbox"]');
    checkboxes.forEach(function (checkbox) {
      if (checkbox.checked) boards.push(checkbox.value);
    });
    return boards;
  }

  function showFailedBoardsWarning(failedBoards) {
    var resultsContainer = document.getElementById('jobResults');
    if (!resultsContainer || !Array.isArray(failedBoards) || failedBoards.length === 0) return;

    var names = failedBoards.map(function (failedBoard) {
      return String((failedBoard && failedBoard.board) || 'Unknown board');
    }).join(', ');
    var warning = createTextElement(
      'div',
      'job-results-warning',
      '⚠️ Some boards failed: ' + names + '. Results shown from available boards.'
    );
    resultsContainer.prepend(warning);
  }

  function createTextElement(tagName, className, text) {
    var element = document.createElement(tagName);
    element.className = className;
    element.textContent = String(text || '');
    return element;
  }

  function replaceWithTextState(container, tagName, className, text) {
    container.replaceChildren(createTextElement(tagName, className, text));
  }

  function getAllowedHttpsUrl(rawUrl, allowedHosts) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';

    try {
      var parsedUrl = new URL(rawUrl);
      if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) return '';
      var hostname = parsedUrl.hostname.toLowerCase();
      var isAllowed = allowedHosts.some(function (allowedHost) {
        return hostname === allowedHost || hostname.endsWith('.' + allowedHost);
      });
      return isAllowed ? parsedUrl.href : '';
    } catch (error) {
      return '';
    }
  }

})();
