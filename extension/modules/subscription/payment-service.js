// payment-service.js - Payment integration for JobPilot AI Pro
// Supports both Cashfree and Razorpay providers.

// RuntimeConfig is loaded before this service in every supported extension context.

/** Resolve the backend base URL from centralized runtime configuration when present. */
function getPaymentApiBaseUrl() {
  var configuredUrl = '';
  if (typeof RuntimeConfig !== 'undefined' && RuntimeConfig) {
    if (typeof RuntimeConfig.getCloudFunctionsUrl === 'function') {
      configuredUrl = RuntimeConfig.getCloudFunctionsUrl();
    } else if (typeof RuntimeConfig.getFunctionsBaseUrl === 'function') {
      configuredUrl = RuntimeConfig.getFunctionsBaseUrl();
    } else if (typeof RuntimeConfig.getApiBaseUrl === 'function') {
      configuredUrl = RuntimeConfig.getApiBaseUrl();
    } else if (typeof RuntimeConfig.get === 'function') {
      configuredUrl = RuntimeConfig.get('cloudFunctionsUrl') || RuntimeConfig.get('apiBaseUrl');
    } else {
      configuredUrl = RuntimeConfig.cloudFunctionsUrl || RuntimeConfig.functionsBaseUrl ||
        RuntimeConfig.apiBaseUrl || RuntimeConfig.backendUrl ||
        RuntimeConfig.CLOUD_FUNCTIONS_URL || RuntimeConfig.API_BASE_URL || '';
    }
  }
  if (!configuredUrl) throw new Error('Runtime API configuration is unavailable.');
  return String(configuredUrl).replace(/\/+$/, '');
}

/** Return a validated checkout URL whose HTTPS origin is explicitly allowed. */
function getAllowedCheckoutUrl(rawUrl) {
  try {
    var checkoutUrl = new URL(rawUrl);
    if (checkoutUrl.protocol !== 'https:' || checkoutUrl.username || checkoutUrl.password) return '';

    var backendOrigin = new URL(getPaymentApiBaseUrl()).origin;
    var allowedOrigins = [
      backendOrigin,
      'https://payments.cashfree.com',
      'https://payments-test.cashfree.com',
      'https://sandbox.cashfree.com',
    ];
    return allowedOrigins.indexOf(checkoutUrl.origin) !== -1 ? checkoutUrl.href : '';
  } catch (error) {
    return '';
  }
}

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

    const response = await fetch(`${getPaymentApiBaseUrl()}/createPaymentSession`, {
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

    var checkoutProvider = result.provider || provider || 'cashfree';
    var checkoutResult = checkoutProvider === 'razorpay'
      ? openRazorpayCheckout(result)
      : openCashfreeCheckout(result);
    if (!checkoutResult.success) return checkoutResult;

    await new Promise(resolve => {
      chrome.storage.local.set({
        pendingPayment: {
          orderId: result.orderId,
          planId: pricing.id,
          amount: pricing.price,
          provider: checkoutProvider,
          createdAt: new Date().toISOString(),
        }
      }, resolve);
    });

    return checkoutResult;
  } catch (error) {
    console.error('[JobPilot] Payment error:', error);
    return { success: false, error: error.message || 'Payment failed. Please try again.' };
  }
}

/**
 * Open Cashfree hosted checkout page.
 */
function openCashfreeCheckout(result) {
  var checkoutData = result || {};
  const { paymentSessionId, orderId, environment } = checkoutData;
  if (!orderId) {
    return { success: false, error: 'Payment checkout is missing the order ID.' };
  }

  var rawCheckoutUrl = checkoutData.paymentLink;
  if (!rawCheckoutUrl && paymentSessionId) {
    var hostedCheckoutUrl = new URL('/handlePaymentWebhook', getPaymentApiBaseUrl());
    hostedCheckoutUrl.searchParams.set('action', 'checkout');
    hostedCheckoutUrl.searchParams.set('session', paymentSessionId);
    hostedCheckoutUrl.searchParams.set('env', environment || 'production');
    rawCheckoutUrl = hostedCheckoutUrl.href;
  }
  if (!rawCheckoutUrl) {
    return { success: false, error: 'Payment checkout is missing a redirect URL or session ID.' };
  }

  var checkoutUrl = getAllowedCheckoutUrl(rawCheckoutUrl);
  if (!checkoutUrl) {
    return { success: false, error: 'Payment checkout URL is not an allowed HTTPS origin.' };
  }

  chrome.tabs.create({ url: checkoutUrl });
  return { success: true, orderId };
}

/**
 * Open Razorpay checkout.
 * Uses Razorpay's hosted checkout URL (standard integration without SDK).
 * The standard flow redirects to Razorpay's page for payment.
 */
function openRazorpayCheckout(result) {
  const { razorpayOrderId, razorpayKeyId, orderId, amount, name, description, prefill } = result || {};
  if (!orderId || !razorpayOrderId || !razorpayKeyId ||
      !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return { success: false, error: 'Razorpay checkout is missing required order or session values.' };
  }

  var hostedCheckoutUrl = new URL('/handleRazorpayWebhook', getPaymentApiBaseUrl());
  hostedCheckoutUrl.searchParams.set('action', 'checkout');
  hostedCheckoutUrl.searchParams.set('orderId', razorpayOrderId);
  hostedCheckoutUrl.searchParams.set('keyId', razorpayKeyId);
  hostedCheckoutUrl.searchParams.set('amount', String(amount));
  hostedCheckoutUrl.searchParams.set('name', name || '');
  hostedCheckoutUrl.searchParams.set('description', description || '');
  hostedCheckoutUrl.searchParams.set('email', (prefill && prefill.email) || '');

  var checkoutUrl = getAllowedCheckoutUrl(hostedCheckoutUrl.href);
  if (!checkoutUrl) {
    return { success: false, error: 'Payment checkout URL is not an allowed HTTPS origin.' };
  }

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

    const response = await fetch(`${getPaymentApiBaseUrl()}/verifyPayment`, {
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
      // Refresh plan cache when the cache module is present in this execution context.
      if (typeof invalidateCache === 'function') {
        await invalidateCache('plan');
        await invalidateCache('fullProfile');
      }
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
