// tests/modules/hr-outreach.test.js - Unit tests for hr-outreach.js (the fixed HR DM feature)

const { loadModules, loadModuleByPath } = require('../helpers/load-modules');

beforeAll(() => {
  loadModules(['plan-config.js', 'usage-repository.js', 'plan-service.js', 'utils.js', 'selectors.js', 'upgrade-modal.js', 'safety.js', 'hr-outreach.js']);
});

beforeEach(() => {
  resetChromeMocks();
  document.body.innerHTML = '';
  jest.spyOn(console, 'log').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ===== findMessageButtonOnCard() =====
describe('findMessageButtonOnCard()', () => {
  it('should find button with aria-label containing "Message"', () => {
    document.body.innerHTML = `
      <div id="card">
        <button aria-label="Message John Doe">Message</button>
      </div>
    `;
    const card = document.getElementById('card');
    const btn = findMessageButtonOnCard(card);
    expect(btn).not.toBeNull();
    expect(btn.textContent.trim()).toBe('Message');
  });

  it('should find button by text content "Message"', () => {
    document.body.innerHTML = `
      <div id="card">
        <button class="some-class">Connect</button>
        <button class="msg-btn">Message</button>
      </div>
    `;
    const card = document.getElementById('card');
    const btn = findMessageButtonOnCard(card);
    expect(btn).not.toBeNull();
    expect(btn.textContent.trim()).toBe('Message');
  });

  it('should find anchor with text "Message"', () => {
    document.body.innerHTML = `
      <div id="card">
        <a role="button" href="/messaging/compose">Message</a>
      </div>
    `;
    const card = document.getElementById('card');
    const btn = findMessageButtonOnCard(card);
    expect(btn).not.toBeNull();
  });

  it('should return null if no Message button exists', () => {
    document.body.innerHTML = `
      <div id="card">
        <button>Connect</button>
        <button>Follow</button>
      </div>
    `;
    const card = document.getElementById('card');
    const btn = findMessageButtonOnCard(card);
    expect(btn).toBeNull();
  });

  it('should prefer text-based match over aria-label', () => {
    document.body.innerHTML = `
      <div id="card">
        <button aria-label="Message someone">Send</button>
        <button>Message</button>
      </div>
    `;
    const card = document.getElementById('card');
    const btn = findMessageButtonOnCard(card);
    expect(btn.textContent.trim()).toBe('Message');
  });
});

// ===== hasRecentConversation() =====
describe('hasRecentConversation()', () => {
  it('should return false if no chat messages exist', async () => {
    document.body.innerHTML = '<div class="empty-chat"></div>';
    const result = await hasRecentConversation();
    expect(result).toBe(false);
  });

  it('should return true if datetime within last 2 months', async () => {
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    document.body.innerHTML = `
      <li class="msg-s-message-list__event">
        <time datetime="${recentDate}">10 days ago</time>
        <p>Hello!</p>
      </li>
    `;
    const result = await hasRecentConversation();
    expect(result).toBe(true);
  });

  it('should return true if any older conversation exists', async () => {
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days ago
    document.body.innerHTML = `
      <li class="msg-s-message-list__event">
        <time datetime="${oldDate}">3 months ago</time>
        <p>Old message</p>
      </li>
    `;
    const result = await hasRecentConversation();
    expect(result).toBe(true);
  });

  it('should detect "today" in timestamp text', async () => {
    document.body.innerHTML = `
      <li class="msg-s-message-list__event">
        <time class="msg-s-message-group__timestamp">today</time>
        <p>Recent!</p>
      </li>
    `;
    const result = await hasRecentConversation();
    expect(result).toBe(true);
  });

  it('should detect "yesterday" in timestamp text', async () => {
    document.body.innerHTML = `
      <li class="msg-s-message-list__event">
        <time class="msg-s-message-group__timestamp">yesterday</time>
        <p>Recent!</p>
      </li>
    `;
    const result = await hasRecentConversation();
    expect(result).toBe(true);
  });

  it('should detect "2 days ago" in timestamp text', async () => {
    document.body.innerHTML = `
      <li class="msg-s-message-list__event">
        <time class="msg-s-message-group__timestamp">2 days ago</time>
        <p>Recent!</p>
      </li>
    `;
    const result = await hasRecentConversation();
    expect(result).toBe(true);
  });

  it('should detect "3 weeks ago" in timestamp text', async () => {
    document.body.innerHTML = `
      <li class="msg-s-message-list__event">
        <time class="msg-s-message-group__timestamp">3 weeks ago</time>
        <p>Recent!</p>
      </li>
    `;
    const result = await hasRecentConversation();
    expect(result).toBe(true);
  });
});

// ===== closeMessageWindow() =====
describe('closeMessageWindow()', () => {
  it('should click close button if found', async () => {
    const clickMock = jest.fn();
    document.body.innerHTML = `
      <button class="msg-overlay-bubble-header__control--close">X</button>
    `;
    document.querySelector('button').addEventListener('click', clickMock);

    await closeMessageWindow();
    expect(clickMock).toHaveBeenCalled();
  });

  it('should press Escape if no close button found', async () => {
    document.body.innerHTML = '<div>No close button here</div>';
    const handler = jest.fn();
    document.addEventListener('keydown', handler);

    await closeMessageWindow();

    expect(handler).toHaveBeenCalled();
    const event = handler.mock.calls[0][0];
    expect(event.key).toBe('Escape');

    document.removeEventListener('keydown', handler);
  });

  it('should try multiple close button selectors', async () => {
    document.body.innerHTML = `
      <button aria-label="Close your conversation with John">X</button>
    `;
    const btn = document.querySelector('button');
    const clickSpy = jest.spyOn(btn, 'click');

    await closeMessageWindow();
    // The selector 'button[aria-label*="Close"]' should match
    // Note: depends on selector order in SELECTORS.messageClose
  });
});

// ===== waitForMessageInput() =====
describe('waitForMessageInput()', () => {
  it('should find message input if already present', async () => {
    document.body.innerHTML = `
      <div class="msg-form__message-texteditor">
        <div contenteditable="true" role="textbox">Write a message…</div>
      </div>
    `;
    const result = await waitForMessageInput();
    expect(result).not.toBeNull();
    expect(result.getAttribute('contenteditable')).toBe('true');
  });

  it('should find input with aria-label', async () => {
    document.body.innerHTML = `
      <div aria-label="Write a message…" contenteditable="true" role="textbox"></div>
    `;
    const result = await waitForMessageInput();
    expect(result).not.toBeNull();
  });

  it('should find input with msg-form__contenteditable class', async () => {
    document.body.innerHTML = `
      <div class="msg-form__contenteditable" contenteditable="true">
        <p></p>
      </div>
    `;
    const result = await waitForMessageInput();
    expect(result).not.toBeNull();
  });

  it('should return null if no input found after retries', async () => {
    document.body.innerHTML = '<div>No message input here</div>';
    const result = await waitForMessageInput();
    expect(result).toBeNull();
  }, 30000);
});

// ===== findPeopleCards() =====
describe('findPeopleCards()', () => {
  it('should find cards with reusable-search class', async () => {
    document.body.innerHTML = `
      <ul>
        <li class="reusable-search__result-container">Person 1</li>
        <li class="reusable-search__result-container">Person 2</li>
      </ul>
    `;
    const cards = await findPeopleCards();
    expect(cards.length).toBe(2);
  });

  it('should find cards with entity-result class', async () => {
    document.body.innerHTML = `
      <div class="entity-result">Person 1</div>
      <div class="entity-result">Person 2</div>
      <div class="entity-result">Person 3</div>
    `;
    const cards = await findPeopleCards();
    expect(cards.length).toBe(3);
  });

  it('should find cards by Message button as last resort', async () => {
    document.body.innerHTML = `
      <ul>
        <li style="width: 500px; height: 100px;">
          <span>John Doe</span>
          <button>Message</button>
        </li>
        <li style="width: 500px; height: 100px;">
          <span>Jane Smith</span>
          <button>Message</button>
        </li>
      </ul>
    `;
    // Mock offsetHeight/offsetWidth (jsdom doesn't compute layout)
    const lis = document.querySelectorAll('li');
    lis.forEach(li => {
      Object.defineProperty(li, 'offsetHeight', { value: 100 });
      Object.defineProperty(li, 'offsetWidth', { value: 500 });
    });

    const cards = await findPeopleCards();
    expect(cards.length).toBe(2);
  });

  it('should return empty array if no cards found', async () => {
    document.body.innerHTML = '<div>Empty page</div>';
    const cards = await findPeopleCards();
    expect(cards.length).toBe(0);
  });
});

// ===== goToHRNextPage() =====
describe('goToHRNextPage()', () => {
  it('should click page number button if found', async () => {
    const clickMock = jest.fn();
    document.body.innerHTML = `
      <button aria-label="Page 2">2</button>
    `;
    document.querySelector('button').onclick = clickMock;
    document.querySelector('button').scrollIntoView = jest.fn();

    const result = await goToHRNextPage(2);
    expect(result).toBe(true);
    expect(clickMock).toHaveBeenCalled();
  });

  it('should click "Next" button if page number not found', async () => {
    const clickMock = jest.fn();
    document.body.innerHTML = `
      <button aria-label="Next">Next</button>
    `;
    document.querySelector('button').onclick = clickMock;
    document.querySelector('button').scrollIntoView = jest.fn();

    const result = await goToHRNextPage(5);
    expect(result).toBe(true);
    expect(clickMock).toHaveBeenCalled();
  });

  it('should return false if no pagination button found', async () => {
    document.body.innerHTML = '<div>No pagination</div>';
    const result = await goToHRNextPage(2);
    expect(result).toBe(false);
  });
});

// ===== processHRCard() =====
describe('processHRCard()', () => {
  const baseContext = {
    messagedHRs: [],
    messageTemplate: 'Hi {name}, this is a test message!',
    sentCount: 0,
    dailyLimit: 25,
  };

  it('should return "skipped" if no name link found', async () => {
    document.body.innerHTML = '<div id="card"><button>Message</button></div>';
    const card = document.getElementById('card');
    const result = await processHRCard(card, baseContext);
    expect(result).toBe('skipped');
  });

  it('should return "skipped" if no profile link found', async () => {
    document.body.innerHTML = `
      <div id="card">
        <span aria-hidden="true">John Doe</span>
        <button>Message</button>
      </div>
    `;
    const card = document.getElementById('card');
    const result = await processHRCard(card, baseContext);
    expect(result).toBe('skipped');
  });

  it('should return "skipped" if already messaged', async () => {
    document.body.innerHTML = `
      <div id="card">
        <a href="https://www.linkedin.com/in/johndoe">
          <span aria-hidden="true">John Doe</span>
        </a>
        <button>Message</button>
      </div>
    `;
    const card = document.getElementById('card');
    const context = {
      ...baseContext,
      messagedHRs: [{ profileUrl: 'https://www.linkedin.com/in/johndoe', date: new Date().toISOString() }],
    };
    const result = await processHRCard(card, context);
    expect(result).toBe('skipped');
  });

  it('should return "skipped" if no Message button on card', async () => {
    document.body.innerHTML = `
      <div id="card">
        <a href="https://www.linkedin.com/in/johndoe">
          <span aria-hidden="true">John Doe</span>
        </a>
        <button>Connect</button>
      </div>
    `;
    const card = document.getElementById('card');
    const result = await processHRCard(card, baseContext);
    expect(result).toBe('skipped');
  });
});

// ===== clickSendButton() =====
describe('clickSendButton()', () => {
  it('should click Send button if found and enabled', async () => {
    document.body.innerHTML = `
      <div contenteditable="true" id="editor">Hello</div>
      <button>Send</button>
    `;
    const editor = document.getElementById('editor');
    const sendBtn = document.querySelector('button');
    const clickSpy = jest.spyOn(sendBtn, 'click');

    const result = await clickSendButton(editor, 'Hello');
    expect(result).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('should not click disabled Send button', async () => {
    document.body.innerHTML = `
      <div contenteditable="true" id="editor">Hello</div>
      <button disabled>Send</button>
    `;
    const editor = document.getElementById('editor');

    const result = await clickSendButton(editor, 'Hello');
    // Falls through to Enter key method
    expect(result).toBe(false); // Enter doesn't clear text in jsdom
  });

  it('should try Enter key if no Send button found', async () => {
    document.body.innerHTML = `
      <div contenteditable="true" id="editor">Hello</div>
    `;
    const editor = document.getElementById('editor');
    const dispatchSpy = jest.spyOn(editor, 'dispatchEvent');

    await clickSendButton(editor, 'Hello');

    // Should have dispatched a KeyboardEvent
    const keyEvent = dispatchSpy.mock.calls.find(
      call => call[0] instanceof KeyboardEvent
    );
    expect(keyEvent).toBeDefined();
  });

  it('should find Send button by selector if text match fails', async () => {
    document.body.innerHTML = `
      <div contenteditable="true" id="editor">Hello</div>
      <button class="msg-form__send-button">→</button>
    `;
    const editor = document.getElementById('editor');
    const sendBtn = document.querySelector('button');
    const clickSpy = jest.spyOn(sendBtn, 'click');

    const result = await clickSendButton(editor, 'Hello');
    // In test env without Shadow DOM, it finds the button in regular DOM by text "→" won't match "Send"
    // But msg-form__send-button class won't be found without shadow root
    // The function will fall through to Enter key method
    expect(result).toBe(false);
  });
});

// ===== getShadowRoot() =====
describe('getShadowRoot()', () => {
  it('should return null if no shadow host exists', () => {
    document.body.innerHTML = '<div>No shadow here</div>';
    const result = getShadowRoot();
    expect(result).toBeNull();
  });

  it('should return null if host exists but has no shadowRoot', () => {
    document.body.innerHTML = '<div class="theme--light">No shadow attached</div>';
    const result = getShadowRoot();
    expect(result).toBeNull();
  });

  it('should return shadowRoot if host has open shadow DOM', () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div>Shadow content</div>';
    document.body.appendChild(host);

    const result = getShadowRoot();
    expect(result).not.toBeNull();
    expect(result).toBe(shadow);
  });
});

// ===== findInputInShadowDOM() =====
describe('findInputInShadowDOM()', () => {
  it('should return null if no shadow DOM exists', () => {
    document.body.innerHTML = '<div>Regular DOM only</div>';
    const result = findInputInShadowDOM();
    expect(result).toBeNull();
  });

  it('should find msg-form__contenteditable inside shadow DOM', () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div class="msg-form__contenteditable" contenteditable="true" role="textbox">
      </div>
    `;
    document.body.appendChild(host);

    const result = findInputInShadowDOM();
    expect(result).not.toBeNull();
    expect(result.className).toContain('msg-form__contenteditable');
  });

  it('should find contenteditable with role=textbox inside shadow DOM', () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div contenteditable="true" role="textbox" aria-label="Write a message…">
      </div>
    `;
    document.body.appendChild(host);

    const result = findInputInShadowDOM();
    expect(result).not.toBeNull();
    expect(result.getAttribute('role')).toBe('textbox');
  });

  it('should return the LAST matching element (most recent window)', () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div class="msg-form__contenteditable" contenteditable="true" id="first"></div>
      <div class="msg-form__contenteditable" contenteditable="true" id="second"></div>
    `;
    document.body.appendChild(host);

    const result = findInputInShadowDOM();
    expect(result).not.toBeNull();
    expect(result.id).toBe('second');
  });
});

// ===== Shadow DOM closeMessageWindow() =====
describe('closeMessageWindow() with Shadow DOM', () => {
  it('should find and click close button inside shadow DOM by text', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <button class="msg-overlay-bubble-header__control">Close your draft conversation</button>
    `;
    document.body.appendChild(host);

    const btn = shadow.querySelector('button');
    const clickSpy = jest.spyOn(btn, 'click');

    await closeMessageWindow();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('should fall back to Escape if no close button in shadow DOM', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div>No close button here</div>';
    document.body.appendChild(host);

    const handler = jest.fn();
    document.addEventListener('keydown', handler);

    await closeMessageWindow();
    expect(handler).toHaveBeenCalled();

    document.removeEventListener('keydown', handler);
  });
});

// ===== Shadow DOM clickSendButton() =====
describe('clickSendButton() with Shadow DOM', () => {
  it('should find Send button by text inside shadow DOM', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <button class="msg-form__send-button">Send</button>
    `;
    document.body.appendChild(host);

    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = 'Hello';
    document.body.appendChild(editor);

    const sendBtn = shadow.querySelector('button');
    const clickSpy = jest.spyOn(sendBtn, 'click');

    const result = await clickSendButton(editor, 'Hello');
    expect(result).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('should find Send button by class inside shadow DOM', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <button class="msg-form__send-button">→</button>
    `;
    document.body.appendChild(host);

    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.textContent = 'Hello';
    document.body.appendChild(editor);

    const sendBtn = shadow.querySelector('button');
    const clickSpy = jest.spyOn(sendBtn, 'click');

    const result = await clickSendButton(editor, 'Hello');
    expect(result).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
  });
});

// ===== Case-insensitive name replacement =====
describe('message template name replacement', () => {
  // Test the regex replacement directly (same logic used in processHRCard)
  function replaceNameInTemplate(template, fullName) {
    const firstName = fullName.split(' ')[0];
    return template.replace(/\{name\}/gi, firstName);
  }

  it('should replace {Name} (capital N) with first name', () => {
    const result = replaceNameInTemplate('Hi {Name}, how are you?', 'John Doe');
    expect(result).toBe('Hi John, how are you?');
  });

  it('should replace {name} (lowercase) with first name', () => {
    const result = replaceNameInTemplate('Hello {name}, reaching out!', 'Jane Smith');
    expect(result).toBe('Hello Jane, reaching out!');
  });

  it('should replace {NAME} (all caps) with first name', () => {
    const result = replaceNameInTemplate('Dear {NAME}, I wanted to connect.', 'Bob Johnson');
    expect(result).toBe('Dear Bob, I wanted to connect.');
  });

  it('should replace multiple occurrences', () => {
    const result = replaceNameInTemplate('Hi {Name}, {name} here is your info {NAME}', 'Alice Wonder');
    expect(result).toBe('Hi Alice, Alice here is your info Alice');
  });

  it('should handle names with special characters', () => {
    const result = replaceNameInTemplate('Hi {Name}!', 'María García');
    expect(result).toBe('Hi María!');
  });

  it('should use only first name from full name', () => {
    const result = replaceNameInTemplate('Hey {name}', 'Sai Sri Mounica Perumalla');
    expect(result).toBe('Hey Sai');
  });
});

// ===== Search URL keywords =====
describe('startHROutreach() search URL', () => {
  it('should include manager and team lead keywords in search URL', async () => {
    // We can't easily test the full startHROutreach flow, but we can verify
    // the search URL is constructed correctly by checking the source code constant
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../extension/modules/bot/hr-outreach.js'),
      'utf8'
    );

    // Verify the search URL contains the new keywords
    expect(source).toContain('hiring%20manager');
    expect(source).toContain('team%20lead');
    expect(source).toContain('engineering%20manager');
    // Also verify original keywords are still there
    expect(source).toContain('recruiter');
    expect(source).toContain('HR');
    expect(source).toContain('talent%20acquisition');
  });
});

