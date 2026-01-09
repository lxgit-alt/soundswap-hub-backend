import express from 'express';
import crypto from 'crypto';
import { Webhook } from 'standardwebhooks';

const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Webhook Handler Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;
let db = null;

// ==================== LAZY LOAD HELPER ====================

const loadFirebaseModules = async () => {
  if (!isFirebaseLoaded) {
    console.log('[INFO] 🔥 Firebase: Lazy loading modules');
    
    try {
      // Dynamic import of firebase-admin (lazy loading)
      const adminModule = await import('firebase-admin');
      const admin = adminModule.default;
      
      if (admin.apps.length > 0) {
        db = admin.firestore();
        db.settings({ ignoreUndefinedProperties: true });
        console.log('[INFO] 🔥 Firebase: Using existing Firebase Admin instance');
      } else {
        // Initialize Firebase if not already initialized
        console.log('[INFO] 🔥 Firebase: Initializing Firebase Admin');
        const serviceAccount = {
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        };
        
        if (serviceAccount.projectId && serviceAccount.clientEmail && serviceAccount.privateKey) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
          });
          db = admin.firestore();
          db.settings({ ignoreUndefinedProperties: true });
          console.log('[INFO] 🔥 Firebase: Initialized successfully');
        } else {
          console.error('[ERROR] ❌ Firebase credentials incomplete');
          db = null;
        }
      }
      
      isFirebaseLoaded = true;
      console.log('[INFO] 🔥 Firebase: Modules loaded successfully');
    } catch (error) {
      console.error('[ERROR] ❌ Failed to load Firebase:', error.message);
      db = null;
      isFirebaseLoaded = true; // Mark as loaded to prevent repeated attempts
    }
  }
  return db;
};

// ==================== CREDIT MAPPING FUNCTIONS ====================

function getCreditsForVariant(productId) {
  // Map your Dodo Product IDs to credit amounts
  const creditMap = {
    // Cover Art Packs
    'prod_starter': 10,     // Starter Pack - 10 credits
    'prod_creator': 25,     // Creator Pack - 25 credits
    'prod_pro': 100,        // Professional Pack - 100 credits
    
    // Lyric Video Packs
    'video_30s': 1,         // Single 30s video = 1 credit
    'video_3pack_30s': 3,   // 3-pack 30s videos = 3 credits
    'video_full': 2,        // Full video = 2 credits
    'video_3pack_full': 6,  // 3-pack full videos = 6 credits
    'video_10pack_full': 20, // 10-pack full videos = 20 credits
    
    // Subscription Plans (monthly)
    'sub_basic_monthly': 10,    // Basic Monthly - 10 cover art credits/month
    'sub_creator_monthly': 25,  // Creator Monthly - 25 cover art credits/month
    'sub_pro_monthly': 100,     // Pro Monthly - 100 cover art credits/month
    
    // Add more product IDs as needed
    'price_1': 10,  // Example Stripe price ID format
    'price_2': 25,
    'price_3': 100,
  };
  
  // Fallback: check if productId contains keywords
  if (!creditMap[productId]) {
    if (productId.includes('starter') || productId.includes('basic')) {
      return 10;
    } else if (productId.includes('creator') || productId.includes('pro')) {
      return 25;
    } else if (productId.includes('enterprise') || productId.includes('ultimate')) {
      return 100;
    }
  }
  
  return creditMap[productId] || 0;
}

// ==================== CREDIT MANAGEMENT FUNCTIONS ====================

