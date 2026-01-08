// lemon-webhook.js - Dodo Payments Webhook Handler
import express from 'express';

const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Webhook Handler Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;

// Lazy loaded dependencies
let crypto = null;
let initializeApp = null;
let getFirestore = null;
let collection = null;
let doc = null;
let updateDoc = null;
let increment = null;
let query = null;
let where = null;
let getDocs = null;
let serverTimestamp = null;
let setDoc = null;

// Lazy loaded instances
let db = null;

// Collections (strings only - no imports needed)
const PENDING_CREDIT_TRANSACTIONS_COLLECTION = 'pending_credit_transactions';
const CREDIT_TRANSACTIONS_COLLECTION = 'credit_transactions';
const PURCHASES_COLLECTION = 'purchases';
const SUBSCRIPTION_TRANSACTIONS_COLLECTION = 'subscription_transactions';
const PENDING_SUBSCRIPTIONS_COLLECTION = 'pending_subscriptions';
const USERS_COLLECTION = 'users';

// ==================== LAZY LOAD HELPER ====================

const loadFirebaseModules = async () => {
  if (!isFirebaseLoaded) {
    console.log('[INFO] 🔥 Firebase: Lazy loading modules');
    
    // Dynamically import dependencies
    crypto = (await import('crypto')).default;
    
    const firebaseAppModule = await import('firebase/app');
    const firestoreModule = await import('firebase/firestore');
    
    initializeApp = firebaseAppModule.initializeApp;
    getFirestore = firestoreModule.getFirestore;
    collection = firestoreModule.collection;
    doc = firestoreModule.doc;
    updateDoc = firestoreModule.updateDoc;
    increment = firestoreModule.increment;
    query = firestoreModule.query;
    where = firestoreModule.where;
    getDocs = firestoreModule.getDocs;
    serverTimestamp = firestoreModule.serverTimestamp;
    setDoc = firestoreModule.setDoc;
    
    // Initialize Firebase
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID
    };
    
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    
    isFirebaseLoaded = true;
    console.log('[INFO] 🔥 Firebase: Modules loaded successfully');
  }
  return db;
};

const isFirebaseAvailable = () => {
  return !!db;
};

// ==================== CREDIT MAPPING FUNCTIONS ====================
// These don't need Firebase yet

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
// These will be defined after Firebase loads

let addCreditsToUser = null;
let updateUserSubscription = null;
let handlePaymentSucceeded = null;
let handleSubscriptionEvent = null;
let handleSubscriptionCancelled = null;
let handlePaymentFailed = null;
let handleSubscriptionPaymentFailed = null;

