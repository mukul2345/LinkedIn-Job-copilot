// tests/modules/bot-core.test.js - Unit tests for bot-core.js

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules([
    'constants.js',
    'plan-config.js',
    'usage-repository.js',
    'plan-service.js',
    'utils.js',
    'selectors.js',
    'form-filler.js',
    'hr-outreach.js',
    'recruiter-msg.js',
    'job-processor.js',
    'safety.js',
    'bot-core.js',
  ]);
});

beforeEach(() => {
  resetChromeMocks();
  document.body.innerHTML = '';
  jest.spyOn(console, 'log').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ===== buildSearchUrl() =====
describe('buildSearchUrl()', () => {
  it('should build basic URL with search term', () => {
    const url = buildSearchUrl('software engineer', {});
    expect(url).toContain('keywords=software%20engineer');
    expect(url).toContain('linkedin.com/jobs/search');
  });

  it('should include location if configured', () => {
    const url = buildSearchUrl('developer', { searchLocation: 'Bangalore, India' });
    expect(url).toContain('location=Bangalore%2C%20India');
  });

  it('should include Easy Apply filter by default', () => {
    const url = buildSearchUrl('developer', {});
    expect(url).toContain('f_AL=true');
  });

  it('should exclude Easy Apply filter when disabled', () => {
    const url = buildSearchUrl('developer', { easyApplyOnly: false });
    expect(url).not.toContain('f_AL=true');
  });

  it('should include date posted filter', () => {
    const url = buildSearchUrl('developer', { datePosted: 'Past 24 hours' });
    expect(url).toContain('f_TPR=r86400');
  });

  it('should include Past week filter', () => {
    const url = buildSearchUrl('developer', { datePosted: 'Past week' });
    expect(url).toContain('f_TPR=r604800');
  });

  it('should include Past month filter', () => {
    const url = buildSearchUrl('developer', { datePosted: 'Past month' });
    expect(url).toContain('f_TPR=r2592000');
  });

  it('should include experience level filter', () => {
    const url = buildSearchUrl('developer', { experienceLevel: ['Entry level', 'Mid-Senior level'] });
    expect(url).toContain('f_E=2,4');
  });

  it('should include job type filter', () => {
    const url = buildSearchUrl('developer', { jobType: ['Full-time', 'Contract'] });
    expect(url).toContain('f_JT=F,C');
  });

  it('should include work style filter', () => {
    const url = buildSearchUrl('developer', { workStyle: ['Remote', 'Hybrid'] });
    expect(url).toContain('f_WT=2,3');
  });

  it('should handle all filters combined', () => {
    const url = buildSearchUrl('backend developer', {
      searchLocation: 'New York',
      easyApplyOnly: true,
      datePosted: 'Past week',
      experienceLevel: ['Entry level'],
      jobType: ['Full-time'],
      workStyle: ['Remote'],
    });
    expect(url).toContain('keywords=backend%20developer');
    expect(url).toContain('location=New%20York');
    expect(url).toContain('f_AL=true');
    expect(url).toContain('f_TPR=r604800');
    expect(url).toContain('f_E=2');
    expect(url).toContain('f_JT=F');
    expect(url).toContain('f_WT=2');
  });

  it('should handle empty experience level array', () => {
    const url = buildSearchUrl('developer', { experienceLevel: [] });
    expect(url).not.toContain('f_E=');
  });

  it('should handle invalid experience level values', () => {
    const url = buildSearchUrl('developer', { experienceLevel: ['InvalidLevel'] });
    expect(url).not.toContain('f_E=');
  });

  it('should handle invalid job type values', () => {
    const url = buildSearchUrl('developer', { jobType: ['InvalidType'] });
    expect(url).not.toContain('f_JT=');
  });
});

// ===== stopBot() =====
describe('stopBot()', () => {
  it('should set botRunning to false', () => {
    const state = {
      botRunning: true,
      stopRequested: false,
      appliedCount: 5,
      skippedCount: 3,
      failedCount: 1,
      applicationHistory: [],
    };

    stopBot(state);

    expect(state.botRunning).toBe(false);
    expect(state.stopRequested).toBe(true);
  });

  it('should save counts to chrome.storage', () => {
    const state = {
      botRunning: true,
      stopRequested: false,
      appliedCount: 10,
      skippedCount: 5,
      failedCount: 2,
      applicationHistory: [{ jobId: '1' }],
    };

    stopBot(state);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        botRunning: false,
        appliedCount: 10,
        skippedCount: 5,
        failedCount: 2,
        applicationHistory: [{ jobId: '1' }],
      })
    );
  });

  it('should remove botState from storage', () => {
    const state = {
      botRunning: true,
      stopRequested: false,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      applicationHistory: [],
    };

    stopBot(state);

    expect(chrome.storage.local.remove).toHaveBeenCalledWith('botState');
  });

  it('should send status message via chrome.runtime', () => {
    chrome.runtime.sendMessage.mockReturnValue(Promise.resolve());

    const state = {
      botRunning: true,
      stopRequested: false,
      appliedCount: 7,
      skippedCount: 2,
      failedCount: 1,
      applicationHistory: [],
    };

    stopBot(state);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stopped' })
    );
  });

  it('should remove status badge from DOM', () => {
    document.body.innerHTML = '<div id="lja-status-badge" class="lja-status-badge">Running</div>';

    const state = {
      botRunning: true,
      stopRequested: false,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      applicationHistory: [],
    };

    stopBot(state);

    expect(document.getElementById('lja-status-badge')).toBeNull();
  });
});

