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
  var _scanInterval = null;

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
        if (_currentPage > 1) {
          _currentPage--;
          renderCurrentPage();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (_currentPage < _totalPages) {
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
  function handleSearch() {
    var query = (document.getElementById('jobSearchQuery').value || '').trim();
    var boards = getSelectedBoards();

    // Show loading state
    var resultsContainer = document.getElementById('jobResults');
    if (resultsContainer) {
      resultsContainer.innerHTML = '<p class="job-results-loading">🔍 Searching across job boards...</p>';
    }

    searchJobs({ query: query, boards: boards })
      .then(function (result) {
        _currentResults = result.jobs || [];
        _currentPage = 1;

        // Show failed boards warning if any
        if (result.failedBoards && result.failedBoards.length > 0) {
          showFailedBoardsWarning(result.failedBoards);
        }

        applyFiltersAndRender();

        // Auto-fetch fit scores and visa status for visible jobs
        enrichVisibleJobs();
      })
      .catch(function (err) {
        var errorMsg = (err && err.message) || 'Search failed. Please try again.';
        if (resultsContainer) {
          resultsContainer.innerHTML = '<p class="job-results-error">❌ ' + escapeHtml(errorMsg) + '</p>';
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
    var paginated = paginateResults(_filteredResults, _currentPage);
    _currentPage = paginated.page;
    _totalPages = paginated.totalPages;

    var resultsContainer = document.getElementById('jobResults');
    var paginationContainer = document.getElementById('jobPagination');
    var pageInfo = document.getElementById('jobPageInfo');

    if (resultsContainer) {
      if (paginated.jobs.length === 0) {
        resultsContainer.innerHTML = '<p class="job-results-empty">No jobs found matching your criteria.</p>';
      } else {
        var html = '';
        for (var i = 0; i < paginated.jobs.length; i++) {
          html += renderJobCard(paginated.jobs[i]);
        }
        resultsContainer.innerHTML = html;
        attachJobCardListeners();
      }
    }

    // Update pagination UI
    if (paginationContainer) {
      paginationContainer.style.display = _totalPages > 1 ? 'flex' : 'none';
    }
    if (pageInfo) {
      pageInfo.textContent = 'Page ' + _currentPage + ' of ' + _totalPages;
    }

    var prevBtn = document.getElementById('jobPrevPage');
    var nextBtn = document.getElementById('jobNextPage');
    if (prevBtn) prevBtn.disabled = _currentPage <= 1;
    if (nextBtn) nextBtn.disabled = _currentPage >= _totalPages;
  }

  // ===== JOB CARD RENDERING =====
  function renderJobCard(job) {
    var scoreDisplay = getScoreDisplayInfo(job.fitScore);
    var visaBadge = getSponsorshipBadge(job.sponsorship || 'unknown');

    var escapedTitle = escapeHtml(job.title || 'Untitled');
    var escapedCompany = escapeHtml(job.company || 'Unknown');
    var escapedLocation = escapeHtml(job.location || '');
    var escapedBoard = escapeHtml(job.sourceBoard || '');

    var html = '<div class="job-card" data-job-id="' + escapeHtml(job.id) + '">';

    // Title row with link
    html += '  <div class="job-card-header">';
    if (job.url) {
      html += '    <a href="' + escapeHtml(job.url) + '" target="_blank" class="job-card-title">' + escapedTitle + '</a>';
    } else {
      html += '    <span class="job-card-title">' + escapedTitle + '</span>';
    }
    html += '  </div>';

    // Company and location
    html += '  <div class="job-card-meta">';
    html += '    <span class="job-card-company">' + escapedCompany + '</span>';
    if (escapedLocation) {
      html += '    <span class="job-card-location">📍 ' + escapedLocation + '</span>';
    }
    html += '  </div>';

    // Badges row
    html += '  <div class="job-card-badges">';

    // Source board badge
    html += '    <span class="badge badge-source">' + escapedBoard + '</span>';

    // Fit score badge
    html += '    <span class="badge badge-score" style="background-color: ' + scoreDisplay.color + '; color: #fff;" data-job-id="' + escapeHtml(job.id) + '">';
    if (job.fitScore != null) {
      html += '      ' + job.fitScore + '%';
    } else {
      html += '      —';
    }
    html += '    </span>';

    // Visa badge
    html += '    <span class="badge ' + visaBadge.cssClass + '" style="background-color: ' + visaBadge.color + '; color: #fff;">';
    html += '      ' + escapeHtml(visaBadge.label);
    html += '    </span>';

    html += '  </div>';

    // Actions row
    html += '  <div class="job-card-actions">';
    html += '    <button class="btn btn-secondary btn-sm btn-tailor" data-job-id="' + escapeHtml(job.id) + '">✨ Tailor Resume</button>';
    html += '  </div>';

    html += '</div>';
    return html;
  }

  // ===== JOB CARD EVENT LISTENERS =====
  function attachJobCardListeners() {
    // Tailor buttons
    var tailorBtns = document.querySelectorAll('.btn-tailor');
    tailorBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var jobId = btn.getAttribute('data-job-id');
        handleTailorResume(jobId, btn);
      });
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
            if (hint) hint.textContent = '✓ Resume uploaded: ' + escapeHtml(file.name);
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

  function handleTailorResume(jobId, btn) {
    var originalText = btn.textContent;
    btn.textContent = '⏳ Tailoring...';
    btn.disabled = true;

    tailorResumeForJob(jobId)
      .then(function (result) {
        // Replace button with download link
        btn.textContent = '📥 Download';
        btn.disabled = false;
        btn.classList.remove('btn-tailor');
        btn.classList.add('btn-download');

        btn.removeEventListener('click', arguments.callee);
        btn.addEventListener('click', function () {
          if (result.pdfUrl) {
            window.open(result.pdfUrl, '_blank');
          }
        });
      })
      .catch(function (err) {
        btn.textContent = '❌ Retry';
        btn.disabled = false;
        // Allow retry on click
        btn.addEventListener('click', function retryHandler() {
          btn.removeEventListener('click', retryHandler);
          handleTailorResume(jobId, btn);
        });
      });
  }

  // ===== ENRICHMENT (fit score + visa auto-fetch) =====
  function enrichVisibleJobs() {
    var jobIds = _filteredResults
      .slice(0, SEARCH_PAGE_SIZE)
      .map(function (job) { return job.id; })
      .filter(Boolean);

    if (jobIds.length === 0) return;

    // Batch fetch fit scores
    if (typeof getBatchFitScores === 'function') {
      getBatchFitScores(jobIds).then(function (scores) {
        var updated = false;
        for (var i = 0; i < _currentResults.length; i++) {
          var job = _currentResults[i];
          if (scores[job.id] && scores[job.id].score != null) {
            job.fitScore = scores[job.id].score;
            job.fitExplanation = scores[job.id].explanation;
            updated = true;
          }
        }
        if (updated) applyFiltersAndRender();
      }).catch(function () { /* Fit scores unavailable — silent fail */ });
    }

    // Batch fetch visa/sponsorship status
    if (typeof getBatchSponsorshipStatus === 'function') {
      getBatchSponsorshipStatus(jobIds).then(function (statuses) {
        var updated = false;
        for (var i = 0; i < _currentResults.length; i++) {
          var job = _currentResults[i];
          if (statuses[job.id] && statuses[job.id].status) {
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

    var html = renderTrackerDashboard(entries);
    container.innerHTML = html;

    // Attach correct/dismiss listeners
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
      container.innerHTML = '<p class="tracker-error">❌ ' + escapeHtml(message) + '</p>';
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
    stopScanSchedule();
    // Poll every 15 minutes (900000 ms)
    _scanInterval = setInterval(function () {
      handleScanNow();
    }, 900000);
  }

  function stopScanSchedule() {
    if (_scanInterval) {
      clearInterval(_scanInterval);
      _scanInterval = null;
    }
  }

  // ===== HELPERS =====
  function getSelectedBoards() {
    var boards = [];
    var checkboxes = document.querySelectorAll('.board-checkbox input[type="checkbox"]');
    checkboxes.forEach(function (cb) {
      if (cb.checked) boards.push(cb.value);
    });
    return boards;
  }

  function showFailedBoardsWarning(failedBoards) {
    var resultsContainer = document.getElementById('jobResults');
    if (!resultsContainer) return;

    var names = failedBoards.map(function (fb) { return fb.board; }).join(', ');
    var warning = '<div class="job-results-warning">⚠️ Some boards failed: ' + escapeHtml(names) + '. Results shown from available boards.</div>';

    resultsContainer.insertAdjacentHTML('afterbegin', warning);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
