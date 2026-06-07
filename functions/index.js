/**
 * JobPilot AI - Firebase Cloud Functions
 * Handles Cashfree payment creation and webhook verification.
 * 
 * FLOW:
 * 1. User clicks "Subscribe to Pro" in extension
 * 2. Extension calls createPaymentSession() Cloud Function
 * 3. Cloud Function creates a Cashfree payment session and returns payment link
 * 4. User completes payment on Cashfree's hosted page
 * 5. Cashfree sends webhook to handlePaymentWebhook() Cloud Function
 * 6. Cloud Function verifies signature, activates Pro plan in Firestore
 * 7. Extension reads updated plan on next open
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

// Cashfree API configuration (reads from functions/.env file)
const CASHFREE_CONFIG = {
  get appId() { return process.env.CASHFREE_APP_ID || ''; },
  get secretKey() { return process.env.CASHFREE_SECRET_KEY || ''; },
  get environment() { return process.env.CASHFREE_ENVIRONMENT || 'sandbox'; },
  get baseUrl() {
    return this.environment === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';
  },
};

// Plan pricing (must match extension's plan-config.js)
const PRICING = {
  monthly: { price: 299, period: 30, label: '1 Month' },
  quarterly: { price: 699, period: 90, label: '3 Months' },
  half_yearly: { price: 1499, period: 180, label: '6 Months' },
  yearly: { price: 2999, period: 365, label: '1 Year' },
};

// ============================================================
// FUNCTION 1: Create Payment Session
// Called by the extension when user clicks "Subscribe to Pro"
// Uses onRequest (HTTP) instead of onCall for Chrome extension compatibility
// ============================================================
exports.createPaymentSession = functions.https.onRequest(async (req, res) => {
  // Handle CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify Firebase Auth token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization token' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;
    const userEmail = decodedToken.email;
    const userName = decodedToken.name || 'User';

    const { planId } = req.body;

    // Validate plan
    if (!PRICING[planId]) {
      return res.status(400).json({ error: `Invalid plan: ${planId}` });
    }

    const plan = PRICING[planId];
    const orderId = `order_${userId.substring(0, 8)}_${Date.now()}`;

    // Create Cashfree order via API
    const orderPayload = {
      order_id: orderId,
      order_amount: plan.price,
      order_currency: 'INR',
      customer_details: {
        customer_id: userId,
        customer_email: userEmail,
        customer_name: userName,
        customer_phone: '9999999999',
      },
      order_meta: {
        return_url: `https://us-central1-linkedin-jobcopilot.cloudfunctions.net/handlePaymentWebhook?order_id=${orderId}&type=return`,
      },
      order_note: `JobPilot Pro - ${plan.label}`,
      order_tags: {
        userId: userId,
        planId: planId,
        period: String(plan.period),
      },
    };

    const response = await fetch(`${CASHFREE_CONFIG.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': CASHFREE_CONFIG.appId,
        'x-client-secret': CASHFREE_CONFIG.secretKey,
        'x-api-version': '2023-08-01',
      },
      body: JSON.stringify(orderPayload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[JobPilot] Cashfree order creation failed:', result);
      return res.status(500).json({ error: 'Payment creation failed', details: result.message });
    }

    // Store order in Firestore for verification later
    await db.collection('orders').doc(orderId).set({
      orderId,
      userId,
      userEmail,
      planId,
      amount: plan.price,
      period: plan.period,
      status: 'created',
      cashfreeOrderId: result.cf_order_id,
      paymentSessionId: result.payment_session_id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[JobPilot] Order created: ${orderId} for ${userEmail} (${plan.label})`);

    // Build checkout URL - use payment_link if available, otherwise use our hosted checkout page
    const checkoutUrl = result.payment_link ||
      `https://us-central1-linkedin-jobcopilot.cloudfunctions.net/handlePaymentWebhook?action=checkout&session=${result.payment_session_id}&env=${CASHFREE_CONFIG.environment}`;

    return res.status(200).json({
      success: true,
      orderId,
      paymentSessionId: result.payment_session_id,
      paymentLink: checkoutUrl,
      environment: CASHFREE_CONFIG.environment,
    });

  } catch (error) {
    console.error('[JobPilot] Payment session error:', error);
    return res.status(500).json({ error: error.message || 'Something went wrong' });
  }
});

// ============================================================
// FUNCTION 2: Payment Webhook Handler
// Called by Cashfree when payment status changes
// ============================================================
exports.handlePaymentWebhook = functions.https.onRequest(async (req, res) => {
  // Serve checkout page (redirects user to Cashfree payment)
  if (req.method === 'GET' && req.query.action === 'checkout') {
    const sessionId = req.query.session;
    const env = req.query.env || 'production';
    if (!sessionId) return res.status(400).send('Missing session');

    return res.status(200).send(`<!DOCTYPE html>
<html>
<head>
  <title>JobPilot AI - Payment</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f1117; color: #f1f5f9; }
    .container { text-align: center; padding: 40px; }
    .spinner { border: 3px solid #2a2f3e; border-top: 3px solid #6366f1; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h2>⚡ JobPilot AI</h2>
    <div class="spinner"></div>
    <p>Redirecting to payment...</p>
  </div>
  <script>
    const cashfree = Cashfree({ mode: "${env}" });
    cashfree.checkout({
      paymentSessionId: "${sessionId}",
      redirectTarget: "_self",
    });
  </script>
</body>
</html>`);
  }

  // Handle return URL (user redirected back after payment)
  if (req.method === 'GET' && req.query.type === 'return') {
    return res.status(200).send(`<!DOCTYPE html>
<html>
<head>
  <title>Payment Complete - JobPilot AI</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f1117; color: #f1f5f9; }
    .container { text-align: center; padding: 40px; max-width: 400px; }
    .success { color: #10b981; font-size: 48px; }
    p { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">✓</div>
    <h2>Payment Processing</h2>
    <p>Your payment is being verified. Open the JobPilot AI extension to check your plan status.</p>
    <p style="margin-top: 20px; font-size: 14px;">You can close this tab.</p>
  </div>
</body>
</html>`);
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const payload = req.body;
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    // Verify webhook signature
    if (!verifyWebhookSignature(req.rawBody || JSON.stringify(payload), signature, timestamp)) {
      console.error('[JobPilot] Invalid webhook signature');
      return res.status(401).send('Invalid signature');
    }

    const eventType = payload.type;
    const orderData = payload.data?.order;
    const paymentData = payload.data?.payment;

    console.log(`[JobPilot] Webhook received: ${eventType}, order: ${orderData?.order_id}`);

    // Only process successful payments
    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' || 
        (eventType === 'ORDER_PAID_WEBHOOK') ||
        (orderData?.order_status === 'PAID')) {
      
      const orderId = orderData?.order_id;
      if (!orderId) {
        console.error('[JobPilot] No order_id in webhook');
        return res.status(400).send('Missing order_id');
      }

      // Get order from Firestore
      const orderDoc = await db.collection('orders').doc(orderId).get();
      if (!orderDoc.exists) {
        console.error(`[JobPilot] Order not found: ${orderId}`);
        return res.status(404).send('Order not found');
      }

      const order = orderDoc.data();

      // Prevent duplicate processing
      if (order.status === 'paid') {
        console.log(`[JobPilot] Order ${orderId} already processed. Skipping.`);
        return res.status(200).send('Already processed');
      }

      // Activate Pro plan
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + order.period);

      await db.collection('users').doc(order.userId).update({
        plan: 'pro',
        planExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        planActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        planId: order.planId,
      });

      // Update order status
      await db.collection('orders').doc(orderId).update({
        status: 'paid',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentId: paymentData?.cf_payment_id || null,
        paymentMethod: paymentData?.payment_group || null,
      });

      console.log(`[JobPilot] ✅ Pro activated for ${order.userEmail} until ${expiresAt.toISOString()}`);
      return res.status(200).send('OK');
    }

    // Handle failed/cancelled payments
    if (eventType === 'PAYMENT_FAILED_WEBHOOK' || orderData?.order_status === 'EXPIRED') {
      const orderId = orderData?.order_id;
      if (orderId) {
        await db.collection('orders').doc(orderId).update({
          status: orderData?.order_status?.toLowerCase() || 'failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return res.status(200).send('OK');
    }

    // Acknowledge other events
    return res.status(200).send('OK');

  } catch (error) {
    console.error('[JobPilot] Webhook error:', error);
    return res.status(500).send('Internal error');
  }
});

// ============================================================
// FUNCTION 3: Verify Payment Status (manual check)
// Called by extension to verify if a payment went through
// ============================================================
exports.verifyPayment = functions.https.onRequest(async (req, res) => {
  // Handle CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  try {
    // Verify Firebase Auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId' });
    }

    // Check order in Firestore
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(200).json({ status: 'not_found' });
    }

    const order = orderDoc.data();
    if (order.userId !== userId) {
      return res.status(403).json({ error: 'Not your order' });
    }

    // If already paid, return success
    if (order.status === 'paid') {
      return res.status(200).json({ status: 'paid', planId: order.planId });
    }

    // Otherwise, check with Cashfree API
    const response = await fetch(`${CASHFREE_CONFIG.baseUrl}/orders/${orderId}`, {
      headers: {
        'x-client-id': CASHFREE_CONFIG.appId,
        'x-client-secret': CASHFREE_CONFIG.secretKey,
        'x-api-version': '2023-08-01',
      },
    });

    const result = await response.json();

    if (result.order_status === 'PAID') {
      // Activate plan (in case webhook was missed)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + order.period);

      await db.collection('users').doc(userId).update({
        plan: 'pro',
        planExpiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        planActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        planId: order.planId,
      });

      await db.collection('orders').doc(orderId).update({
        status: 'paid',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ status: 'paid', planId: order.planId });
    }

    return res.status(200).json({ status: result.order_status?.toLowerCase() || 'pending' });
  } catch (error) {
    console.error('[JobPilot] Verify payment error:', error);
    return res.status(500).json({ status: 'error', error: error.message });
  }
});

// ============================================================
// HELPER: Verify Cashfree Webhook Signature
// ============================================================
function verifyWebhookSignature(rawBody, signature, timestamp) {
  if (!signature || !timestamp) return false;

  try {
    const secretKey = CASHFREE_CONFIG.secretKey;
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const signedPayload = timestamp + body;
    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(signedPayload)
      .digest('base64');

    return signature === expectedSignature;
  } catch (e) {
    console.error('[JobPilot] Signature verification error:', e);
    return false;
  }
}
