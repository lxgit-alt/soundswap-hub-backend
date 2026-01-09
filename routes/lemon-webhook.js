import express from 'express';
const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Webhook Handler Initialized');

// ==================== STATIC CONFIGURATION ====================
let firestoreDb = null;
let isFirebaseLoaded = false;

// Credit mapping (static)
const CREDIT_MAP = {
  'prod_starter': { coverArt: 10, lyricVideo: 0 },
  'prod_creator': { coverArt: 25, lyricVideo: 0 },
  'prod_pro': { coverArt: 100, lyricVideo: 0 },
  'video_30s': { coverArt: 0, lyricVideo: 1 },
  'video_3pack_30s': { coverArt: 0, lyricVideo: 3 },
  'video_full': { coverArt: 0, lyricVideo: 2 },
  'video_3pack_full': { coverArt: 0, lyricVideo: 6 },
  'video_10pack_full': { coverArt: 0, lyricVideo: 20 },
  'sub_basic_monthly': { coverArt: 10, lyricVideo: 0 },
  'sub_creator_monthly': { coverArt: 25, lyricVideo: 0 },
  'sub_pro_monthly': { coverArt: 100, lyricVideo: 0 }
};

// ==================== LAZY LOAD HELPERS ====================
const loadFirebase = async () => {
  if (!isFirebaseLoaded) {
    console.log('[LAZY-LOAD] 🔥 Loading Firebase for webhook...');
    try {
      const adminModule = await import('firebase-admin');
      const admin = adminModule.default;
      
      if (admin.apps.length === 0) {
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
          console.log('[LAZY-LOAD] 🔥 Firebase initialized for webhook');
        }
      }
      
      firestoreDb = admin.firestore();
      isFirebaseLoaded = true;
      console.log('[LAZY-LOAD] 🔥 Firestore loaded for webhook');
    } catch (error) {
      console.error('[ERROR] ❌ Failed to load Firebase for webhook:', error.message);
      isFirebaseLoaded = true; // Mark as loaded to prevent retries
    }
  }
  return firestoreDb;
};

