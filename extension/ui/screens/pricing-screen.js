// pricing-screen.js - Pricing tab UI rendering and interaction
// Shows plan comparison and pricing options in the popup.

/**
 * Render the pricing tab content.
 * Called when user navigates to the Pricing tab.
 */
function renderPricingPage() {
  const container = document.getElementById('pricingContent');
  if (!container) return;

  const options = getAllPricingOptions();

  container.innerHTML = `
    <div class="pricing-header">
      <h2 class="pricing-title">Upgrade to Pro</h2>
      <p class="pricing-subtitle">Unlock unlimited applications and HR outreach</p>
    </div>

    <div class="plan-comparison">
      <div class="plan-col plan-free">
        <div class="plan-badge">Current</div>
        <h3>Free</h3>
        <p class="plan-price">₹0</p>
        <ul>
          <li>3 applications/day</li>
          <li>3 HR messages/day</li>
          <li>3 search terms</li>
          <li>1 message template</li>
          <li class="disabled">AI answers</li>
        </ul>
      </div>
      <div class="plan-col plan-pro">
        <div class="plan-badge pro">Recommended</div>
        <h3>Pro</h3>
        <p class="plan-price">₹299<span>/mo</span></p>
        <ul>
          <li><strong>Unlimited</strong> applications</li>
          <li><strong>Unlimited</strong> HR messages</li>
          <li><strong>Unlimited</strong> search terms</li>
          <li><strong>Unlimited</strong> templates</li>
          <li>AI-powered answers</li>
        </ul>
      </div>
    </div>

    <div class="pricing-periods">
      <h3>Choose your plan</h3>
      ${options.map(opt => `
        <label class="pricing-option" data-period="${opt.id}">
          <input type="radio" name="pricingPeriod" value="${opt.id}" ${opt.popular ? 'checked' : ''}>
          <div class="pricing-option-content">
            <div class="pricing-option-left">
              <span class="pricing-option-label">${opt.label}</span>
              ${opt.savings ? `<span class="pricing-option-savings">${opt.savings}</span>` : ''}
            </div>
            <div class="pricing-option-right">
              <span class="pricing-option-price">₹${opt.price}</span>
              ${opt.perMonth ? `<span class="pricing-option-permonth">₹${opt.perMonth}/mo</span>` : ''}
            </div>
          </div>
        </label>
      `).join('')}
    </div>

    <button id="subscribePro" class="btn btn-primary btn-subscribe">
      Subscribe to Pro →
    </button>

    <div class="payment-provider-selector" style="margin-top: 12px; text-align: center;">
      <label style="margin-right: 16px; cursor: pointer;">
        <input type="radio" name="paymentProvider" value="cashfree" checked>
        Cashfree (UPI/Cards)
      </label>
      <label style="cursor: pointer;">
        <input type="radio" name="paymentProvider" value="razorpay">
        Razorpay (UPI/Cards/NetBanking)
      </label>
    </div>

    <p class="pricing-note">Secure payment. 0% fee on UPI. Cancel anytime.</p>
  `;

  // Attach subscribe button handler
  document.getElementById('subscribePro')?.addEventListener('click', handleSubscribe);

  // Check if there's a pending payment to verify
  checkPendingPayment();
}

/**
 * Handle the subscribe button click.
 * Creates a payment session via Cloud Function and opens checkout.
 * Supports both Cashfree and Razorpay.
 */
async function handleSubscribe() {
  const selectedPeriod = document.querySelector('input[name="pricingPeriod"]:checked')?.value;
  if (!selectedPeriod) {
    showNotification('Please select a plan period.', 'error');
    return;
  }

  const selectedProvider = document.querySelector('input[name="paymentProvider"]:checked')?.value || 'cashfree';

  const pricing = getPricing(selectedPeriod);
  const user = getCurrentUser();

  if (!user) {
    showNotification('Please sign in first.', 'error');
    return;
  }

  const subscribeBtn = document.getElementById('subscribePro');
  if (subscribeBtn) {
    subscribeBtn.disabled = true;
    subscribeBtn.textContent = 'Creating payment...';
  }

  try {
    const result = await initiatePayment(user, pricing, selectedProvider);
    if (result.success) {
      showNotification(`Opening ${selectedProvider} payment page for ${pricing.label} (₹${pricing.price})...`, 'info');
      if (subscribeBtn) {
        subscribeBtn.textContent = 'Payment opened — complete in new tab';
      }
    } else {
      showNotification(`Payment error: ${result.error}`, 'error');
      if (subscribeBtn) {
        subscribeBtn.disabled = false;
        subscribeBtn.textContent = 'Subscribe to Pro →';
      }
    }
  } catch (error) {
    showNotification(`Payment error: ${error.message}`, 'error');
    if (subscribeBtn) {
      subscribeBtn.disabled = false;
      subscribeBtn.textContent = 'Subscribe to Pro →';
    }
  }
}

/**
 * Check if there's a pending payment and verify its status.
 * Called when pricing tab opens — handles the case where user
 * completed payment and returned to the extension.
 */
async function checkPendingPayment() {
  if (typeof verifyPendingPayment !== 'function') return;

  const result = await verifyPendingPayment();
  if (result.status === 'paid') {
    showNotification('🎉 Payment successful! Pro plan activated.', 'success');
    updatePricingStatus();
    updateUserAccountUI();
  }
}

/**
 * Update the pricing page to show current plan status.
 */
async function updatePricingStatus() {
  const { plan, expiresAt, isActive, role } = await getUserPlanStatus();

  const freeCol = document.querySelector('.plan-free .plan-badge');
  const proCol = document.querySelector('.plan-pro .plan-badge');
  const subscribeBtn = document.getElementById('subscribePro');

  if ((plan === 'pro' && isActive) || role === USER_ROLES.ADMIN) {
    if (freeCol) freeCol.textContent = '';
    if (proCol) {
      proCol.textContent = 'Active';
      proCol.className = 'plan-badge active';
    }
    if (subscribeBtn) {
      if (role === USER_ROLES.ADMIN) {
        subscribeBtn.textContent = 'Admin — Unlimited Access';
      } else {
        subscribeBtn.textContent = `Active until ${expiresAt?.toLocaleDateString() || 'N/A'}`;
      }
      subscribeBtn.disabled = true;
    }
  }
}