const defineEventHandlers = () => {
  // Define event handlers that use Firebase
  handlePaymentSucceeded = async function(data) {
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

  handleSubscriptionEvent = async function(data) {
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

  handleSubscriptionCancelled = async function(data) {
    const subscriptionId = data.subscription_id;
    const customerEmail = data.customer?.email;
    const userId = data.metadata?.user_id;
    
    console.log(`[INFO] 📅 Subscription cancelled - ID: ${subscriptionId}, Email: ${customerEmail}`);
    
    try {
      let userDocId = userId;
      
      if (!userDocId && customerEmail) {
        const usersRef = collection(db, USERS_COLLECTION);
        const q = query(usersRef, where('email', '==', customerEmail.toLowerCase()));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          userDocId = querySnapshot.docs[0].id;
        }
      }
      
      if (userDocId) {
        const userRef = doc(db, USERS_COLLECTION, userDocId);
        await updateDoc(userRef, {
          subscriptionStatus: 'cancelled',
          subscriptionUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        
        console.log(`[INFO] ✅ Updated subscription status to cancelled for user ${userDocId}`);
      }
    } catch (error) {
      console.error('[ERROR] ❌ Error handling subscription cancellation:', error.message);
    }
  };

  handlePaymentFailed = async function(data) {
    const transactionId = data.transaction_id;
    const customerEmail = data.customer?.email;
    
    console.log(`[ERROR] ❌ Payment failed - Transaction: ${transactionId}, Email: ${customerEmail}`);
    
    try {
      const failedRef = doc(collection(db, 'failed_payments'));
      await setDoc(failedRef, {
        transactionId,
        customerEmail,
        amount: data.amount / 100,
        reason: data.failure_reason || 'unknown',
        date: serverTimestamp(),
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[ERROR] ❌ Error recording failed payment:', error.message);
    }
  };

  handleSubscriptionPaymentFailed = async function(data) {
    const subscriptionId = data.subscription_id;
    const customerEmail = data.customer?.email;
    
    console.log(`[ERROR] ❌ Subscription payment failed - ID: ${subscriptionId}, Email: ${customerEmail}`);
    
    try {
      const failedRef = doc(collection(db, 'failed_subscription_payments'));
      await setDoc(failedRef, {
        subscriptionId,
        customerEmail,
        date: serverTimestamp(),
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[ERROR] ❌ Error recording failed subscription payment:', error.message);
    }
  };

  addCreditsToUser = async function(email, coverArtCredits, lyricVideoCredits, orderId, userIdFromMeta) {
    try {
      if (!isFirebaseAvailable()) {
        console.error('[ERROR] ❌ Firebase not available for adding credits');
        return;
      }

      let userDocId = userIdFromMeta;
      let userEmail = email;

      if (!userDocId) {
        const usersRef = collection(db, USERS_COLLECTION);
        const q = query(usersRef, where('email', '==', email.toLowerCase()));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
          console.warn(`[WARN] ⚠️ User not found for email: ${email}, creating transaction record only`);
          
          const transactionRef = doc(collection(db, PENDING_CREDIT_TRANSACTIONS_COLLECTION));
          await setDoc(transactionRef, {
            email: email.toLowerCase(),
            orderId,
            coverArtCredits,
            lyricVideoCredits,
            totalCredits: coverArtCredits + lyricVideoCredits,
            status: 'pending_user_creation',
            date: serverTimestamp(),
            type: 'purchase',
            timestamp: Date.now()
          });
          
          console.log(`[INFO] 📝 Created pending transaction for email: ${email}`);
          return;
        }
        userDocId = querySnapshot.docs[0].id;
        userEmail = querySnapshot.docs[0].data().email || email;
      }
      
      const userRef = doc(db, USERS_COLLECTION, userDocId);
      
      const updateData = {
        updatedAt: serverTimestamp(),
        lastTransaction: {
          orderId,
          creditsAdded: coverArtCredits + lyricVideoCredits,
          date: serverTimestamp(),
          type: 'purchase'
        }
      };
      
      if (coverArtCredits > 0) {
        updateData.points = increment(coverArtCredits);
        updateData.totalCreditsEarned = increment(coverArtCredits);
      }
      
      if (lyricVideoCredits > 0) {
        updateData.lyricVideoCredits = increment(lyricVideoCredits);
        updateData.totalLyricVideoCredits = increment(lyricVideoCredits);
      }
      
      await updateDoc(userRef, updateData);
      
      if (coverArtCredits > 0) {
        const transactionRef = doc(collection(db, CREDIT_TRANSACTIONS_COLLECTION));
        await setDoc(transactionRef, {
          userId: userDocId,
          userEmail: userEmail.toLowerCase(),
          orderId,
          type: 'purchase',
          creditType: 'coverArt',
          amount: coverArtCredits,
          status: 'completed',
          date: serverTimestamp(),
          timestamp: Date.now()
        });
      }
      
      if (lyricVideoCredits > 0) {
        const transactionRef = doc(collection(db, CREDIT_TRANSACTIONS_COLLECTION));
        await setDoc(transactionRef, {
          userId: userDocId,
          userEmail: userEmail.toLowerCase(),
          orderId,
          type: 'purchase',
          creditType: 'lyricVideo',
          amount: lyricVideoCredits,
          status: 'completed',
          date: serverTimestamp(),
          timestamp: Date.now()
        });
      }
      
      const purchaseRef = doc(collection(db, PURCHASES_COLLECTION));
      await setDoc(purchaseRef, {
        userId: userDocId,
        userEmail: userEmail.toLowerCase(),
        orderId,
        coverArtCredits,
        lyricVideoCredits,
        totalCredits: coverArtCredits + lyricVideoCredits,
        date: serverTimestamp(),
        status: 'completed',
        type: 'one_time'
      });
      
      console.log(`[INFO] ✅ Added credits to user ${userDocId} (${userEmail}) - Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}`);
    } catch (error) {
      console.error('[ERROR] ❌ Error adding credits:', error.message);
    }
  };

  updateUserSubscription = async function(email, productId, coverArtCredits, lyricVideoCredits, subscriptionId, userIdFromMeta) {
    try {
      if (!isFirebaseAvailable()) {
        console.error('[ERROR] ❌ Firebase not available for updating subscription');
        return;
      }

      let userDocId = userIdFromMeta;
      let userEmail = email;

      if (!userDocId) {
        const usersRef = collection(db, USERS_COLLECTION);
        const q = query(usersRef, where('email', '==', email.toLowerCase()));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
          console.warn(`[WARN] ⚠️ User not found for subscription: ${email}`);
          
          const pendingRef = doc(collection(db, PENDING_SUBSCRIPTIONS_COLLECTION));
          await setDoc(pendingRef, {
            email: email.toLowerCase(),
            subscriptionId,
            productId,
            coverArtCredits,
            lyricVideoCredits,
            status: 'pending_user_creation',
            date: serverTimestamp(),
            timestamp: Date.now()
          });
          
          return;
        }
        userDocId = querySnapshot.docs[0].id;
        userEmail = querySnapshot.docs[0].data().email || email;
      }
      
      const userRef = doc(db, USERS_COLLECTION, userDocId);
      
      const updateData = {
        subscriptionVariant: productId,
        subscriptionId,
        subscriptionStatus: 'active',
        subscriptionUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      if (coverArtCredits > 0) {
        updateData.monthlyCoverArtCredits = coverArtCredits;
        updateData.points = increment(coverArtCredits);
        updateData.totalCreditsEarned = increment(coverArtCredits);
      }
      
      if (lyricVideoCredits > 0) {
        updateData.monthlyLyricVideoCredits = lyricVideoCredits;
        updateData.lyricVideoCredits = increment(lyricVideoCredits);
        updateData.totalLyricVideoCredits = increment(lyricVideoCredits);
      }
      
      await updateDoc(userRef, updateData);
      
      const transactionRef = doc(collection(db, SUBSCRIPTION_TRANSACTIONS_COLLECTION));
      await setDoc(transactionRef, {
        userId: userDocId,
        userEmail: userEmail.toLowerCase(),
        subscriptionId,
        productId,
        coverArtCredits,
        lyricVideoCredits,
        date: serverTimestamp(),
        type: 'subscription_renewal',
        status: 'completed',
        timestamp: Date.now()
      });
      
      console.log(`[INFO] ✅ Updated subscription for user ${userDocId} (${userEmail}) - Product: ${productId}, Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}`);
    } catch (error) {
      console.error('[ERROR] ❌ Error updating subscription:', error.message);
    }
  };
};

// ==================== WEBHOOK ENDPOINT ====================

// Middleware to get raw body for signature verification
const rawBodyMiddleware = (req, res, next) => {
  console.log('[INFO] 🔄 Raw body middleware processing');
  req.rawBody = '';
  req.setEncoding('utf8');

  req.on('data', (chunk) => {
    req.rawBody += chunk;
  });

  req.on('end', () => {
    console.log(`[INFO] 📦 Raw body received, length: ${req.rawBody?.length || 0}`);
    next();
  });
};

// Apply middleware to webhook endpoint
router.post('/', rawBodyMiddleware, async (req, res) => {
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

    // 2. Verify Dodo Payments Webhook Signature
    const webhookId = req.headers['webhook-id'];
    const webhookTimestamp = req.headers['webhook-timestamp'];
    const webhookSignature = req.headers['webhook-signature'];
    const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;

    if (!secret) {
      console.error('[ERROR] ❌ DODO_PAYMENTS_WEBHOOK_KEY not set');
      clearTimeout(requestTimeout);
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      console.error('[ERROR] ❌ Missing webhook headers');
      clearTimeout(requestTimeout);
      return res.status(401).json({ error: 'Missing webhook headers' });
    }

    if (!webhookSignature.startsWith('v1,')) {
      console.error('[ERROR] ❌ Invalid signature format');
      clearTimeout(requestTimeout);
      return res.status(401).json({ error: 'Invalid signature format' });
    }

    // Extract just the signature part
    const signatureParts = webhookSignature.split(',');
    const signature = signatureParts[1];

    // Build the signed content
    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;

    // Compute the expected signature
    const hmac = crypto.createHmac('sha256', secret);
    const expectedSignature = hmac.update(signedContent).digest('base64');

    // Use constant-time comparison
    const expectedBuffer = Buffer.from(expectedSignature, 'base64');
    const receivedBuffer = Buffer.from(signature, 'base64');

    if (expectedBuffer.length !== receivedBuffer.length) {
      console.error('[ERROR] ❌ Signature length mismatch');
      clearTimeout(requestTimeout);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      console.error('[ERROR] ❌ Signature verification failed');
      clearTimeout(requestTimeout);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    console.log('[INFO] ✅ Signature verified successfully');

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

    // 4. Lazy load Firebase if needed
    if (!isFirebaseLoaded) {
      console.log('[INFO] 🔄 Lazy loading Firebase for event processing');
      await loadFirebaseModules();
      defineEventHandlers();
    }

    // 5. Process event and respond immediately
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
    version: '1.0.0',
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

console.log('[INFO] ✅ Dodo Webhook Key:', process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'Configured' : 'Missing');
console.log('[INFO] 📊 Collections configured:');
console.log('[INFO]    - users');
console.log('[INFO]    - credit_transactions');
console.log('[INFO]    - purchases');
console.log('[INFO]    - subscription_transactions');
console.log('[INFO] ✅ Ready to process webhooks at /api/lemon-webhook');
console.log('[INFO] 🔄 Lazy loading enabled: Firebase will load only when needed');

export default router;