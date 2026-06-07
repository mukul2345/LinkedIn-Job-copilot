// linkedin-selectors.js - Centralized LinkedIn DOM selectors
// UPDATE THIS FILE when LinkedIn changes their UI structure.
// Last updated: May 2026

// Using var so it's accessible across all content script files in the same injection
// eslint-disable-next-line no-var
var SELECTORS = {

  // ===== MESSAGING =====
  // Message input box — LinkedIn may use contenteditable="true" OR "plaintext-only"
  // As of 2026, LinkedIn has been migrating to contenteditable="plaintext-only"
  messageInput: [
    // CONFIRMED WORKING (May 2026) - exact class from LinkedIn's DOM:
    'div.msg-form__contenteditable[contenteditable="true"]',
    'div.msg-form__contenteditable[contenteditable="true"][role="textbox"]',
    'div.msg-form__contenteditable[aria-label="Write a message…"]',
    'div[contenteditable="plaintext-only"][aria-label*="Write a message"]',
    'div[contenteditable="plaintext-only"][aria-label*="message" i]',
    'div.msg-form__message-texteditor div[contenteditable="plaintext-only"]',
    'form.msg-form div[contenteditable="plaintext-only"]',
    'div.msg-overlay-conversation-bubble div[contenteditable="plaintext-only"]',
    'div[class*="msg-overlay"] div[contenteditable="plaintext-only"]',
    'div[class*="msg-form"] div[contenteditable="plaintext-only"]',
    // contenteditable="true" (older LinkedIn format, still possible)
    'div.msg-form__contenteditable[contenteditable="true"] p',
    'div.msg-form__contenteditable[contenteditable="true"]',
    'div.msg-form__message-texteditor div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="Write a message"]',
    'div[contenteditable="true"][aria-label*="message" i]',
    'form.msg-form div[contenteditable="true"]',
    'div.msg-overlay-conversation-bubble div[contenteditable="true"]',
    'div[class*="msg-overlay"] div[contenteditable="true"]',
    // Generic contenteditable (any value)
    'div.msg-form__contenteditable[contenteditable]',
    'div.msg-form__contenteditable[contenteditable] p',
    'div[role="textbox"][contenteditable]',
    'div[aria-label*="Write a message"][contenteditable]',
    'div[aria-label*="message" i][contenteditable]',
    'div[data-placeholder*="Write a message"][contenteditable]',
    'form.msg-form div[contenteditable]',
    'div.msg-form__msg-content-container div[contenteditable]',
    'div.msg-overlay-conversation-bubble div[contenteditable]',
    'div[class*="msg-overlay"] div[contenteditable]',
    'div[class*="msg-convo"] div[contenteditable]',
    'aside[class*="msg"] div[contenteditable]',
  ],

  // Send button in messaging
  messageSend: [
    'button.msg-form__send-button:not([disabled])',
    'button.msg-form__send-btn:not([disabled])',
    'button[aria-label="Send"]:not([disabled])',
    'button[type="submit"][class*="msg-form"]:not([disabled])',
    'form.msg-form button[type="submit"]:not([disabled])',
  ],

  // Close message overlay/conversation
  messageClose: [
    'button.msg-overlay-bubble-header__control--close',
    'button[aria-label*="Close your conversation"]',
    'button[aria-label*="Close" i][class*="msg-overlay"]',
    'button[aria-label*="close" i][class*="msg"]',
    'button.msg-convo-wrapper__close-btn',
    'header button[data-control-name*="close"]',
    'button[data-control-name="overlay.close_conversation_window"]',
    // The X button in the message bubble header
    'div.msg-overlay-bubble-header button[class*="close"]',
    'div.msg-overlay-bubble-header button:last-child',
    'section.msg-overlay-conversation-bubble button[aria-label*="Close"]',
  ],

  // Chat messages in conversation (to detect existing conversations)
  chatMessages: [
    'li.msg-s-message-list__event',
    'div.msg-s-event-listitem',
    'div.msg-s-message-group',
    'div[class*="msg-s-message-list-container"] li',
    'ul[class*="msg-s-message-list"] li',
  ],

  // Timestamps in chat
  chatTimestamps: [
    'time.msg-s-message-group__timestamp',
    'time[class*="msg-s-message"]',
    'span.msg-s-message-group__timestamp',
    'time[datetime]',
    '.msg-s-message-list-container time',
    '.msg-s-message-group__timestamp',
  ],

  // ===== PEOPLE SEARCH (HR Outreach) =====
  // People search result cards
  peopleCards: [
    'li.reusable-search__result-container',
    'div[data-view-name="search-entity-result-universal-template"]',
    'li[class*="search-result"]',
    'div.entity-result',
    'div[class*="entity-result"]',
    'ul[class*="reusable-search"] > li',
  ],

  // Broader people card selectors (fallback)
  peopleCardsBroad: [
    'div.search-results-container li',
    'main[class*="search"] li',
    'div[id*="search"] li',
  ],

  // Profile name link within a people card
  profileNameLink: [
    'a[href*="/in/"] span[aria-hidden="true"]',
    'a[href*="/in/"] span[dir="ltr"]',
    'a[href*="/in/"]',
  ],

  // Profile link
  profileLink: 'a[href*="/in/"]',

  // ===== JOB SEARCH =====
  // Job listing cards
  jobCards: 'li[data-occludable-job-id]',

  // Job title link
  jobTitleLink: 'a.job-card-list__title, a.job-card-container__link',

  // Job subtitle (company info)
  jobSubtitle: '.artdeco-entity-lockup__subtitle, .job-card-container__primary-description',

  // "Applied" badge on job card
  appliedBadge: '.job-card-container__footer-job-state',

  // Easy Apply button
  easyApplyButton: [
    'button.jobs-apply-button[aria-label*="Easy"]',
    'button.jobs-apply-button--top-card',
    'button.jobs-apply-button',
  ],

  // Job description content
  jobDescription: '.jobs-box__html-content, .jobs-description__content',

  // Easy Apply modal
  easyApplyModal: [
    '.jobs-easy-apply-modal',
    '.artdeco-modal[role="dialog"]',
    'div[data-test-modal]',
  ],

  // Form elements in Easy Apply
  formElements: [
    'div[data-test-form-element]',
    'div[class*="jobs-easy-apply-form-element"]',
    'div[class*="fb-form-element"]',
  ],

  // ===== PAGINATION =====
  paginationButtons: '.artdeco-pagination__pages button, nav[aria-label*="pagination"] button',

  // ===== RECRUITER MESSAGING (post-apply) =====
  // Job detail scrollable area
  jobDetailScroll: '.jobs-search__job-details, .job-details-module, main',
};