const addCreditsToUser = async function(email, coverArtCredits, lyricVideoCredits, orderId, userIdFromMeta) {
  try {
    if (!db) {
      await loadFirebaseModules();
      if (!db) {
        console.error('[ERROR] ❌ Firebase not available for adding credits');
        return;
      }
    }

    let userDocId = userIdFromMeta;
    let userEmail = email;

    // Collections
    const USERS_COLLECTION = 'users';
    const CREDIT_TRANSACTIONS_COLLECTION = 'credit_transactions';
    const PURCHASES_COLLECTION = 'purchases';
    const PENDING_CREDIT_TRANSACTIONS_COLLECTION = 'pending_credit_transactions';

    if (!userDocId) {
      const usersRef = db.collection(USERS_COLLECTION);
      const querySnapshot = await usersRef.where('email', '==', email.toLowerCase()).get();
      
      if (querySnapshot.empty) {
        console.warn(`[WARN] ⚠️ User not found for email: ${email}, creating transaction record only`);
        
        const transactionRef = db.collection(PENDING_CREDIT_TRANSACTIONS_COLLECTION).doc();
        await transactionRef.set({
          email: email.toLowerCase(),
          orderId,
          coverArtCredits,
          lyricVideoCredits,
          totalCredits: coverArtCredits + lyricVideoCredits,
          status: 'pending_user_creation',
          date: new Date().toISOString(),
          type: 'purchase',
          timestamp: Date.now()
        });
        
        console.log(`[INFO] 📝 Created pending transaction for email: ${email}`);
        return;
      }
      userDocId = querySnapshot.docs[0].id;
      userEmail = querySnapshot.docs[0].data().email || email;
    }
    
    const userRef = db.collection(USERS_COLLECTION).doc(userDocId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.warn(`[WARN] ⚠️ User document not found: ${userDocId}`);
      return;
    }
    
    const userData = userDoc.data();
    
    // Prepare update data
    const updateData = {
      updatedAt: new Date().toISOString(),
      lastTransaction: {
        orderId,
        creditsAdded: coverArtCredits + lyricVideoCredits,
        date: new Date().toISOString(),
        type: 'purchase'
      }
    };
    
    // Get current values
    const currentPoints = userData.points || 0;
    const currentLyricVideoCredits = userData.lyricVideoCredits || 0;
    
    // Update credits
    if (coverArtCredits > 0) {
      updateData.points = currentPoints + coverArtCredits;
      updateData.totalCreditsEarned = (userData.totalCreditsEarned || 0) + coverArtCredits;
    }
    
    if (lyricVideoCredits > 0) {
      updateData.lyricVideoCredits = currentLyricVideoCredits + lyricVideoCredits;
      updateData.totalLyricVideoCredits = (userData.totalLyricVideoCredits || 0) + lyricVideoCredits;
    }
    
    await userRef.update(updateData);
    
    // Create transaction records
    if (coverArtCredits > 0) {
      const transactionRef = db.collection(CREDIT_TRANSACTIONS_COLLECTION).doc();
      await transactionRef.set({
        userId: userDocId,
        userEmail: userEmail.toLowerCase(),
        orderId,
        type: 'purchase',
        creditType: 'coverArt',
        amount: coverArtCredits,
        status: 'completed',
        date: new Date().toISOString(),
        timestamp: Date.now()
      });
    }
    
    if (lyricVideoCredits > 0) {
      const transactionRef = db.collection(CREDIT_TRANSACTIONS_COLLECTION).doc();
      await transactionRef.set({
        userId: userDocId,
        userEmail: userEmail.toLowerCase(),
        orderId,
        type: 'purchase',
        creditType: 'lyricVideo',
        amount: lyricVideoCredits,
        status: 'completed',
        date: new Date().toISOString(),
        timestamp: Date.now()
      });
    }
    
    // Create purchase record
    const purchaseRef = db.collection(PURCHASES_COLLECTION).doc();
    await purchaseRef.set({
      userId: userDocId,
      userEmail: userEmail.toLowerCase(),
      orderId,
      coverArtCredits,
      lyricVideoCredits,
      totalCredits: coverArtCredits + lyricVideoCredits,
      date: new Date().toISOString(),
      status: 'completed',
      type: 'one_time'
    });
    
    console.log(`[INFO] ✅ Added credits to user ${userDocId} (${userEmail}) - Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}`);
  } catch (error) {
    console.error('[ERROR] ❌ Error adding credits:', error.message);
  }
};

