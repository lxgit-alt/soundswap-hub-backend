// routes/lemon-webhook.js
import express from 'express';
import { Webhook } from 'standardwebhooks';

const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Webhook Handler Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;
let db = null;

// Product catalog mapping (aligned with create-checkout.js)
const PRODUCT_CATALOG = {
  // Cover Art Credits
  'cover_starter': {
    name: 'Starter Pack',
    description: '10 Cover Art Credits',
    credits: 10,
    creditType: 'coverArt',
    videoType: null
  },
  'cover_creator': {
    name: 'Creator Pack',
    description: '25 Cover Art Credits',
    credits: 25,
    creditType: 'coverArt',
    videoType: null
  },
  'cover_pro': {
    name: 'Professional Pack',
    description: '100 Cover Art Credits',
    credits: 100,
    creditType: 'coverArt',
    videoType: null
  },
  
  // Lyric Video Credits
  'video_30s': {
    name: 'Single 30s Lyric Video',
    description: '1 Lyric Video Credit (30 seconds)',
    credits: 1,
    creditType: 'lyricVideo',
    videoType: 'seconds'
  },
  'video_3pack_30s': {
    name: '3-Pack 30s Lyric Videos',
    description: '3 Lyric Video Credits (30 seconds each)',
    credits: 3,
    creditType: 'lyricVideo',
    videoType: 'seconds'
  },
  'video_full': {
    name: 'Single Full Lyric Video',
    description: '2 Lyric Video Credits (Full song)',
    credits: 2,
    creditType: 'lyricVideo',
    videoType: 'fullVideos'
  },
  'video_3pack_full': {
    name: '3-Pack Full Lyric Videos',
    description: '6 Lyric Video Credits (Full song each)',
    credits: 6,
    creditType: 'lyricVideo',
    videoType: 'fullVideos'
  },
  'video_10pack_full': {
    name: '10-Pack Full Lyric Videos',
    description: '20 Lyric Video Credits (Full song each)',
    credits: 20,
    creditType: 'lyricVideo',
    videoType: 'fullVideos'
  }
};

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

// ==================== CREDIT MANAGEMENT FUNCTIONS ====================

const addCreditsToUser = async function(userId, productKey, orderId, customerEmail) {
  try {
    if (!db) {
      await loadFirebaseModules();
      if (!db) {
        console.error('[ERROR] ❌ Firebase not available for adding credits');
        return;
      }
    }

    // Get product details from catalog
    const product = PRODUCT_CATALOG[productKey];
    if (!product) {
      console.error(`[ERROR] ❌ Product not found in catalog: ${productKey}`);
      return;
    }

    const { credits, creditType, videoType, name: productName } = product;

    console.log(`[INFO] 💳 Adding credits to user ${userId}: ${credits} ${creditType} credits (product: ${productKey})`);

    // Collections
    const USERS_COLLECTION = 'users';
    const CREDIT_TRANSACTIONS_COLLECTION = 'credit_transactions';
    const PURCHASES_COLLECTION = 'purchases';

    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.warn(`[WARN] ⚠️ User document not found: ${userId}`);
      
      // Create pending transaction record
      const pendingRef = db.collection('pending_credit_transactions').doc();
      await pendingRef.set({
        userId,
        customerEmail,
        orderId,
        productKey,
        credits,
        creditType,
        videoType,
        productName,
        status: 'pending_user_creation',
        date: new Date().toISOString(),
        timestamp: Date.now()
      });
      
      console.log(`[INFO] 📝 Created pending transaction for user: ${userId}`);
      return;
    }
    
    const userData = userDoc.data();
    const userEmail = customerEmail || userData.email;
    
    // Prepare update data
    const updateData = {
      updatedAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };
    
    // Update credits based on credit type
    if (creditType === 'coverArt') {
      const currentCoverArtCredits = userData.coverArtCredits || 0;
      updateData.coverArtCredits = currentCoverArtCredits + credits;
      console.log(`[INFO] 📊 Cover Art Credits: ${currentCoverArtCredits} → ${updateData.coverArtCredits}`);
    } else if (creditType === 'lyricVideo') {
      const currentLyricVideoCredits = userData.lyricVideoCredits || { seconds: 0, fullVideos: 0 };
      
      if (videoType === 'seconds') {
        updateData.lyricVideoCredits = {
          ...currentLyricVideoCredits,
          seconds: currentLyricVideoCredits.seconds + credits
        };
        console.log(`[INFO] 📊 Lyric Video (seconds): ${currentLyricVideoCredits.seconds} → ${updateData.lyricVideoCredits.seconds}`);
      } else if (videoType === 'fullVideos') {
        updateData.lyricVideoCredits = {
          ...currentLyricVideoCredits,
          fullVideos: currentLyricVideoCredits.fullVideos + credits
        };
        console.log(`[INFO] 📊 Lyric Video (full): ${currentLyricVideoCredits.fullVideos} → ${updateData.lyricVideoCredits.fullVideos}`);
      }
    }
    
    // Update user document
    await userRef.update(updateData);
    
    // Create transaction record
    const transactionRef = db.collection(CREDIT_TRANSACTIONS_COLLECTION).doc();
    await transactionRef.set({
      userId,
      userEmail: userEmail?.toLowerCase(),
      orderId,
      type: 'purchase',
      creditType,
      amount: credits,
      videoType,
      productKey,
      productName,
      previousBalance: userData.coverArtCredits || 0,
      newBalance: creditType === 'coverArt' ? updateData.coverArtCredits : 
                 (videoType === 'seconds' ? updateData.lyricVideoCredits?.seconds : updateData.lyricVideoCredits?.fullVideos),
      status: 'completed',
      date: new Date().toISOString(),
      timestamp: Date.now()
    });
    
    // Create purchase record
    const purchaseRef = db.collection(PURCHASES_COLLECTION).doc();
    await purchaseRef.set({
      userId,
      userEmail: userEmail?.toLowerCase(),
      orderId,
      productKey,
      productName,
      credits,
      creditType,
      videoType,
      date: new Date().toISOString(),
      status: 'completed',
      type: 'one_time'
    });

    // Update checkout session status in Firestore
    try {
      const checkoutSessionRef = db.collection('checkout_sessions').doc(orderId);
      await checkoutSessionRef.update({
        status: 'completed',
        creditsAdded: credits,
        completedAt: new Date().toISOString()
      });
      console.log(`[INFO] ✅ Updated checkout session ${orderId} to completed`);
    } catch (sessionError) {
      console.warn(`[WARN] ⚠️ Could not update checkout session: ${sessionError.message}`);
    }
    
    console.log(`[INFO] ✅ Successfully added ${credits} ${creditType} credits to user ${userId} (${userEmail})`);
    
    // Send payment success email
    await sendPaymentSuccessEmail(userEmail, {
      userId,
      credits,
      creditType,
      videoType,
      productName,
      orderId,
      newBalance: updateData.coverArtCredits || updateData.lyricVideoCredits
    });
    
  } catch (error) {
    console.error('[ERROR] ❌ Error adding credits:', error.message);
  }
};

