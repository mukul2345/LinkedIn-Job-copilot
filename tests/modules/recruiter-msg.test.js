// tests/modules/recruiter-msg.test.js - Unit tests for recruiter-msg.js

const { loadModules } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules([
    'utils.js',
    'selectors.js',
    'hr-outreach.js',
    'recruiter-msg.js',
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

// ===== buildRecruiterMessage() =====
describe('buildRecruiterMessage()', () => {
  const config = {
    firstName: 'John',
    lastName: 'Doe',
    yearsOfExperience: '4',
  };

  it('should include recruiter first name', () => {
    const msg = buildRecruiterMessage('Jane Smith', 'Backend Developer', 'TechCorp', config);
    expect(msg).toContain('Hi Jane');
  });

  it('should include job title', () => {
    const msg = buildRecruiterMessage('Jane Smith', 'Senior Engineer', 'TechCorp', config);
    expect(msg).toContain('Senior Engineer');
  });

  it('should include company name', () => {
    const msg = buildRecruiterMessage('Jane Smith', 'Developer', 'Google', config);
    expect(msg).toContain('Google');
  });

  it('should include years of experience from config', () => {
    const msg = buildRecruiterMessage('Jane', 'Dev', 'Corp', config);
    expect(msg).toContain('4+');
  });

  it('should include sender full name', () => {
    const msg = buildRecruiterMessage('Jane', 'Dev', 'Corp', config);
    expect(msg).toContain('John Doe');
  });

  it('should default to 3 years if not configured', () => {
    const msg = buildRecruiterMessage('Jane', 'Dev', 'Corp', { firstName: 'Test', lastName: 'User' });
    expect(msg).toContain('3+');
  });

  it('should handle single-word recruiter name', () => {
    const msg = buildRecruiterMessage('Hiring Manager', 'Dev', 'Corp', config);
    expect(msg).toContain('Hi Hiring');
  });

  it('should produce a multi-line message', () => {
    const msg = buildRecruiterMessage('Jane', 'Dev', 'Corp', config);
    expect(msg.split('\n').length).toBeGreaterThan(3);
  });

  it('should end with sender name', () => {
    const msg = buildRecruiterMessage('Jane', 'Dev', 'Corp', config);
    const lines = msg.split('\n').filter(l => l.trim());
    expect(lines[lines.length - 1]).toContain('John Doe');
  });
});

// ===== messageRecruiter() =====
describe('messageRecruiter()', () => {
  const config = {
    firstName: 'John',
    lastName: 'Doe',
    yearsOfExperience: '3',
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
        type: 'log',
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
