// payment-service.js - Cashfree payment integration for JobPilot AI Pro
// Handles creating payment sessions and verifying payment status.

/**
 * Cloud Functions base URL
 */
var CLOUD_FUNCTIONS_URL = 'https://us-central1-linkedin-jobcopilot.cloudfunctions.net';

/**
 * Initiate Cashfree checkout for a subscription.
 * Calls the Firebase Cloud Function to create a payment session,
 * then opens Cashfree's hosted checkout page in a new tab.
 *
 * @param {object} user - Firebase user object
 * @param {object} pricing - Pricing details from getPricing()
 * @returns {Promise<{success: boolean, orderId?: string, error?: string}>}
 */
async function initiatePayment(user, pricing) {
  try {
    const idToken = await user.getIdToken(true);

    const response = await fetch(`${CLOUD_FUNCTIONS_URL}/createPaymentSession`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ planId: pricing.id }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      return { success: false, error: result.error || 'Failed to create payment session.' };
    }

    const { paymentSessionId, orderId, environment } = result;

    // Store order ID for verification after payment
    await new Promise(resolve => {
      chrome.storage.local.set({
        pendingPayment: {
          orderId,
          planId: pricing.id,
          amount: pricing.price,
          createdAt: new Date().toISOString(),
        }
      }, resolve);
    });

    // Open Cashfree checkout page
    if (result.paymentLink) {
      chrome.tabs.create({ url: result.paymentLink });
    } else if (paymentSessionId) {
      const baseUrl = environment === 'production'
        ? 'https://payments.cashfree.com'
        : 'https://payments-test.cashfree.com';
      chrome.tabs.create({ url: `${baseUrl}/billpay/order/sessions/${paymentSessionId}` });
    }

    return { success: true, orderId };
  } catch (error) {
    console.error('[JobPilot] Payment error:', error);
    return { success: false, error: error.message || 'Payment failed. Please try again.' };
  }
}

/**
 * Verify a pending payment status.
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
