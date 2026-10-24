// tests/modules/job-processor.test.js - Unit tests for job-processor.js

const { loadModules, loadModuleByPath } = require('../helpers/load-modules');

beforeAll(() => {
  loadModuleByPath('modules/jobs/job-domain.js');
  loadModuleByPath('modules/applications/application-state.js');
  loadModuleByPath('modules/database/usage-repository.js');
  loadModules([
    'utils.js',
    'selectors.js',
    'form-filler.js',
    'hr-outreach.js',
    'recruiter-msg.js',
    'job-processor.js',
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

// ===== extractExperience() =====
describe('extractExperience()', () => {
  it('should extract single year requirement', () => {
    expect(extractExperience('Requires 3 years of experience')).toBe(3);
  });

  it('should extract from "X+ years" format', () => {
    expect(extractExperience('5+ years of Python development')).toBe(5);
  });

  it('should extract from range format "3-5 years"', () => {
    const result = extractExperience('3-5 years of experience required');
    expect(result).toBeGreaterThanOrEqual(3);
  });

  it('should return 0 if no experience mentioned', () => {
    expect(extractExperience('Great opportunity for all levels')).toBe(0);
  });

  it('should ignore unreasonably high numbers (>12)', () => {
    expect(extractExperience('Founded 25 years ago, requires 3 years experience')).toBe(3);
  });

  it('should handle "year" (singular)', () => {
    expect(extractExperience('At least 1 year of experience')).toBe(1);
  });

  it('should handle multiple mentions and return max', () => {
    const text = '3 years of Java, 5 years of Python, 2 years of AWS';
    expect(extractExperience(text)).toBe(5);
  });

  it('should handle parenthetical format "(3) years"', () => {
    expect(extractExperience('(3) years minimum experience')).toBe(3);
  });
});

describe('manual intervention detection', () => {
  const originalLocation = window.location;

  afterEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
  });

  function setPath(pathname) {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, pathname },
      configurable: true,
    });
  }

  it('should identify CAPTCHA and MFA boundaries without bypassing them', () => {
    setPath('/jobs/search/');
    document.body.innerHTML = '<iframe src="https://challenge.example/captcha"></iframe>';
    expect(detectLinkedInManualIntervention()).toBe('CAPTCHA');
    document.body.innerHTML = '<input autocomplete="one-time-code">';
    expect(detectLinkedInManualIntervention()).toBe('MFA');
  });

  it('should not falsely trigger on ambient page markup during a normal job search', () => {
    setPath('/jobs/search/');
    // LinkedIn pages can contain unrelated elements whose class/id include
    // "captcha"; these must not be treated as a live challenge.
    document.body.innerHTML =
      '<div class="ad-captcha-placeholder"></div><section id="captcha-preload"></section>';
    expect(detectLinkedInManualIntervention()).toBeNull();
    expect(detectLinkedInPageManualIntervention()).toBeNull();
  });

  it('should treat authwall and checkpoint redirects as manual boundaries', () => {
    setPath('/authwall');
    expect(detectLinkedInPageManualIntervention()).toBe('AUTH_WALL');
    setPath('/checkpoint/challenge/verify');
    expect(detectLinkedInPageManualIntervention()).toBe('HUMAN_VERIFICATION');
  });
});

// ===== handleFollowCompany() =====
describe('handleFollowCompany()', () => {
  it('should uncheck follow checkbox when config says not to follow', () => {
    document.body.innerHTML = `
      <div id="modal">
        <input type="checkbox" id="follow-company-checkbox" checked />
        <label for="follow-company-checkbox">Follow company</label>
      </div>
    `;
    const modal = document.getElementById('modal');
    handleFollowCompany(modal, { followCompanies: false });

    // The label click should toggle the checkbox
    // In jsdom, clicking label toggles the associated checkbox
    const checkbox = document.getElementById('follow-company-checkbox');
    expect(checkbox.checked).toBe(false);
  });

  it('should leave checkbox checked when config says to follow', () => {
    document.body.innerHTML = `
      <div id="modal">
        <input type="checkbox" id="follow-company-checkbox" checked />
        <label for="follow-company-checkbox">Follow company</label>
      </div>
    `;
    const modal = document.getElementById('modal');
    handleFollowCompany(modal, { followCompanies: true });

    const checkbox = document.getElementById('follow-company-checkbox');
    expect(checkbox.checked).toBe(true);
  });

  it('should not throw if checkbox not found', () => {
    document.body.innerHTML = '<div id="modal"></div>';
    const modal = document.getElementById('modal');
    expect(() => handleFollowCompany(modal, { followCompanies: true })).not.toThrow();
  });
});

