/**
 * Razorpay Payment Integration for JobPilot AI
 *
 * POST /createRazorpaySession - Creates a Razorpay order and returns checkout details
 * POST /handleRazorpayWebhook - Verifies webhook signature, activates Pro plan
 *
 * Environment variables required (in functions/.env):
 *   RAZORPAY_KEY_ID - Razorpay Key ID (starts with rzp_live_ or rzp_test_)
 *   RAZORPAY_KEY_SECRET - Razorpay Key Secret
 *   RAZORPAY_WEBHOOK_SECRET - Webhook secret from Razorpay Dashboard
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const fetch = require('node-fetch');

const db = admin.firestore();

// Razorpay API configuration (reads from functions/.env)
const RAZORPAY_CONFIG = {
  get keyId() { return process.env.RAZORPAY_KEY_ID || ''; },
  get keySecret() { return process.env.RAZORPAY_KEY_SECRET || ''; },
  get webhookSecret() { return process.env.RAZORPAY_WEBHOOK_SECRET || ''; },
  get baseUrl() { return 'https://api.razorpay.com/v1'; },
  get authHeader() {
    return 'Basic ' + Buffer.from(this.keyId + ':' + this.keySecret).toString('base64');
  },
};

// Plan pricing (must match extension and Cashfree pricing)
const PRICING = {
  monthly: { price: 299, period: 30, label: '1 Month' },
  quarterly: { price: 699, period: 90, label: '3 Months' },
  half_yearly: { price: 1499, period: 180, label: '6 Months' },
  yearly: { price: 2999, period: 365, label: '1 Year' },
};

/**
 * Shared helper: Activate Pro plan for a user.
 * Used by both Cashfree and Razorpay webhook handlers.
 */
async function activateProPlan(userId, orderId, paymentId, provider) {
  const orderDoc = await db.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new Error(`Order not found: ${orderId}`);
  }

  const order = orderDoc.data();

  // Idempotency: don't process twice
  if (order.status === 'paid') {
    console.log(`[JobPilot] Order ${orderId} already paid. Skipping duplicate.`);
    return { alreadyProcessed: true };
  }

  // Calculate expiry
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + order.period);

  // Activate plan on user document
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
    paymentId: paymentId || null,
    provider: provider,
  });

  console.log(`[JobPilot] ✅ Pro activated via ${provider} for user ${order.userId} until ${expiresAt.toISOString()}`);
  return { alreadyProcessed: false, expiresAt };
}

// ============================================================
// Create Razorpay Order
// Called by the extension when user selects Razorpay as payment provider
// ============================================================
const createRazorpaySession = functions.https.onRequest(async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify Firebase Auth token
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

    if (!PRICING[planId]) {
      return res.status(400).json({ error: `Invalid plan: ${planId}` });
    }

    const plan = PRICING[planId];
    const receiptId = `order_${userId.substring(0, 8)}_${Date.now()}`;

    // Create Razorpay order via API
    const orderPayload = {
      amount: plan.price * 100, // Razorpay uses paise (1 INR = 100 paise)
      currency: 'INR',
      receipt: receiptId,
      notes: {
        userId: userId,
        planId: planId,
        period: String(plan.period),
        userEmail: userEmail,
      },
    };

    const response = await fetch(`${RAZORPAY_CONFIG.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': RAZORPAY_CONFIG.authHeader,
      },
      body: JSON.stringify(orderPayload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[JobPilot] Razorpay order creation failed:', result);
      return res.status(500).json({ error: 'Payment creation failed', details: result.error?.description });
    }

    // Store order in Firestore
    await db.collection('orders').doc(receiptId).set({
      orderId: receiptId,
      razorpayOrderId: result.id,
      userId,
      userEmail,
      planId,
      amount: plan.price,
      period: plan.period,
      provider: 'razorpay',
      status: 'created',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[JobPilot] Razorpay order created: ${receiptId} (rzp: ${result.id}) for ${userEmail}`);

    // Return order details for the extension to open Razorpay checkout
    // Extension will use Razorpay's standard checkout hosted page
    return res.status(200).json({
      success: true,
      orderId: receiptId,
      razorpayOrderId: result.id,
      razorpayKeyId: RAZORPAY_CONFIG.keyId, // Public key — safe to send to client
      amount: plan.price * 100,
      currency: 'INR',
      name: 'JobPilot AI',
      description: `Pro Plan - ${plan.label}`,
      prefill: {
        email: userEmail,
        name: userName,
      },
    });
  } catch (error) {
    console.error('[JobPilot] Razorpay session error:', error);
    return res.status(500).json({ error: error.message || 'Something went wrong' });
  }
});