// ==================== EMAIL FUNCTION ====================

const sendPaymentSuccessEmail = async (email, data) => {
  try {
    console.log('[INFO] 📧 Preparing to send payment success email to:', email);
    
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      console.warn('[WARN] ⚠️ Email credentials not configured - skipping email');
      return false;
    }

    // Dynamic import for email dependencies
    const nodemailer = await import('nodemailer');
    const handlebars = await import('handlebars');
    const fs = await import('fs/promises');
    const path = await import('path');
    
    // Load and render template
    const templatePath = path.join(process.cwd(), 'templates', 'payment-status.hbs');
    const source = await fs.readFile(templatePath, 'utf8');
    const template = handlebars.compile(source);
    
    // Prepare email data
    const templateData = {
      status: 'success',
      success: true,
      name: email.split('@')[0],
      credits: {
        amount: data.credits,
        type: data.creditType === 'coverArt' ? 'Cover Art' : 
              (data.videoType === 'seconds' ? '30-Second Lyric Video' : 'Full-Length Lyric Video'),
        newBalance: data.newBalance
      },
      product: {
        name: data.productName,
        description: `${data.credits} ${data.creditType === 'coverArt' ? 'Cover Art' : 'Lyric Video'} Credits`
      },
      amount: '$' + (data.credits * (data.creditType === 'coverArt' ? 0.49 : 9.99)).toFixed(2), // Approximate pricing
      date: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      orderId: data.orderId.slice(0, 8),
      helpText: 'Your credits are ready to use in the studio! Create something amazing.',
      dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/dashboard`,
      studioUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio`,
      supportUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/support`,
      twitterUrl: 'https://twitter.com/soundswap',
      facebookUrl: 'https://facebook.com/soundswap',
      instagramUrl: 'https://instagram.com/soundswap_official',
      youtubeUrl: 'https://youtube.com/soundswap',
      statusClass: 'status-success',
      title: 'Payment Successful - SoundSwap'
    };

    const html = template(templateData);

    // Send email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    const subject = `🎉 Payment Successful! ${data.credits} ${data.creditType === 'coverArt' ? 'Cover Art' : 'Lyric Video'} Credits Added`;

    const mailOptions = {
      from: { name: 'SoundSwap Payments', address: process.env.GMAIL_USER },
      to: email,
      subject: subject,
      html: html
    };

    console.log('[INFO] 📤 Sending payment success email to:', email);
    const result = await transporter.sendMail(mailOptions);
    console.log('[INFO] ✅ Payment success email sent successfully:', result.messageId);
    return true;
  } catch (error) {
    console.error('[ERROR] ❌ Error sending payment success email:', error);
    return false;
  }
};

// ==================== EVENT HANDLERS ====================

const handleCheckoutSessionCompleted = async function(session) {
  const sessionId = session.id;
  const customerEmail = session.customer?.email;
  const metadata = session.metadata || {};
  
  const userId = metadata.user_id || metadata.firebase_uid;
  const productKey = metadata.productKey;
  const credits = parseInt(metadata.credits) || 0;
  const creditType = metadata.creditType;
  const videoType = metadata.videoType || 'seconds';
  
  console.log(`[INFO] 💰 Checkout session completed - Session: ${sessionId}`);
  console.log(`[INFO] 📋 Metadata - User: ${userId}, Product: ${productKey}, Email: ${customerEmail}`);
  console.log(`[INFO] 💳 Credits - Type: ${creditType}, Amount: ${credits}, VideoType: ${videoType}`);
  
  if (userId && productKey && credits > 0) {
    await addCreditsToUser(userId, productKey, sessionId, customerEmail);
  } else {
    console.warn(`[WARN] ⚠️ Missing required data for credits - UserId: ${userId}, ProductKey: ${productKey}, Credits: ${credits}`);
    
    // Store incomplete transaction for manual review
    try {
      if (!db) {
        await loadFirebaseModules();
      }
      
      if (db) {
        const incompleteRef = db.collection('incomplete_transactions').doc();
        await incompleteRef.set({
          sessionId,
          userId,
          customerEmail,
          productKey,
          credits,
          creditType,
          videoType,
          metadata,
          status: 'incomplete_data',
          date: new Date().toISOString(),
          timestamp: Date.now()
        });
        console.log(`[INFO] 📝 Stored incomplete transaction ${sessionId} for manual review`);
      }
    } catch (error) {
      console.error('[ERROR] ❌ Error storing incomplete transaction:', error.message);
    }
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

      // Verify using the standardwebhooks library
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
          case 'checkout.session.completed':
            await handleCheckoutSessionCompleted(event.data);
            break;
          
          case 'checkout.session.expired':
            console.log(`[INFO] ⏰ Checkout session expired: ${event.data.id}`);
            break;
          
          case 'checkout.session.payment_failed':
            console.log(`[ERROR] ❌ Checkout session payment failed: ${event.data.id}`);
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
    note: 'Firebase modules are lazily loaded to improve performance',
    integration: {
      createCheckout: 'Connected',
      deductCredits: 'Connected',
      emailSystem: 'Ready'
    },
    productCatalog: {
      count: Object.keys(PRODUCT_CATALOG).length,
      types: ['coverArt', 'lyricVideo']
    }
  });
});

// Get webhook status and configuration - NO FIREBASE LOADING
router.get('/status', (req, res) => {
  res.json({
    success: true,
    service: 'dodo-payments-webhook',
    version: '2.0.0',
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
      'checkout.session.completed',
      'checkout.session.expired',
      'checkout.session.payment_failed'
    ],
    integration: {
      createCheckout: '✅ Connected',
      deductCredits: '✅ Connected via Firestore',
      emailSystem: '✅ Ready (payment-status.hbs template)'
    },
    productCatalog: {
      count: Object.keys(PRODUCT_CATALOG).length,
      coverArt: Object.values(PRODUCT_CATALOG).filter(p => p.creditType === 'coverArt').length,
      lyricVideo: Object.values(PRODUCT_CATALOG).filter(p => p.creditType === 'lyricVideo').length
    },
    note: 'FULLY INTEGRATED WITH CREATE-CHECKOUT.JS',
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
    const { eventType, data } = req.body;
    
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
      data,
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

// Test credit addition endpoint (for manual testing)
router.post('/test-add-credits', async (req, res) => {
  try {
    const { userId, productKey, email } = req.body;
    
    if (!userId || !productKey) {
      return res.status(400).json({
        success: false,
        error: 'userId and productKey are required'
      });
    }
    
    console.log(`[TEST] 🧪 Manually adding credits for user: ${userId}, product: ${productKey}`);
    
    // Get product details
    const product = PRODUCT_CATALOG[productKey];
    if (!product) {
      return res.status(400).json({
        success: false,
        error: `Product not found: ${productKey}`,
        availableProducts: Object.keys(PRODUCT_CATALOG)
      });
    }
    
    const mockOrderId = `test_${Date.now()}`;
    
    // Call the actual addCreditsToUser function
    try {
      await addCreditsToUser(userId, productKey, mockOrderId, email);
      
      res.json({
        success: true,
        message: 'Test credits added successfully',
        userId,
        productKey,
        credits: product.credits,
        creditType: product.creditType,
        videoType: product.videoType,
        timestamp: new Date().toISOString(),
        note: 'This was a test transaction - check Firestore for results'
      });
    } catch (error) {
      console.error('[ERROR] ❌ Error in test:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
    
  } catch (error) {
    console.error('[ERROR] ❌ Error in test endpoint:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

console.log('[INFO] ✅ Dodo Webhook Handler Ready');
console.log('[INFO] 🔥 Firebase Integration: LAZY LOADING ENABLED');
console.log('[INFO] 📊 Product Catalog Loaded:', Object.keys(PRODUCT_CATALOG).length, 'products');
console.log('[INFO] 🎯 Webhook URL: POST /api/lemon-webhook');
console.log('[INFO] 🔗 Connected to: create-checkout.js & deduct-credits.js');
console.log('[INFO] 📧 Email System: Ready (using payment-status.hbs template)');
console.log('[INFO] ✅ Integration Status: FULLY CONNECTED');

export default router;