// ===== discardApplication() =====
describe('discardApplication()', () => {
  it('should dispatch Escape key event', () => {
    const handler = jest.fn();
    document.addEventListener('keydown', handler);

    discardApplication();

    expect(handler).toHaveBeenCalled();
    document.removeEventListener('keydown', handler);
  });

  it('should not throw even if no discard button exists', () => {
    jest.useFakeTimers();
    expect(() => {
      discardApplication();
      jest.advanceTimersByTime(600);
    }).not.toThrow();
    jest.useRealTimers();
  });

  it('should click Discard button after delay', async () => {
    jest.useFakeTimers();
    document.body.innerHTML = '<button>Discard</button>';
    const btn = document.querySelector('button');
    const clickSpy = jest.spyOn(btn, 'click');

    const discardPromise = discardApplication();
    await jest.advanceTimersByTimeAsync(1400);
    await discardPromise;

    expect(clickSpy).toHaveBeenCalled();
    jest.useRealTimers();
  });
});

// ===== processJobCard() =====
describe('processJobCard()', () => {
  const baseConfig = {
    blacklistCompanies: ['BadCorp'],
    badWords: ['unpaid'],
    currentExperience: 3,
    easyApplyOnly: true,
    messageRecruiter: false,
  };

  function createJobCard(jobId, title, company, hasEasyApply = true) {
    const li = document.createElement('li');
    li.setAttribute('data-occludable-job-id', jobId);
    li.innerHTML = `
      <a class="job-card-list__title" href="/jobs/view/${jobId}">${title}</a>
      <div class="artdeco-entity-lockup__subtitle">${company} · Full-time</div>
    `;
    document.body.appendChild(li);

    // Also add the job detail panel that appears when card is clicked
    if (hasEasyApply) {
      const detailPanel = document.createElement('div');
      detailPanel.innerHTML = `
        <div class="jobs-box__html-content">Great opportunity for developers.</div>
        <button class="jobs-apply-button" aria-label="Easy Apply to ${title}">Easy Apply</button>
      `;
      document.body.appendChild(detailPanel);
    }

    return li;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.spyOn(global, 'sleep').mockResolvedValue();
    jest.spyOn(global, 'waitForAnyElement').mockImplementation(async (selectors) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) return element;
      }
      return null;
    });
    jest.spyOn(global, 'retryFindElement').mockResolvedValue(null);
  });

  it('should return "skipped" if no job ID on card', async () => {
    const li = document.createElement('li');
    document.body.appendChild(li);
    const result = await processJobCard(li, baseConfig, []);
    expect(result).toBe('skipped');
  });

  it('should return "skipped" if job already in history', async () => {
    const card = createJobCard('123', 'Developer', 'GoodCorp');
    const history = [{ jobId: '123', date: new Date().toISOString() }];
    const result = await processJobCard(card, baseConfig, history);
    expect(result).toBe('skipped');
  });

  it('should return "skipped" if card shows "Applied" badge', async () => {
    const li = document.createElement('li');
    li.setAttribute('data-occludable-job-id', '456');
    li.innerHTML = `
      <a class="job-card-list__title" href="/jobs/view/456">Developer</a>
      <div class="artdeco-entity-lockup__subtitle">Corp · Full-time</div>
      <span class="job-card-container__footer-job-state">Applied</span>
    `;
    document.body.appendChild(li);

    const result = await processJobCard(li, baseConfig, []);
    expect(result).toBe('skipped');
  });

  it('should return "skipped" if company is blacklisted', async () => {
    const card = createJobCard('789', 'Developer', 'BadCorp Inc');
    const result = await processJobCard(card, baseConfig, []);
    expect(result).toBe('skipped');
  });

  it('should return "skipped" if job description contains bad words', async () => {
    document.body.innerHTML = '';
    const li = document.createElement('li');
    li.setAttribute('data-occludable-job-id', '101');
    li.innerHTML = `
      <a class="job-card-list__title" href="/jobs/view/101">Intern</a>
      <div class="artdeco-entity-lockup__subtitle">StartupCo · Internship</div>
    `;
    document.body.appendChild(li);

    // Simulate job description loading after click
    const desc = document.createElement('div');
    desc.className = 'jobs-box__html-content';
    desc.textContent = 'This is an unpaid internship opportunity';
    document.body.appendChild(desc);

    const result = await processJobCard(li, baseConfig, []);
    expect(result).toBe('skipped');
  });

  it('should return "skipped" if experience requirement too high', async () => {
    document.body.innerHTML = '';
    const li = document.createElement('li');
    li.setAttribute('data-occludable-job-id', '102');
    li.innerHTML = `
      <a class="job-card-list__title" href="/jobs/view/102">Senior Dev</a>
      <div class="artdeco-entity-lockup__subtitle">BigCorp · Full-time</div>
    `;
    document.body.appendChild(li);

    // Mock scrollIntoView on the title link
    li.querySelector('a').scrollIntoView = jest.fn();

    const desc = document.createElement('div');
    desc.className = 'jobs-box__html-content';
    desc.textContent = 'Requires 10 years of experience in distributed systems';
    document.body.appendChild(desc);

    const result = await processJobCard(li, { ...baseConfig, currentExperience: 3 }, []);
    expect(result).toBe('skipped');
  });

  it('should return "skipped" if no Easy Apply button found', async () => {
    document.body.innerHTML = '';
    const li = document.createElement('li');
    li.setAttribute('data-occludable-job-id', '103');
    li.innerHTML = `
      <a class="job-card-list__title" href="/jobs/view/103">Developer</a>
      <div class="artdeco-entity-lockup__subtitle">ExtCorp · Full-time</div>
    `;
    document.body.appendChild(li);

    const desc = document.createElement('div');
    desc.className = 'jobs-box__html-content';
    desc.textContent = 'Great role for 2 years experience developers';
    document.body.appendChild(desc);

    // No Easy Apply button
    const result = await processJobCard(li, baseConfig, []);
    expect(result).toBe('skipped');
  });

  it('should return "failed" if modal does not appear after clicking Easy Apply', async () => {
    document.body.innerHTML = '';
    const li = document.createElement('li');
    li.setAttribute('data-occludable-job-id', '104');
    li.innerHTML = `
      <a class="job-card-list__title" href="/jobs/view/104">Developer</a>
      <div class="artdeco-entity-lockup__subtitle">GoodCorp · Full-time</div>
    `;
    document.body.appendChild(li);

    const desc = document.createElement('div');
    desc.className = 'jobs-box__html-content';
    desc.textContent = 'Looking for 2 years experience';
    document.body.appendChild(desc);

    const btn = document.createElement('button');
    btn.className = 'jobs-apply-button';
    btn.setAttribute('aria-label', 'Easy Apply');
    btn.textContent = 'Easy Apply';
    document.body.appendChild(btn);

    const result = await processJobCard(li, baseConfig, []);
    expect(result).toBe('failed');
  }, 30000);
});


