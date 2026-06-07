// tests/modules/linkedin-selectors.test.js - Tests for selector definitions

const { loadModule } = require('../helpers/load-modules');

beforeAll(() => {
  loadModule('selectors.js');
});

describe('SELECTORS object', () => {
  it('should be defined and be an object', () => {
    expect(SELECTORS).toBeDefined();
    expect(typeof SELECTORS).toBe('object');
  });

  // ===== Messaging selectors =====
  describe('messaging selectors', () => {
    it('should have messageInput as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.messageInput)).toBe(true);
      expect(SELECTORS.messageInput.length).toBeGreaterThan(5);
    });

    it('should have messageSend as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.messageSend)).toBe(true);
      expect(SELECTORS.messageSend.length).toBeGreaterThan(0);
    });

    it('should have messageClose as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.messageClose)).toBe(true);
      expect(SELECTORS.messageClose.length).toBeGreaterThan(0);
    });

    it('should have chatMessages as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.chatMessages)).toBe(true);
      expect(SELECTORS.chatMessages.length).toBeGreaterThan(0);
    });

    it('should have chatTimestamps as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.chatTimestamps)).toBe(true);
      expect(SELECTORS.chatTimestamps.length).toBeGreaterThan(0);
    });

    it('messageInput selectors should include contenteditable patterns', () => {
      const joined = SELECTORS.messageInput.join(' ');
      expect(joined).toContain('contenteditable');
      expect(joined).toContain('role="textbox"');
    });

    it('messageInput selectors should include 2025+ LinkedIn class patterns', () => {
      const joined = SELECTORS.messageInput.join(' ');
      expect(joined).toContain('msg-form__message-texteditor');
      expect(joined).toContain('msg-overlay');
    });
  });

  // ===== People search selectors =====
  describe('people search selectors', () => {
    it('should have peopleCards as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.peopleCards)).toBe(true);
      expect(SELECTORS.peopleCards.length).toBeGreaterThan(0);
    });

    it('should have peopleCardsBroad as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.peopleCardsBroad)).toBe(true);
      expect(SELECTORS.peopleCardsBroad.length).toBeGreaterThan(0);
    });

    it('should have profileNameLink as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.profileNameLink)).toBe(true);
      expect(SELECTORS.profileNameLink.length).toBeGreaterThan(0);
    });

    it('should have profileLink as a string selector', () => {
      expect(typeof SELECTORS.profileLink).toBe('string');
      expect(SELECTORS.profileLink).toContain('/in/');
    });
  });

  // ===== Job search selectors =====
  describe('job search selectors', () => {
    it('should have jobCards as a string selector', () => {
      expect(typeof SELECTORS.jobCards).toBe('string');
      expect(SELECTORS.jobCards).toContain('data-occludable-job-id');
    });

    it('should have jobTitleLink as a string selector', () => {
      expect(typeof SELECTORS.jobTitleLink).toBe('string');
    });

    it('should have jobSubtitle as a string selector', () => {
      expect(typeof SELECTORS.jobSubtitle).toBe('string');
    });

    it('should have easyApplyButton as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.easyApplyButton)).toBe(true);
      expect(SELECTORS.easyApplyButton.length).toBeGreaterThan(0);
    });

    it('should have easyApplyModal as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.easyApplyModal)).toBe(true);
      expect(SELECTORS.easyApplyModal.length).toBeGreaterThan(0);
    });

    it('should have formElements as a non-empty array', () => {
      expect(Array.isArray(SELECTORS.formElements)).toBe(true);
      expect(SELECTORS.formElements.length).toBeGreaterThan(0);
    });
  });

  // ===== Pagination =====
  describe('pagination selectors', () => {
    it('should have paginationButtons as a string selector', () => {
      expect(typeof SELECTORS.paginationButtons).toBe('string');
      expect(SELECTORS.paginationButtons).toContain('pagination');
    });
  });

  // ===== All selectors should be valid CSS =====
  describe('selector validity', () => {
    it('messageInput selectors should all be valid CSS', () => {
      SELECTORS.messageInput.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('messageSend selectors should all be valid CSS', () => {
      SELECTORS.messageSend.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('messageClose selectors should all be valid CSS', () => {
      SELECTORS.messageClose.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('chatMessages selectors should all be valid CSS', () => {
      SELECTORS.chatMessages.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('chatTimestamps selectors should all be valid CSS', () => {
      SELECTORS.chatTimestamps.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('peopleCards selectors should all be valid CSS', () => {
      SELECTORS.peopleCards.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('peopleCardsBroad selectors should all be valid CSS', () => {
      SELECTORS.peopleCardsBroad.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('profileNameLink selectors should all be valid CSS', () => {
      SELECTORS.profileNameLink.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('easyApplyButton selectors should all be valid CSS', () => {
      SELECTORS.easyApplyButton.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('easyApplyModal selectors should all be valid CSS', () => {
      SELECTORS.easyApplyModal.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('formElements selectors should all be valid CSS', () => {
      SELECTORS.formElements.forEach(sel => {
        expect(() => document.querySelector(sel)).not.toThrow();
      });
    });

    it('jobCards selector should be valid CSS', () => {
      expect(() => document.querySelector(SELECTORS.jobCards)).not.toThrow();
    });

    it('paginationButtons selector should be valid CSS', () => {
      expect(() => document.querySelector(SELECTORS.paginationButtons)).not.toThrow();
    });
  });
});