// ==================== CREDIT MANAGEMENT ====================
const addCreditsToUser = async (email, coverArtCredits, lyricVideoCredits, orderId, userIdFromMeta) => {
  try {
    const db = await loadFirebase();
    
    if (!db) {
      console.error('[ERROR] ❌ Firebase not available for adding credits');
      return;
    }

    let userDocId = userIdFromMeta;
    let userEmail = email;

    if (!userDocId) {
      const usersRef = db.collection('users');
      const querySnapshot = await usersRef.where('email', '==', email.toLowerCase()).get();
      
      if (querySnapshot.empty) {
        console.warn(`[WARN] ⚠️ User not found for email: ${email}, creating pending transaction`);
        
        const transactionRef = db.collection('pending_credit_transactions').doc();
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
    
    const userRef = db.collection('users').doc(userDocId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.warn(`[WARN] ⚠️ User document not found: ${userDocId}`);
      return;
    }
    
    const userData = userDoc.data();
    
    const updateData = {
      updatedAt: new Date().toISOString(),
      lastTransaction: {
        orderId,
        creditsAdded: coverArtCredits + lyricVideoCredits,
        date: new Date().toISOString(),
        type: 'purchase'
      }
    };
    
    const currentPoints = userData.points || 0;
    const currentLyricVideoCredits = userData.lyricVideoCredits || 0;
    
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
      const transactionRef = db.collection('credit_transactions').doc();
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
      const transactionRef = db.collection('credit_transactions').doc();
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
    const purchaseRef = db.collection('purchases').doc();
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
    
    console.log(`[INFO] ✅ Added credits to user ${userDocId} - Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}`);
  } catch (error) {
    console.error('[ERROR] ❌ Error adding credits:', error.message);
  }
};

// ==================== WEBHOOK HANDLING ====================
// Middleware to get raw body for signature verification
const rawBodyMiddleware = (req, res, next) => {
  req.rawBody = '';
  req.setEncoding('utf8');

  req.on('data', (chunk) => {
    req.rawBody += chunk;
  });

  req.on('end', () => {
    next();
  });
};

// Webhook endpoint
router.post('/', rawBodyMiddleware, async (req, res) => {
  const requestTimeout = setTimeout(() => {
    console.error('[ERROR] ⏰ Webhook request timeout after 9 seconds');
    if (!res.headersSent) {
      res.status(504).json({ 
        success: false, 
        error: 'Request timeout',
        message: 'Processing took too long',
        timestamp: new Date().toISOString()
      });
    }
  }, 9000);

  try {
    console.log('[INFO] 🔄 Payment webhook received');
    
    const rawBody = req.rawBody;
    
    if (!rawBody || rawBody.length === 0) {
      console.error('[ERROR] ❌ Empty request body');
      clearTimeout(requestTimeout);
      return res.status(400).json({ error: 'Empty request body' });
    }

    // Verify signature
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

    const signatureParts = webhookSignature.split(',');
    const signature = signatureParts[1];

    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;

    // Import crypto only when needed
    const crypto = await import('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    const expectedSignature = hmac.update(signedContent).digest('base64');

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

    // Parse event
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

    // Process event after responding
    const processEvent = async () => {
      try {
        if (eventType === 'payment.succeeded') {
          const data = event.data;
          const transactionId = data.transaction_id;
          const customerEmail = data.customer?.email;
          const userId = data.metadata?.user_id;
          const items = data.product_cart || [];
          
          console.log(`[INFO] 💰 Payment succeeded - Transaction: ${transactionId}, Email: ${customerEmail}`);
          
          let coverArtCredits = 0;
          let lyricVideoCredits = 0;

          for (const item of items) {
            const productId = item.product_id;
            const quantity = item.quantity || 1;
            const credits = CREDIT_MAP[productId] || { coverArt: 0, lyricVideo: 0 };
            
            coverArtCredits += credits.coverArt * quantity;
            lyricVideoCredits += credits.lyricVideo * quantity;
            
            console.log(`[INFO] 📦 Cart item - Product: ${productId}, Credits: ${JSON.stringify(credits)}`);
          }

          console.log(`[INFO] 💰 Total credits - Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}`);

          if (customerEmail && (coverArtCredits > 0 || lyricVideoCredits > 0)) {
            await addCreditsToUser(customerEmail, coverArtCredits, lyricVideoCredits, transactionId, userId);
          }
        } else if (eventType === 'subscription.created' || eventType === 'subscription.renewed') {
          console.log(`[INFO] 📅 Subscription event: ${eventType}`);
          // Handle subscription logic here
        } else {
          console.log(`[INFO] ℹ️ Unhandled webhook event: ${eventType}`);
        }
      } catch (error) {
        console.error(`[ERROR] ❌ Error processing event ${eventType}:`, error.message);
      }
    };

    // Send immediate response
    clearTimeout(requestTimeout);
    res.status(200).json({ 
      success: true, 
      received: true,
      eventType,
      message: 'Webhook received and processing started',
      timestamp: new Date().toISOString()
    });

    // Process in background
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
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Dodo Payments Webhook endpoint is working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    firebase: isFirebaseLoaded ? 'loaded' : 'not loaded',
    dodoKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'missing',
    lazy_loading: 'ENABLED'
  });
});

router.get('/status', (req, res) => {
  res.json({
    success: true,
    service: 'dodo-payments-webhook',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    configuration: {
      firebase: isFirebaseLoaded ? 'loaded' : 'not loaded',
      dodoWebhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'missing',
      environment: process.env.NODE_ENV || 'development'
    },
    handledEvents: [
      'payment.succeeded',
      'subscription.created',
      'subscription.renewed'
    ]
  });
});

export default router;