describe('consumeApplicationQuotaForSubmit()', () => {
  const attemptId = 'linkedin:job-42';
  const originalSleep = global.sleep;

  beforeEach(() => {
    global.sleep = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.sleep = originalSleep;
    delete global.consumeQuota;
  });

  it('should permit submission when the server authorizes an admin', async () => {
    global.consumeQuota = jest.fn().mockResolvedValue({
      allowed: true,
      used: 0,
      limit: Number.MAX_SAFE_INTEGER,
      plan: 'pro',
    });

    await expect(consumeApplicationQuotaForSubmit(attemptId)).resolves.toBeNull();
    expect(global.consumeQuota).toHaveBeenCalledWith('application', attemptId);
  });

  it('should allow submission when the quota service is unavailable', async () => {
    global.consumeQuota = jest.fn().mockResolvedValue({
      allowed: false,
      used: 0,
      limit: 0,
      plan: 'unknown',
      errorCode: 'QUOTA_UNAVAILABLE',
    });

    // A service outage must not block applying; only real exhaustion blocks.
    await expect(consumeApplicationQuotaForSubmit(attemptId)).resolves.toBeNull();
    expect(global.consumeQuota).toHaveBeenCalledWith('application', attemptId);
  });

  it('should allow submission when the quota call throws', async () => {
    global.consumeQuota = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(consumeApplicationQuotaForSubmit(attemptId)).resolves.toBeNull();
  });

  it('should report genuine monthly quota exhaustion separately', async () => {
    global.consumeQuota = jest.fn().mockResolvedValue({
      allowed: false,
      used: 10,
      limit: 10,
      plan: 'free',
    });

    await expect(consumeApplicationQuotaForSubmit(attemptId)).resolves.toMatchObject({
      status: 'limit_reached',
      quota: { used: 10, limit: 10, plan: 'free' },
    });
  });
});


