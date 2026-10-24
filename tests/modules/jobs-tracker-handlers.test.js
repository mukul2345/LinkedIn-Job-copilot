// tests/modules/jobs-tracker-handlers.test.js - Unit tests for jobs-tracker-handlers.js

const fs = require('fs');
const path = require('path');

// Load dependencies that the handlers file relies on (global scope functions)
function loadDependencies() {
  const filesToLoad = [
    'extension/modules/shared/filters.js',
    'extension/modules/fit-score/fit-score-service.js',
    'extension/modules/visa/visa-service.js',
    'extension/modules/search/search-service.js',
    'extension/modules/tracker/tracker-service.js',
    'extension/modules/tracker/tracker-ui.js',
  ];

  filesToLoad.forEach((file) => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../', file), 'utf8');
    (0, eval)(code);
  });
}

// Mock global functions used by handlers that would normally come from other modules
function setupGlobalMocks() {
  // Mock callBackend (from api-client.js)
  global.callBackend = jest.fn().mockResolvedValue({ jobs: [], total: 0, failedBoards: [] });
  global.ApiError = function (code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  };
  global.getAuthToken = jest.fn().mockResolvedValue('mock-token');
  global.generateRequestId = jest.fn().mockReturnValue('req_test_123');
  global.API_BASE_URL = 'https://us-central1-test.cloudfunctions.net';
  global.auth = { currentUser: { getIdToken: jest.fn().mockResolvedValue('token') } };
  global.SEARCH_PAGE_SIZE = 20;
  global.SEARCH_CACHE_TTL_MS = 300000;
  global.fetch = jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue({ ok: true, data: {} }),
  });
}

beforeEach(() => {
  resetChromeMocks();
  setupGlobalMocks();

  // Set up a minimal DOM for handler tests
  document.body.innerHTML = `
    <input type="text" id="jobSearchQuery" value="">
    <button id="jobSearchBtn">Search</button>
    <div class="board-checkboxes">
      <label class="board-checkbox"><input type="checkbox" id="board-linkedin" value="linkedin" checked></label>
      <label class="board-checkbox"><input type="checkbox" id="board-indeed" value="indeed"></label>
    </div>
    <select id="filterJobType"><option value="">All</option></select>
    <select id="filterDatePosted"><option value="">All</option></select>
    <select id="filterSponsorship"><option value="">All</option></select>
    <input type="number" id="filterMinScore" value="">
    <select id="filterSort"><option value="relevance">Relevance</option></select>
    <div id="resumeUploadSection"></div>
    <button id="uploadResumeBtn">Upload</button>
    <span id="resumeUploadHint">Upload hint</span>
    <div id="jobResults"></div>
    <div id="jobPagination" style="display: none;">
      <button id="jobPrevPage">Prev</button>
      <span id="jobPageInfo">Page 1 of 1</span>
      <button id="jobNextPage">Next</button>
    </div>
    <button id="gmailConnectBtn">Connect</button>
    <div id="gmailConnectSection"></div>
    <div id="trackerDashboard" style="display: none;"></div>
    <button id="scanNowBtn">Scan</button>
    <div id="trackerEntries"></div>
    <div id="trackerLastScan"></div>
    <a id="gmailDisconnectLink" href="#">Disconnect</a>
  `;

  // Load all dependencies
  loadDependencies();

  // Load the handlers file (IIFE - registers DOMContentLoaded listener)
  const handlersCode = fs.readFileSync(
    path.resolve(__dirname, '../../extension/ui/jobs-tracker-handlers.js'),
    'utf8'
  );
  (0, eval)(handlersCode);

  // Trigger DOMContentLoaded to initialize handlers
  document.dispatchEvent(new Event('DOMContentLoaded'));
});

describe('Tracker service security', () => {
  it('should return a configuration error when manifest OAuth is unavailable', async () => {
    delete chrome.runtime.getManifest;

    const result = await connectGmail();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Gmail OAuth is not configured');
    expect(chrome.identity.getAuthToken).not.toHaveBeenCalled();
  });

  it('should keep Gmail access tokens out of local storage', async () => {
    chrome.runtime.getManifest = jest.fn(() => ({
      oauth2: {
        client_id: 'configured-client.apps.googleusercontent.com',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      },
    }));

    const result = await connectGmail();

    expect(result.success).toBe(true);
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { gmailConnected: true },
      expect.any(Function)
    );
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('gmailToken', expect.any(Function));
    delete chrome.runtime.getManifest;
  });
});

