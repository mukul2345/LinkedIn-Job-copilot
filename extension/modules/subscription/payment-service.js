// payment-service.js - Payment integration for JobPilot AI Pro
// Supports both Cashfree and Razorpay providers.

/**
 * Cloud Functions base URL
 */
var CLOUD_FUNCTIONS_URL = 'https://us-central1-linkedin-jobcopilot.cloudfunctions.net';

/**
 * Initiate payment checkout for a subscription.
 * Routes to Cashfree or Razorpay based on user selection.
 *
 * @param {object} user - Firebase user object
 * @param {object} pricing - Pricing details { id, price, label }
 * @param {string} provider - 'cashfree' or 'razorpay'
 * @returns {Promise<{success: boolean, orderId?: string, error?: string}>}
 */
async function initiatePayment(user, pricing, provider) {
  try {
    const idToken = await user.getIdToken(true);

    const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createPaymentSession`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ planId: pricing.id, provider: provider || 'cashfree' }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      return { success: false, error: result.error || 'Failed to create payment session.' };
    }

    // Store order ID for verification after payment
    await new Promise(resolve => {
      chrome.storage.local.set({
        pendingPayment: {
          orderId: result.orderId,
          planId: pricing.id,
          amount: pricing.price,
          provider: provider || 'cashfree',
          createdAt: new Date().toISOString(),
        }
      }, resolve);
    });

    // Route based on provider
    if (result.provider === 'razorpay') {
      return openRazorpayCheckout(result);
    } else {
      return openCashfreeCheckout(result);
    }
  } catch (error) {
    console.error('[JobPilot] Payment error:', error);
    return { success: false, error: error.message || 'Payment failed. Please try again.' };
  }
}

/**
 * Open Cashfree hosted checkout page.
 */
function openCashfreeCheckout(result) {
  const { paymentSessionId, orderId, environment } = result;

  if (result.paymentLink) {
    chrome.tabs.create({ url: result.paymentLink });
  } else if (paymentSessionId) {
    // Use our hosted checkout page (Cloud Function serves it)
    const checkoutUrl = `${CLOUD_FUNCTIONS_URL}/handlePaymentWebhook?action=checkout&session=${paymentSessionId}&env=${environment || 'production'}`;
    chrome.tabs.create({ url: checkoutUrl });
  }

  return { success: true, orderId };
}

/**
 * Open Razorpay checkout.
 * Uses Razorpay's hosted checkout URL (standard integration without SDK).
 * The standard flow redirects to Razorpay's page for payment.
 */
function openRazorpayCheckout(result) {
  const { razorpayOrderId, razorpayKeyId, orderId, amount, currency, name, description, prefill } = result;

  // Build Razorpay hosted checkout URL
  // Razorpay standard checkout: create a simple HTML page that loads their SDK
  // We'll use a Cloud Function to serve this (like Cashfree's checkout page)
  const checkoutUrl = `${CLOUD_FUNCTIONS_URL}/handleRazorpayWebhook?action=checkout&orderId=${razorpayOrderId}&keyId=${razorpayKeyId}&amount=${amount}&name=${encodeURIComponent(name || '')}&description=${encodeURIComponent(description || '')}&email=${encodeURIComponent(prefill?.email || '')}`;
  chrome.tabs.create({ url: checkoutUrl });

  return { success: true, orderId };
}

/**
 * Verify a pending payment status (works for both providers).
 * Called when user returns to extension after completing payment.
 * @returns {Promise<{status: string, planId?: string}>}
 */
async function verifyPendingPayment() {
  const data = await new Promise(resolve => {
    chrome.storage.local.get('pendingPayment', resolve);
  });

  if (!data.pendingPayment || !data.pendingPayment.orderId) {
    return { status: 'none' };
  }

  try {
    const user = getCurrentUser();
    if (!user) return { status: 'unauthenticated' };

    const idToken = await user.getIdToken(true);

    const response = await fetch(`${CLOUD_FUNCTIONS_URL}/verifyPayment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ orderId: data.pendingPayment.orderId }),
    });

    const result = await response.json();

    if (result.status === 'paid') {
      await new Promise(resolve => {
        chrome.storage.local.remove('pendingPayment', resolve);
      });
      // Refresh plan cache
      await invalidateCache('plan');
      await invalidateCache('fullProfile');
      if (typeof refreshPlanFromCloud === 'function') {
        await refreshPlanFromCloud();
      }
      return { status: 'paid', planId: result.planId };
    }

    return { status: result.status };
  } catch (error) {
    console.warn('[JobPilot] Payment verification error:', error.message);
    return { status: 'error' };
  }
}
