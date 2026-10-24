// upgrade-modal.js - Shows upgrade prompt when free user hits daily limit
// Injected into LinkedIn page as a non-blocking overlay.

/**
 * Show the upgrade modal on the LinkedIn page.
 * @param {string} reason - Why the limit was hit (e.g., "Daily application limit reached")
 * @param {number} current - Current usage count
 * @param {number|string} limit - Plan limit
 */
function showUpgradeModal(reason, current, limit) {
  // Remove existing modal if any
  removeUpgradeModal();

  const modal = document.createElement('div');
  modal.id = 'jp-upgrade-modal';
  const overlay = document.createElement('div');
  overlay.className = 'jp-upgrade-overlay';
  const card = document.createElement('div');
  card.className = 'jp-upgrade-card';

  const appendTextElement = (tagName, className, text) => {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    card.appendChild(element);
    return element;
  };

  const closeButton = appendTextElement('button', 'jp-upgrade-close', '✕');
  closeButton.id = 'jp-upgrade-close';
  appendTextElement('div', 'jp-upgrade-icon', '⚡');
  appendTextElement('h2', '', 'Upgrade to Pro');
  appendTextElement('p', 'jp-upgrade-reason', String(reason || 'Plan limit reached.'));
  const stats = appendTextElement('div', 'jp-upgrade-stats', `This month: ${Number(current) || 0}/${String(limit ?? '—')}`);
  stats.setAttribute('aria-label', 'Current plan usage');
  const featureList = document.createElement('ul');
  featureList.className = 'jp-upgrade-features';
  ['More job applications', 'More HR messages', 'AI-powered draft assistance', 'More search terms']
    .forEach(feature => {
      const item = document.createElement('li');
      item.textContent = `✓ ${feature}`;
      featureList.appendChild(item);
    });
  card.appendChild(featureList);
  appendTextElement('p', 'jp-upgrade-price', 'View available plans and pricing.');
  const upgradeButton = appendTextElement('button', 'jp-upgrade-btn', 'View Plans →');
  upgradeButton.id = 'jp-upgrade-btn';
  const skipButton = appendTextElement('p', 'jp-upgrade-skip', 'Continue with free limits');
  skipButton.id = 'jp-upgrade-skip';
  overlay.appendChild(card);
  modal.appendChild(overlay);

  // Add styles
  const style = document.createElement('style');
  style.id = 'jp-upgrade-styles';
  style.textContent = `
    .jp-upgrade-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .jp-upgrade-card {
      background: #1e2230;
      border: 1px solid #2a2f3e;
      border-radius: 16px;
      padding: 32px;
      max-width: 380px;
      width: 90%;
      text-align: center;
      position: relative;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .jp-upgrade-close {
      position: absolute;
      top: 12px; right: 16px;
      background: none;
      border: none;
      color: #64748b;
      font-size: 18px;
      cursor: pointer;
    }
    .jp-upgrade-close:hover { color: #f1f5f9; }
    .jp-upgrade-icon { font-size: 40px; margin-bottom: 12px; }
    .jp-upgrade-card h2 {
      color: #f1f5f9;
      font-size: 22px;
      margin-bottom: 8px;
    }
    .jp-upgrade-reason {
      color: #94a3b8;
      font-size: 14px;
      margin-bottom: 16px;
    }
    .jp-upgrade-stats {
      background: rgba(99,102,241,0.1);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 8px;
      padding: 8px 16px;
      display: inline-block;
      color: #818cf8;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .jp-upgrade-features {
      list-style: none;
      text-align: left;
      margin: 0 auto 20px;
      max-width: 240px;
    }
    .jp-upgrade-features li {
      color: #94a3b8;
      font-size: 13px;
      padding: 4px 0;
    }
    .jp-upgrade-price {
      color: #64748b;
      font-size: 13px;
      margin-bottom: 16px;
    }
    .jp-upgrade-price strong {
      color: #f1f5f9;
    }
    .jp-upgrade-btn {
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 12px 32px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: background 0.2s;
    }
    .jp-upgrade-btn:hover { background: #818cf8; }
    .jp-upgrade-skip {
      color: #64748b;
      font-size: 12px;
      margin-top: 12px;
      cursor: pointer;
      transition: color 0.2s;
    }
    .jp-upgrade-skip:hover { color: #94a3b8; }
  `;

  document.head.appendChild(style);
  document.body.appendChild(modal);

  // Event listeners
  document.getElementById('jp-upgrade-close').addEventListener('click', removeUpgradeModal);
  document.getElementById('jp-upgrade-skip').addEventListener('click', removeUpgradeModal);
  document.getElementById('jp-upgrade-btn').addEventListener('click', () => {
    // Open extension popup to pricing tab
    chrome.runtime.sendMessage(MessageProtocol.create(MessageType.OPEN_PRICING));
    removeUpgradeModal();
  });
}

/**
 * Remove the upgrade modal from the page.
 */
function removeUpgradeModal() {
  const modal = document.getElementById('jp-upgrade-modal');
  if (modal) modal.remove();
  const style = document.getElementById('jp-upgrade-styles');
  if (style) style.remove();
}