describe('Jobs tab - search button', () => {
  it('should call searchJobs when search button is clicked', async () => {
    document.getElementById('jobSearchQuery').value = 'Backend Developer';
    global.searchJobs = jest.fn().mockResolvedValue({ jobs: [], total: 0, failedBoards: [] });

    document.getElementById('jobSearchBtn').click();

    // Wait for async
    await new Promise((r) => setTimeout(r, 50));

    expect(global.searchJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'Backend Developer',
        boards: ['linkedin'],
      })
    );
  });

  it('should display loading state while searching', () => {
    document.getElementById('jobSearchQuery').value = 'Test';
    global.searchJobs = jest.fn().mockReturnValue(new Promise(() => {})); // never resolves

    document.getElementById('jobSearchBtn').click();

    const results = document.getElementById('jobResults');
    expect(results.innerHTML).toContain('Searching across job boards');
  });

  it('should display error message on search failure', async () => {
    document.getElementById('jobSearchQuery').value = 'Test';
    global.searchJobs = jest.fn().mockRejectedValue(new Error('Network error'));

    document.getElementById('jobSearchBtn').click();

    await new Promise((r) => setTimeout(r, 50));

    const results = document.getElementById('jobResults');
    expect(results.innerHTML).toContain('Network error');
  });
});