// ===== saveState() =====
describe('saveState()', () => {
  it('should save current state to chrome.storage', async () => {
    const state = {
      currentSearchIndex: 2,
      appliedCount: 15,
      skippedCount: 8,
      failedCount: 3,
      applicationHistory: [{ jobId: '1' }, { jobId: '2' }],
    };

    await saveState(state);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        botState: {
          currentSearchIndex: 2,
          appliedCount: 15,
          skippedCount: 8,
          failedCount: 3,
        },
        applicationHistory: [{ jobId: '1' }, { jobId: '2' }],
      }),
      expect.any(Function)
    );
  });
});

// ===== startBot() =====
describe('startBot()', () => {
  it('should not start if already running', async () => {
    const state = {
      botRunning: true,
      stopRequested: false,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      config: {},
      applicationHistory: [],
      currentSearchIndex: 0,
    };

    await startBot(state);

    // Should not have called getStorage since it returns early
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it('should stop if daily limit reached', async () => {
    const today = new Date().toISOString().split('T')[0];
    const history = Array.from({ length: 80 }, (_, i) => ({
      jobId: String(i),
      date: `${today}T10:00:00.000Z`,
    }));

    setMockStorageData({
      searchTerms: ['developer'],
      applicationHistory: history,
    });

    const state = {
      botRunning: false,
      stopRequested: false,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      config: {},
      applicationHistory: [],
      currentSearchIndex: 0,
    };

    await startBot(state);

    expect(state.botRunning).toBe(false);
    expect(state.stopRequested).toBe(true);
  });

  it('should stop if no search terms configured', async () => {
    setMockStorageData({
      searchTerms: [],
      applicationHistory: [],
    });

    const state = {
      botRunning: false,
      stopRequested: false,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      config: {},
      applicationHistory: [],
      currentSearchIndex: 0,
    };

    await startBot(state);

    expect(state.botRunning).toBe(false);
  });
});

// ===== goToJobNextPage() =====
describe('goToJobNextPage()', () => {
  it('should click pagination button with matching page number', async () => {
    document.body.innerHTML = `
      <nav aria-label="pagination">
        <button>1</button>
        <button>2</button>
        <button>3</button>
      </nav>
    `;
    // Mock scrollIntoView
    document.querySelectorAll('button').forEach(btn => {
      btn.scrollIntoView = jest.fn();
    });

    // Add a job card so waitForElement resolves
    const jobCard = document.createElement('li');
    jobCard.setAttribute('data-occludable-job-id', '999');
    document.body.appendChild(jobCard);

    const result = await goToJobNextPage(2);
    expect(result).toBe(true);
  }, 15000);

  it('should find button by aria-label "Page X"', async () => {
    document.body.innerHTML = `
      <button aria-label="Page 3">3</button>
      <li data-occludable-job-id="1">Job</li>
    `;
    document.querySelector('button').scrollIntoView = jest.fn();

    const result = await goToJobNextPage(3);
    expect(result).toBe(true);
  }, 15000);

  it('should find "Next" button as fallback', async () => {
    document.body.innerHTML = `
      <button aria-label="Next">Next</button>
      <li data-occludable-job-id="1">Job</li>
    `;
    document.querySelector('button').scrollIntoView = jest.fn();
    const clickSpy = jest.spyOn(document.querySelector('button'), 'click');

    await goToJobNextPage(99);
    expect(clickSpy).toHaveBeenCalled();
  }, 15000);

  it('should return false if no pagination found', async () => {
    document.body.innerHTML = '<div>No pagination</div>';
    const result = await goToJobNextPage(2);
    expect(result).toBe(false);
  });
});