describe('processEasyApplyModal() final submission boundary', () => {
  const originalSleep = global.sleep;

  afterEach(() => {
    global.sleep = originalSleep;
    delete global.consumeQuota;
  });

  it('should consume idempotent quota immediately before the irreversible click', async () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" role="dialog">
        <button aria-label="Submit application">Submit application</button>
      </div>
    `;
    const events = [];
    const submit = document.querySelector('button');
    submit.addEventListener('click', () => {
      events.push('click');
      document.querySelector('[role="dialog"]').append(' Application submitted');
    });
    global.sleep = jest.fn().mockResolvedValue(undefined);
    global.showConfirmDialog = jest.fn().mockResolvedValue(true);
    global.consumeQuota = jest.fn().mockImplementation(async (type, attemptId) => {
      events.push(`quota:${type}:${attemptId}`);
      return { allowed: true, used: 1, limit: 10, plan: 'free' };
    });

    const result = await processEasyApplyModal(
      document.querySelector('[role="dialog"]'),
      'Engineer',
      'Acme',
      { pauseBeforeSubmit: false, followCompanies: false },
      'linkedin:job-42',
    );

    expect(result).toBe(true);
    // With the user opted out of pausing, no confirmation dialog is shown.
    expect(global.showConfirmDialog).not.toHaveBeenCalled();
    expect(events).toEqual(['quota:application:linkedin:job-42', 'click']);
    expect(global.consumeQuota).toHaveBeenCalledTimes(1);
  });

  it('should treat the "your application was sent" popup as a confirmed submission', async () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" role="dialog">
        <button aria-label="Submit application">Submit application</button>
      </div>
    `;
    const submit = document.querySelector('button');
    submit.addEventListener('click', () => {
      // Mirror LinkedIn's real success popup wording ("was sent").
      document.querySelector('[role="dialog"]').append('Your application was sent to Weekday AI');
    });
    global.sleep = jest.fn().mockResolvedValue(undefined);
    global.showConfirmDialog = jest.fn().mockResolvedValue(true);
    global.consumeQuota = jest.fn().mockResolvedValue({ allowed: true, used: 1, limit: 10, plan: 'free' });

    const result = await processEasyApplyModal(
      document.querySelector('[role="dialog"]'),
      'Engineer',
      'Acme',
      { pauseBeforeSubmit: false, followCompanies: false },
      'linkedin:job-sent',
    );

    expect(result).toBe(true);
  });
});