describe('Jobs tab - rendering results', () => {
  it('should render job cards with title, company, and location', async () => {
    document.getElementById('jobSearchQuery').value = 'Test';
    global.searchJobs = jest.fn().mockResolvedValue({
      jobs: [
        {
          id: 'job1',
          title: 'Software Engineer',
          company: 'Acme Corp',
          location: 'San Francisco, CA',
          url: 'https://example.com/job1',
          sourceBoard: 'linkedin',
          fitScore: null,
          sponsorship: 'unknown',
        },
      ],
      total: 1,
      failedBoards: [],
    });
    global.getBatchFitScores = jest.fn().mockResolvedValue({});
    global.getBatchSponsorshipStatus = jest.fn().mockResolvedValue({});

    document.getElementById('jobSearchBtn').click();

    await new Promise((r) => setTimeout(r, 50));

    const results = document.getElementById('jobResults');
    expect(results.innerHTML).toContain('Software Engineer');
    expect(results.innerHTML).toContain('Acme Corp');
    expect(results.innerHTML).toContain('San Francisco, CA');
    expect(results.innerHTML).toContain('linkedin');
  });

  it('should render tailor button on each job card', async () => {
    document.getElementById('jobSearchQuery').value = 'Test';
    global.searchJobs = jest.fn().mockResolvedValue({
      jobs: [
        { id: 'job1', title: 'Dev', company: 'Co', location: 'LA', url: '', sourceBoard: 'indeed', fitScore: 85, sponsorship: 'available' },
      ],
      total: 1,
      failedBoards: [],
    });
    global.getBatchFitScores = jest.fn().mockResolvedValue({});
    global.getBatchSponsorshipStatus = jest.fn().mockResolvedValue({});

    document.getElementById('jobSearchBtn').click();

    await new Promise((r) => setTimeout(r, 50));

    const results = document.getElementById('jobResults');
    expect(results.innerHTML).toContain('Tailor Resume');
    expect(results.innerHTML).toContain('btn-tailor');
  });

  it('should preserve failed-board warnings after rendering results', async () => {
    global.searchJobs = jest.fn().mockResolvedValue({
      jobs: [
        { id: 'job1', title: 'Dev', company: 'Co', location: 'LA', url: '', sourceBoard: 'indeed' },
      ],
      total: 1,
      failedBoards: [{ board: '<img src=x onerror=alert(1)>' }],
    });
    global.getBatchFitScores = jest.fn().mockResolvedValue({});
    global.getBatchSponsorshipStatus = jest.fn().mockResolvedValue({});

    document.getElementById('jobSearchBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const results = document.getElementById('jobResults');
    expect(results.querySelector('.job-results-warning')).not.toBeNull();
    expect(results.querySelector('.job-card')).not.toBeNull();
    expect(results.querySelector('img')).toBeNull();
  });
});

describe('Jobs tab - pagination', () => {
  it('should hide pagination for single page results', async () => {
    document.getElementById('jobSearchQuery').value = 'Test';
    global.searchJobs = jest.fn().mockResolvedValue({
      jobs: [{ id: 'j1', title: 'Job', company: 'Co', location: 'LA', url: '', sourceBoard: 'indeed' }],
      total: 1,
      failedBoards: [],
    });
    global.getBatchFitScores = jest.fn().mockResolvedValue({});
    global.getBatchSponsorshipStatus = jest.fn().mockResolvedValue({});

    document.getElementById('jobSearchBtn').click();
    await new Promise((r) => setTimeout(r, 50));

    const pagination = document.getElementById('jobPagination');
    expect(pagination.style.display).toBe('none');
  });

  it('should request the next backend page and enrich only returned jobs', async () => {
    const pageOne = Array.from({ length: 20 }, (_, index) => ({
      id: `job-${index + 1}`,
      title: `Job ${index + 1}`,
      company: 'Co',
      location: 'Remote',
      url: '',
      sourceBoard: 'indeed',
    }));
    const pageTwo = [{
      id: 'job-21', title: 'Job 21', company: 'Co', location: 'Remote', url: '', sourceBoard: 'indeed',
    }];
    global.searchJobs = jest.fn().mockImplementation(({ page }) => Promise.resolve(
      page === 2
        ? { jobs: pageTwo, total: 21, page: 2, totalPages: 2, failedBoards: [] }
        : { jobs: pageOne, total: 21, page: 1, totalPages: 2, failedBoards: [] }
    ));
    global.getBatchFitScores = jest.fn().mockResolvedValue({});
    global.getBatchSponsorshipStatus = jest.fn().mockResolvedValue({});

    document.getElementById('jobSearchBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    document.getElementById('jobNextPage').click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(global.searchJobs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(document.getElementById('jobPageInfo').textContent).toBe('Page 2 of 2');
    expect(document.getElementById('jobResults').textContent).toContain('Job 21');
    expect(global.getBatchFitScores).toHaveBeenLastCalledWith(['job-21']);
    expect(global.getBatchSponsorshipStatus).toHaveBeenLastCalledWith(['job-21']);
  });
});

describe('Tracker tab - Gmail connection', () => {
  it('should call connectGmail when connect button is clicked', async () => {
    global.connectGmail = jest.fn().mockResolvedValue({ success: true });
    global.scanGmailNow = jest.fn().mockResolvedValue([]);
    global.getTrackerLastScan = jest.fn().mockResolvedValue(null);

    document.getElementById('gmailConnectBtn').click();

    await new Promise((r) => setTimeout(r, 50));

    expect(global.connectGmail).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_GMAIL_SCHEDULE' });
  });

  it('should show dashboard after successful connection', async () => {
    global.connectGmail = jest.fn().mockResolvedValue({ success: true });
    global.scanGmailNow = jest.fn().mockResolvedValue([]);
    global.getTrackerLastScan = jest.fn().mockResolvedValue(null);

    document.getElementById('gmailConnectBtn').click();
    await new Promise((r) => setTimeout(r, 50));

    const dashboard = document.getElementById('trackerDashboard');
    const connectSection = document.getElementById('gmailConnectSection');
    expect(dashboard.style.display).toBe('block');
    expect(connectSection.style.display).toBe('none');
  });

  it('should show connect view after disconnect', async () => {
    global.disconnectGmail = jest.fn().mockResolvedValue();

    // Simulate clicking disconnect
    document.getElementById('gmailDisconnectLink').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(global.disconnectGmail).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'STOP_GMAIL_SCHEDULE' });
  });
});

describe('Tracker tab - scan', () => {
  it('should call scanGmailNow and render entries', async () => {
    const entries = [
      { id: 'e1', company: 'Google', status: 'interview', emailSubject: 'Interview invite', emailDate: '2024-06-01T10:00:00Z', dismissed: false },
    ];
    global.scanGmailNow = jest.fn().mockResolvedValue(entries);
    global.getTrackerLastScan = jest.fn().mockResolvedValue(Date.now());

    document.getElementById('scanNowBtn').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(global.scanGmailNow).toHaveBeenCalled();
    const trackerEntries = document.getElementById('trackerEntries');
    expect(trackerEntries.innerHTML).toContain('Google');
  });
});