const updateUserSubscription = async function(email, productId, coverArtCredits, lyricVideoCredits, subscriptionId, userIdFromMeta) {
  try {
    if (!db) {
      await loadFirebaseModules();
      if (!db) {
        console.error('[ERROR] ❌ Firebase not available for updating subscription');
        return;
      }
    }

    let userDocId = userIdFromMeta;
    let userEmail = email;

    const USERS_COLLECTION = 'users';
    const SUBSCRIPTION_TRANSACTIONS_COLLECTION = 'subscription_transactions';
    const PENDING_SUBSCRIPTIONS_COLLECTION = 'pending_subscriptions';

    if (!userDocId) {
      const usersRef = db.collection(USERS_COLLECTION);
      const querySnapshot = await usersRef.where('email', '==', email.toLowerCase()).get();
      
      if (querySnapshot.empty) {
        console.warn(`[WARN] ⚠️ User not found for subscription: ${email}`);
        
        const pendingRef = db.collection(PENDING_SUBSCRIPTIONS_COLLECTION).doc();
        await pendingRef.set({
          email: email.toLowerCase(),
          subscriptionId,
          productId,
          coverArtCredits,
          lyricVideoCredits,
          status: 'pending_user_creation',
          date: new Date().toISOString(),
          timestamp: Date.now()
        });
        
        return;
      }
      userDocId = querySnapshot.docs[0].id;
      userEmail = querySnapshot.docs[0].data().email || email;
    }
    
    const userRef = db.collection(USERS_COLLECTION).doc(userDocId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.warn(`[WARN] ⚠️ User document not found: ${userDocId}`);
      return;
    }
    
    const userData = userDoc.data();
    
    const updateData = {
      subscriptionVariant: productId,
      subscriptionId,
      subscriptionStatus: 'active',
      subscriptionUpdatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (coverArtCredits > 0) {
      updateData.monthlyCoverArtCredits = coverArtCredits;
      updateData.points = (userData.points || 0) + coverArtCredits;
      updateData.totalCreditsEarned = (userData.totalCreditsEarned || 0) + coverArtCredits;
    }
    
    if (lyricVideoCredits > 0) {
      updateData.monthlyLyricVideoCredits = lyricVideoCredits;
      updateData.lyricVideoCredits = (userData.lyricVideoCredits || 0) + lyricVideoCredits;
      updateData.totalLyricVideoCredits = (userData.totalLyricVideoCredits || 0) + lyricVideoCredits;
    }
    
    await userRef.update(updateData);
    
    const transactionRef = db.collection(SUBSCRIPTION_TRANSACTIONS_COLLECTION).doc();
    await transactionRef.set({
      userId: userDocId,
      userEmail: userEmail.toLowerCase(),
      subscriptionId,
      productId,
      coverArtCredits,
      lyricVideoCredits,
      date: new Date().toISOString(),
      type: 'subscription_renewal',
      status: 'completed',
      timestamp: Date.now()
    });
    
    console.log(`[INFO] ✅ Updated subscription for user ${userDocId} (${userEmail}) - Product: ${productId}, Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}`);
  } catch (error) {
    console.error('[ERROR] ❌ Error updating subscription:', error.message);
  }
};

// ==================== EVENT HANDLERS ====================

const handlePaymentSucceeded = async function(data) {
  const transactionId = data.transaction_id;
  const customerEmail = data.customer?.email;
  const customerId = data.customer?.id;
  const userId = data.metadata?.user_id; 
  const amount = data.amount / 100; // Convert from cents to dollars
  
  console.log(`[INFO] 💰 Payment succeeded - Transaction: ${transactionId}, Amount: $${amount}, Email: ${customerEmail}, Customer ID: ${customerId}, UserID: ${userId || 'not provided'}`);
  
  const items = data.product_cart || [];
  let totalCredits = 0;
  let coverArtCredits = 0;
  let lyricVideoCredits = 0;

  for (const item of items) {
    const productId = item.product_id;
    const quantity = item.quantity || 1;
    const credits = getCreditsForVariant(productId);
    
    if (productId.startsWith('prod_') || productId.includes('cover') || productId.includes('art')) {
      coverArtCredits += credits * quantity;
    } else if (productId.includes('video')) {
      lyricVideoCredits += credits * quantity;
    }
    
    totalCredits += credits * quantity;
    
    console.log(`[INFO] 📦 Cart item - Product: ${productId}, Quantity: ${quantity}, Credits: ${credits * quantity}`);
  }

  console.log(`[INFO] 💰 Total credits breakdown - Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}, Total: ${totalCredits}`);

  if (customerEmail && totalCredits > 0) {
    await addCreditsToUser(customerEmail, coverArtCredits, lyricVideoCredits, transactionId, userId);
  } else {
    console.warn(`[WARN] ⚠️ No email or zero credits - Email: ${customerEmail}, Credits: ${totalCredits}`);
  }
};

const handleSubscriptionEvent = async function(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  const customerId = data.customer?.id;
  const status = data.status;
  const productId = data.product_id;
  const userId = data.metadata?.user_id;
  
  console.log(`[INFO] 📅 Subscription event - ID: ${subscriptionId}, Status: ${status}, Product: ${productId}, Customer: ${customerEmail} (${customerId})`);

  if (status === 'active' || status === 'renewed') {
    const monthlyCredits = getCreditsForVariant(productId);
    let coverArtCredits = 0;
    let lyricVideoCredits = 0;
    
    if (productId.startsWith('prod_') || productId.includes('cover') || productId.includes('art')) {
      coverArtCredits = monthlyCredits;
    } else if (productId.includes('video')) {
      lyricVideoCredits = monthlyCredits;
    }
    
    if (customerEmail && monthlyCredits > 0) {
      await updateUserSubscription(customerEmail, productId, coverArtCredits, lyricVideoCredits, subscriptionId, userId);
    }
  }
};

const handleSubscriptionCancelled = async function(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  const userId = data.metadata?.user_id;
  
  console.log(`[INFO] 📅 Subscription cancelled - ID: ${subscriptionId}, Email: ${customerEmail}`);
  
  try {
    if (!db) {
      await loadFirebaseModules();
      if (!db) {
        console.error('[ERROR] ❌ Firebase not available for subscription cancellation');
        return;
      }
    }

    const USERS_COLLECTION = 'users';
    let userDocId = userId;
    
    if (!userDocId && customerEmail) {
      const usersRef = db.collection(USERS_COLLECTION);
      const querySnapshot = await usersRef.where('email', '==', customerEmail.toLowerCase()).get();
      
      if (!querySnapshot.empty) {
        userDocId = querySnapshot.docs[0].id;
      }
    }
    
    if (userDocId) {
      const userRef = db.collection(USERS_COLLECTION).doc(userDocId);
      await userRef.update({
        subscriptionStatus: 'cancelled',
        subscriptionUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      console.log(`[INFO] ✅ Updated subscription status to cancelled for user ${userDocId}`);
    }
  } catch (error) {
    console.error('[ERROR] ❌ Error handling subscription cancellation:', error.message);
  }
};

const handlePaymentFailed = async function(data) {
  const transactionId = data.transaction_id;
  const customerEmail = data.customer?.email;
  
  console.log(`[ERROR] ❌ Payment failed - Transaction: ${transactionId}, Email: ${customerEmail}`);
  
  try {
    if (!db) {
      await loadFirebaseModules();
      if (!db) {
        console.error('[ERROR] ❌ Firebase not available for recording failed payment');
        return;
      }
    }
    
    const failedRef = db.collection('failed_payments').doc();
    await failedRef.set({
      transactionId,
      customerEmail,
      amount: data.amount / 100,
      reason: data.failure_reason || 'unknown',
      date: new Date().toISOString(),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error recording failed payment:', error.message);
  }
};

const handleSubscriptionPaymentFailed = async function(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  
  console.log(`[ERROR] ❌ Subscription payment failed - ID: ${subscriptionId}, Email: ${customerEmail}`);
  
  try {
    if (!db) {
      await loadFirebaseModules();
      if (!db) {
        console.error('[ERROR] ❌ Firebase not available for recording failed subscription payment');
        return;
      }
    }
    
    const failedRef = db.collection('failed_subscription_payments').doc();
    await failedRef.set({
      subscriptionId,
      customerEmail,
      date: new Date().toISOString(),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error recording failed subscription payment:', error.message);
  }
};

// ==================== WEBHOOK ENDPOINT ====================

// Middleware to get raw body for signature verification
const rawBodyMiddleware = (req, res, next) => {
  console.log('[INFO] 🔄 Raw body middleware processing');
  req.rawBody = '';
  
  // Set encoding for text data
  req.setEncoding('utf8');

  // Timeout to prevent hanging
  const bodyTimeout = setTimeout(() => {
    console.error('[ERROR] ❌ Raw body reading timeout after 5 seconds');
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request body timeout' });
    }
  }, 5000);

  const cleanup = () => clearTimeout(bodyTimeout);

  // Handle incoming data chunks
  req.on('data', (chunk) => {
    if (chunk) {
      req.rawBody += chunk;
    }
  });

  // Handle normal request end
  req.on('end', () => {
    cleanup();
    console.log(`[INFO] 📦 Raw body received, length: ${req.rawBody?.length || 0}`);
    next();
  });

  // Handle errors during body reading
  req.on('error', (error) => {
    cleanup();
    console.error('[ERROR] ❌ Error reading request body:', error.message);
    if (!res.headersSent) {
      res.status(400).json({ error: 'Invalid request body' });
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    cleanup();
  });

  // Handle response close (abort)
  res.on('close', () => {
    cleanup();
  });
};

// Apply middleware to webhook endpoint
router.post('/', rawBodyMiddleware, async (req, res) => {
  // Signal that payments processing is active to suppress other modules
  try { process.__payments_running = true; } catch (e) { /* no-op */ }
  // Set a timeout for the entire request
  const requestTimeout = setTimeout(() => {
    console.error('[ERROR] ⏰ Request timeout after 9 seconds');
    if (!res.headersSent) {
      res.status(504).json({ 
        success: false, 
        error: 'Request timeout',
        message: 'Processing took too long',
        timestamp: new Date().toISOString()
      });
    }
  }, 9000); // 9 seconds timeout

  try {
    console.log('[INFO] 🔄 Payment webhook received');
    
    // 1. Get raw body for signature verification
    const rawBody = req.rawBody;
    
    if (!rawBody || rawBody.length === 0) {
      console.error('[ERROR] ❌ Empty request body');
      clearTimeout(requestTimeout);
      return res.status(400).json({ error: 'Empty request body' });
    }

    // 2. Verify Dodo Payments Webhook Signature using Standard Webhooks spec
    // Support either environment variable name used in different deployments
    const secret = process.env.DODO_PAYMENTS_WEBHOOK_SECRET || process.env.DODO_PAYMENTS_WEBHOOK_KEY;

    if (!secret) {
      console.error('[ERROR] ❌ DODO_PAYMENTS_WEBHOOK_SECRET / DODO_PAYMENTS_WEBHOOK_KEY not set');
      clearTimeout(requestTimeout);
      return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
      const webhook = new Webhook(secret);
      
      // Extract webhook headers required for verification
      const webhookHeaders = {
        'webhook-id': req.headers['webhook-id'] || '',
        'webhook-signature': req.headers['webhook-signature'] || '',
        'webhook-timestamp': req.headers['webhook-timestamp'] || '',
      };

      // Verify using the standardwebhooks library (follows Standard Webhooks spec exactly)
      await webhook.verify(rawBody, webhookHeaders);
      
      console.log('[INFO] ✅ Signature verified successfully using Standard Webhooks spec');
    } catch (verifyError) {
      console.error('[ERROR] ❌ Signature verification failed:', verifyError.message);
      clearTimeout(requestTimeout);
      return res.status(401).json({ 
        error: 'Invalid signature', 
        details: verifyError.message 
      });
    }

    // 3. Parse the event data
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('[ERROR] ❌ Failed to parse webhook body:', parseError.message);
      clearTimeout(requestTimeout);
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    const eventType = event.type;
    console.log(`[INFO] 🔄 Dodo webhook event: ${eventType}`);

    // 4. Process event and respond immediately
    const processEvent = async () => {
      try {
        switch (eventType) {
          case 'payment.succeeded':
            await handlePaymentSucceeded(event.data);
            break;
          
          case 'subscription.created':
          case 'subscription.renewed':
            await handleSubscriptionEvent(event.data);
            break;
          
          case 'subscription.cancelled':
            console.log(`[INFO] 📅 Subscription cancelled: ${event.data.subscription_id}`);
            await handleSubscriptionCancelled(event.data);
            break;
          
          case 'payment.failed':
            console.log(`[ERROR] ❌ Payment failed: ${event.data.transaction_id}`);
            await handlePaymentFailed(event.data);
            break;
          
          case 'subscription.payment_failed':
            console.log(`[ERROR] ❌ Subscription payment failed: ${event.data.subscription_id}`);
            await handleSubscriptionPaymentFailed(event.data);
            break;
          
          default:
            console.log(`[INFO] ℹ️ Unhandled webhook event: ${eventType}`);
        }
      } catch (error) {
        console.error(`[ERROR] ❌ Error processing event ${eventType}:`, error.message);
      }
    };

    // Send response immediately, then process event asynchronously
    clearTimeout(requestTimeout);
    res.status(200).json({ 
      success: true, 
      received: true,
      eventType,
      message: 'Webhook received and processing started',
      timestamp: new Date().toISOString()
    });

    // Process event after responding (non-blocking)
    processEvent().catch(error => {
      console.error('[ERROR] ❌ Background processing error:', error.message);
    });

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error('[ERROR] ❌ Webhook error:', error.message);
    res.status(500).json({ 
      error: error.message,
      success: false,
      details: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  } finally {
    try { process.__payments_running = false; } catch (e) { /* no-op */ }
  }
});

// ==================== TEST ENDPOINTS ====================

// Test endpoint to verify webhook is working - NO FIREBASE LOADING
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Dodo Payments Webhook endpoint is working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    firebase: isFirebaseLoaded ? 'loaded' : 'not loaded',
    dodoKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'missing',
    lazy_loading: 'ENABLED - Firebase loads on first webhook',
    note: 'Firebase modules are lazily loaded to improve performance'
  });
});

// Get webhook status and configuration - NO FIREBASE LOADING
router.get('/status', (req, res) => {
  res.json({
    success: true,
    service: 'dodo-payments-webhook',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    configuration: {
      firebase: isFirebaseLoaded ? 'loaded' : 'not loaded',
      dodoWebhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'missing',
      firebaseProject: process.env.FIREBASE_PROJECT_ID || 'not set',
      environment: process.env.NODE_ENV || 'development',
      lazy_loading: 'ENABLED'
    },
    endpoints: {
      POST: '/api/lemon-webhook - Main webhook endpoint',
      GET: '/api/lemon-webhook/test - Test endpoint',
      GET: '/api/lemon-webhook/status - Get status info'
    },
    handledEvents: [
      'payment.succeeded',
      'subscription.created',
      'subscription.renewed',
      'subscription.cancelled',
      'payment.failed',
      'subscription.payment_failed'
    ],
    performance: {
      timeout_protection: 'ENABLED (9s timeout)',
      async_processing: 'ENABLED (responds immediately)',
      module_loading: 'LAZY (Firebase loads on demand)'
    }
  });
});

// Simple simulation endpoint - NO FIREBASE LOADING
router.post('/simulate', async (req, res) => {
  try {
    const { eventType } = req.body;
    
    if (!eventType) {
      return res.status(400).json({
        success: false,
        message: 'eventType is required'
      });
    }
    
    console.log(`[INFO] 🔄 Simulating webhook event: ${eventType}`);
    
    res.json({
      success: true,
      message: `Simulated ${eventType} event - Note: No actual Firebase operations in simulation`,
      eventType,
      timestamp: new Date().toISOString(),
      note: 'Firebase operations would run if this were a real webhook'
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error in simulation:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;