describe('processEasyApplyModal() quota resilience', () => {
  afterEach(() => {
    delete global.consumeQuota;
    delete global.showConfirmDialog;
  });

  it('should submit anyway when the quota service is unavailable', async () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" role="dialog">
        <button aria-label="Submit application">Submit application</button>
      </div>
    `;
    const submit = document.querySelector('button');
    submit.addEventListener('click', () => {
      document.querySelector('[role="dialog"]').append(' Application submitted');
    });
    global.sleep = jest.fn().mockResolvedValue(undefined);
    global.showConfirmDialog = jest.fn().mockResolvedValue(true);
    global.consumeQuota = jest.fn().mockResolvedValue({
      allowed: false, used: 0, limit: 10, plan: 'unknown', errorCode: 'QUOTA_UNAVAILABLE',
    });

    const result = await processEasyApplyModal(
      document.querySelector('[role="dialog"]'),
      'Engineer',
      'Acme',
      { pauseBeforeSubmit: false, followCompanies: false },
      'linkedin:job-99',
    );

    expect(result).toBe(true);
    expect(global.consumeQuota).toHaveBeenCalledTimes(1);
  });

  it('should block on genuine monthly exhaustion', async () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" role="dialog">
        <button aria-label="Submit application">Submit application</button>
      </div>
    `;
    global.sleep = jest.fn().mockResolvedValue(undefined);
    global.showConfirmDialog = jest.fn().mockResolvedValue(true);
    global.consumeQuota = jest.fn().mockResolvedValue({
      allowed: false, used: 10, limit: 10, plan: 'free',
    });

    const result = await processEasyApplyModal(
      document.querySelector('[role="dialog"]'),
      'Engineer',
      'Acme',
      { pauseBeforeSubmit: false, followCompanies: false },
      'linkedin:job-100',
    );

    expect(result).toMatchObject({ status: 'limit_reached' });
    expect(global.consumeQuota).toHaveBeenCalledTimes(1);
  });
});

describe('processEasyApplyModal() review mode', () => {
  afterEach(() => {
    delete global.consumeQuota;
    delete global.showConfirmDialog;
  });

  it('should auto-submit without a dialog when pauseBeforeSubmit is not set', async () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" role="dialog">
        <button aria-label="Submit application">Submit application</button>
      </div>
    `;
    const submit = document.querySelector('button');
    submit.addEventListener('click', () => {
      document.querySelector('[role="dialog"]').append(' Application submitted');
    });
    global.sleep = jest.fn().mockResolvedValue(undefined);
    global.showConfirmDialog = jest.fn().mockResolvedValue(false);
    global.consumeQuota = jest.fn().mockResolvedValue({ allowed: true, used: 1, limit: 10, plan: 'free' });

    const result = await processEasyApplyModal(
      document.querySelector('[role="dialog"]'),
      'Role',
      'Company',
      { followCompanies: false },
      'linkedin:job-review',
    );

    expect(result).toBe(true);
    expect(global.showConfirmDialog).not.toHaveBeenCalled();
    expect(global.consumeQuota).toHaveBeenCalledTimes(1);
  });

  it('should show the dialog when pauseBeforeSubmit is explicitly true', async () => {
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal" role="dialog">
        <button aria-label="Submit application">Submit application</button>
      </div>
    `;
    global.sleep = jest.fn().mockResolvedValue(undefined);
    global.showConfirmDialog = jest.fn().mockResolvedValue(false);
    global.consumeQuota = jest.fn();

    const result = await processEasyApplyModal(
      document.querySelector('[role="dialog"]'),
      'Role',
      'Company',
      { followCompanies: false, pauseBeforeSubmit: true },
      'linkedin:job-review',
    );

    expect(result).toMatchObject({ status: 'review_required', attemptId: 'linkedin:job-review' });
    expect(global.showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(global.consumeQuota).not.toHaveBeenCalled();
  });
});
