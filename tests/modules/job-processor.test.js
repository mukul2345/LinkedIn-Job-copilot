// tests/modules/job-processor.test.js - Unit tests for job-processor.js

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
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

  it('should click Discard button after delay', () => {
    jest.useFakeTimers();
    document.body.innerHTML = '<button>Discard</button>';
    const btn = document.querySelector('button');
    const clickSpy = jest.spyOn(btn, 'click');

    discardApplication();
    jest.advanceTimersByTime(600);

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
