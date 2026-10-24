// tests/modules/recruiter-msg.test.js - Unit tests for recruiter-msg.js

const { loadModules, loadModuleByPath } = require('../helpers/load-modules');

beforeAll(() => {
  loadModuleByPath('modules/database/usage-repository.js');
  loadModules([
    'utils.js',
    'selectors.js',
    'safety.js',
    'hr-outreach.js',
    'recruiter-msg.js',
  ]);
});

beforeEach(() => {
  resetChromeMocks();
  document.body.innerHTML = '';
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(global, 'sleep').mockResolvedValue();
  global.consumeQuota = jest.fn().mockResolvedValue({
    allowed: true,
    used: 1,
    limit: 10,
    plan: 'free',
  });
});

afterEach(() => {
  delete global.consumeQuota;
  jest.restoreAllMocks();
});

// ===== buildRecruiterMessage() =====
describe('buildRecruiterMessage()', () => {
  const config = {
    firstName: 'John',
    lastName: 'Doe',
    yearsOfExperience: '4',
    templates: {
      recruiterMessage:
        'Hi {name}, I am interested in the {jobTitle} role at {company}. ' +
        'I have {experience}+ years of experience. Regards, {myName}',
    },
  };

  it('should render every configured placeholder', () => {
    const message = buildRecruiterMessage(
      'Jane Smith',
      'Backend Developer',
      'TechCorp',
      config
    );

    expect(message).toContain('Hi Jane Smith');
    expect(message).toContain('Backend Developer');
    expect(message).toContain('TechCorp');
    expect(message).toContain('4+ years');
    expect(message).toContain('John Doe');
  });

  it('should use the configured HR template when recruiter template is absent', () => {
    const message = buildRecruiterMessage('Jane', 'Dev', 'Corp', {
      templates: { hrMessage: 'Hello {name} about {jobTitle} at {company}.' },
    });

    expect(message).toBe('Hello Jane about Dev at Corp.');
  });

  it('should return null when no user template is configured', () => {
    expect(buildRecruiterMessage('Jane', 'Dev', 'Corp', {})).toBeNull();
  });

  it('should leave unavailable values unresolved for validation by the caller', () => {
    const message = buildRecruiterMessage('Jane', 'Dev', 'Corp', {
      templates: { recruiterMessage: 'Experience: {experience}' },
    });

    expect(findUnresolvedPlaceholders(message)).toEqual(['experience']);
  });
});

// ===== messageRecruiter() =====
describe('messageRecruiter()', () => {
  const config = {
    firstName: 'John',
    lastName: 'Doe',
    yearsOfExperience: '3',
    templates: {
      recruiterMessage: 'Hi {name}, I am interested in {jobTitle} at {company}. — {myName}',
    },
  };

  it('should log info if no recruiter Message button found', async () => {
    document.body.innerHTML = `
      <div class="jobs-search__job-details">
        <h2>About the job</h2>
        <p>Great opportunity</p>
      </div>
    `;

    await messageRecruiter('Developer', 'TechCorp', config);

    // Should have logged that no button was found
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'LOG',
        message: expect.stringContaining('No recruiter Message button found'),
      })
    );
  });

  it('should find Message button in "Meet the hiring team" section', async () => {
    document.body.innerHTML = `
      <div class="jobs-search__job-details">
        <section>
          <h2>Meet the hiring team</h2>
          <div>
            <a href="https://www.linkedin.com/in/janesmith">
              <span>Jane Smith</span>
            </a>
            <button>Message</button>
          </div>
        </section>
      </div>
    `;

    // The function will click Message, then try to find input (which won't exist in test)
    await messageRecruiter('Developer', 'TechCorp', config);

    // Should have found the recruiter
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Jane Smith'),
      })
    );
  }, 30000);

  it('should find Message button near "Job poster" text', async () => {
    document.body.innerHTML = `
      <div class="jobs-search__job-details">
        <div>
          <span>Job poster</span>
          <a href="https://www.linkedin.com/in/recruiter1">
            <span>Bob Recruiter</span>
          </a>
          <button>Message</button>
        </div>
      </div>
    `;

    await messageRecruiter('Developer', 'Corp', config);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Bob Recruiter'),
      })
    );
  }, 30000);

  it('should handle errors gracefully without throwing', async () => {
    document.body.innerHTML = `
      <div class="jobs-search__job-details">
        <div>
          <span>hiring team</span>
          <button>Message</button>
        </div>
      </div>
    `;

    // Should not throw even if message input is not found
    await expect(messageRecruiter('Dev', 'Corp', config)).resolves.not.toThrow();
  }, 30000);
});


describe('messageRecruiter() quota and dedupe safeguards', () => {
  const config = {
    firstName: 'John',
    lastName: 'Doe',
    templates: {
      recruiterMessage: 'Hi {name}, interested in {jobTitle} at {company}. — {myName}',
    },
  };

  function renderMessagingPage() {
    document.body.innerHTML = `
      <section>
        <div>
          <span>Job poster</span>
          <a href="https://www.linkedin.com/in/jane"><span>Jane Recruiter</span></a>
          <button id="open-message">Message</button>
        </div>
      </section>
      <div class="msg-form__contenteditable" contenteditable="true" role="textbox"></div>
      <button id="send-message" class="msg-form__send-button">Send</button>
    `;
  }

  it('should not show an upgrade prompt when quota verification is unavailable', async () => {
    renderMessagingPage();
    global.consumeQuota.mockResolvedValue({
      allowed: false,
      used: 0,
      limit: 0,
      plan: 'unknown',
      errorCode: 'QUOTA_UNAVAILABLE',
    });
    const sendButton = document.getElementById('send-message');
    const sendClick = jest.spyOn(sendButton, 'click');

    await messageRecruiter('Developer', 'TechCorp', config, 'job-1');

    expect(sendClick).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'notification',
      message: expect.stringContaining('Unable to verify outreach quota'),
    });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Upgrade to Pro') })
    );
  });

  it('should skip a recruiter already contacted for the same job before consuming quota', async () => {
    renderMessagingPage();
    setMockStorageData({
      outreachLog: {
        'https://www.linkedin.com/in/jane::job-1': {
          date: new Date().toISOString(),
        },
      },
    });
    const openButton = document.getElementById('open-message');
    const openClick = jest.spyOn(openButton, 'click');

    await messageRecruiter('Developer', 'TechCorp', config, 'job-1');

    expect(openClick).not.toHaveBeenCalled();
    expect(global.consumeQuota).not.toHaveBeenCalled();
  });
});