// ============================================================
// Razorpay Webhook Handler
// Called by Razorpay when payment status changes
// Configure webhook URL in Razorpay Dashboard → Webhooks
// ============================================================
const handleRazorpayWebhook = functions.https.onRequest(async (req, res) => {
  // Serve Razorpay checkout page (hosted, like Cashfree's)
  if (req.method === 'GET' && req.query.action === 'checkout') {
    const orderId = req.query.orderId;
    const keyId = req.query.keyId;
    const amount = req.query.amount;
    const name = decodeURIComponent(req.query.name || 'JobPilot AI');
    const description = decodeURIComponent(req.query.description || 'Pro Plan');
    const email = decodeURIComponent(req.query.email || '');

    if (!orderId || !keyId) return res.status(400).send('Missing order details');

    return res.status(200).send(`<!DOCTYPE html>
<html>
<head>
  <title>JobPilot AI - Payment</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
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
    <p>Opening payment...</p>
  </div>
  <script>
    var options = {
      key: "${keyId}",
      amount: "${amount}",
      currency: "INR",
      name: "${name}",
      description: "${description}",
      order_id: "${orderId}",
      prefill: { email: "${email}" },
      theme: { color: "#6366f1" },
      handler: function(response) {
        document.querySelector('.container').innerHTML = '<div style="color:#10b981;font-size:48px;">✓</div><h2>Payment Successful!</h2><p>Your Pro plan is being activated. You can close this tab and open the JobPilot extension.</p>';
      },
      modal: {
        ondismiss: function() {
          document.querySelector('p').textContent = 'Payment cancelled. You can close this tab.';
          document.querySelector('.spinner').style.display = 'none';
        }
      }
    };
    var rzp = new Razorpay(options);
    rzp.open();
  </script>
</body>
</html>`);
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    // Verify webhook signature
    const signature = req.headers['x-razorpay-signature'];
    const body = req.rawBody || JSON.stringify(req.body);

    if (!verifyRazorpaySignature(body, signature)) {
      console.error('[JobPilot] Invalid Razorpay webhook signature');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;
    const eventType = event.event;

    console.log(`[JobPilot] Razorpay webhook: ${eventType}`);

    // Handle successful payment
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const payment = event.payload?.payment?.entity;
      const order = event.payload?.order?.entity;

      if (!payment && !order) {
        return res.status(400).send('Missing payment/order data');
      }

      // Extract order details
      const razorpayOrderId = payment?.order_id || order?.id;
      const paymentId = payment?.id || null;
      const notes = payment?.notes || order?.notes || {};
      const receiptId = order?.receipt || notes.receipt;

      // Find our order by razorpayOrderId
      let ourOrderId = receiptId;
      if (!ourOrderId) {
        // Fallback: query Firestore by razorpayOrderId
        const snapshot = await db.collection('orders')
          .where('razorpayOrderId', '==', razorpayOrderId)
          .limit(1)
          .get();

        if (snapshot.empty) {
          console.error(`[JobPilot] No matching order for Razorpay order: ${razorpayOrderId}`);
          return res.status(404).send('Order not found');
        }
        ourOrderId = snapshot.docs[0].id;
      }

      // Activate plan
      await activateProPlan(notes.userId || '', ourOrderId, paymentId, 'razorpay');

      return res.status(200).send('OK');
    }

    // Handle failed payment
    if (eventType === 'payment.failed') {
      const payment = event.payload?.payment?.entity;
      const notes = payment?.notes || {};
      const razorpayOrderId = payment?.order_id;

      if (razorpayOrderId) {
        const snapshot = await db.collection('orders')
          .where('razorpayOrderId', '==', razorpayOrderId)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          await snapshot.docs[0].ref.update({
            status: 'failed',
            failureReason: payment?.error_description || 'Payment failed',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
      return res.status(200).send('OK');
    }

    // Acknowledge other events
    return res.status(200).send('OK');

  } catch (error) {
    console.error('[JobPilot] Razorpay webhook error:', error);
    return res.status(500).send('Internal error');
  }
});

/**
 * Verify Razorpay webhook signature using HMAC SHA256.
 */
function verifyRazorpaySignature(body, signature) {
  if (!signature || !RAZORPAY_CONFIG.webhookSecret) return false;

  try {
    const bodyStr = typeof body === 'string' ? body : body.toString('utf8');
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_CONFIG.webhookSecret)
      .update(bodyStr)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (e) {
    console.error('[JobPilot] Razorpay signature verification error:', e);
    return false;
  }
}

module.exports = {
  createRazorpaySession,
  handleRazorpayWebhook,
  activateProPlan,
};
