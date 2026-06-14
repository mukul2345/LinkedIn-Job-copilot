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
});

describe('Tracker tab - Gmail connection', () => {
  it('should call connectGmail when connect button is clicked', async () => {
    global.connectGmail = jest.fn().mockResolvedValue({ success: true });
    global.scanGmailNow = jest.fn().mockResolvedValue([]);
    global.getTrackerLastScan = jest.fn().mockResolvedValue(null);

    document.getElementById('gmailConnectBtn').click();

    await new Promise((r) => setTimeout(r, 50));

    expect(global.connectGmail).toHaveBeenCalled();
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