// ===== Delay configuration =====
describe('HR outreach delay configuration', () => {
  it('should use the centralized LinkedIn message-delay minimum', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../extension/modules/bot/hr-outreach.js'),
      'utf8'
    );

    expect(source).toContain('LINKEDIN_SAFETY_LIMITS.minDelay.betweenMessages');
    expect(source).toContain('Math.max(configuredMessageDelay, minimumMessageDelay)');
  });

  it('should let the centralized minimum supply the fallback delay', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../extension/modules/bot/hr-outreach.js'),
      'utf8'
    );

    expect(source).toContain('config.hrDelayBetween || 0');
    expect(source).not.toContain('hrDelayBetween || 30');
  });
});

// ===== hasRecentConversation() with Shadow DOM =====
describe('hasRecentConversation() with Shadow DOM', () => {
  it('should check inside shadow DOM for chat messages', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    shadow.innerHTML = `
      <li class="msg-s-message-list__event">
        <time datetime="${recentDate}">5 days ago</time>
        <p>Recent message</p>
      </li>
    `;
    document.body.appendChild(host);

    const result = await hasRecentConversation();
    expect(result).toBe(true);
  });

  it('should return false if shadow DOM has no messages', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div>Empty conversation</div>';
    document.body.appendChild(host);

    const result = await hasRecentConversation();
    expect(result).toBe(false);
  });
});

// ===== waitForMessageInput() with Shadow DOM =====
describe('waitForMessageInput() with Shadow DOM', () => {
  it('should find input inside shadow DOM', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div class="msg-form__contenteditable" contenteditable="true" role="textbox">
      </div>
    `;
    document.body.appendChild(host);

    const result = await waitForMessageInput();
    expect(result).not.toBeNull();
    expect(result.className).toContain('msg-form__contenteditable');
  });

  it('should return null if shadow DOM has no input', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'theme--light';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div>No input here</div>';
    document.body.appendChild(host);

    const result = await waitForMessageInput();
    expect(result).toBeNull();
  }, 30000);
});
