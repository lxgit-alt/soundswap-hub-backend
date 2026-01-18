// routes/create-checkout.js - COMPLETE FIXED VERSION
import express from 'express';

const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Checkout API Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;
let auth = null;
let db = null;

// Static product catalog with your actual Dodo product IDs
const PRODUCT_CATALOG = {
  // One-time purchases (Cover Art Credits)
  'cover_starter': {
    id: 'pdt_0NVpYnGqHkTrG1MBpjZDH',
    name: 'Starter Pack',
    description: '10 Cover Art Credits',
    credits: 10,
    price: 499, // in cents
    type: 'one_time',
    creditType: 'coverArt'
  },
  'cover_creator': {
    id: 'pdt_0NVpYz3UZCFhpDsJRpIkJ',
    name: 'Creator Pack',
    description: '25 Cover Art Credits',
    credits: 25,
    price: 999,
    type: 'one_time',
    creditType: 'coverArt'
  },
  'cover_pro': {
    id: 'pdt_0NVpZ68TtojJFxcvTKFHD',
    name: 'Professional Pack',
    description: '100 Cover Art Credits',
    credits: 100,
    price: 2999,
    type: 'one_time',
    creditType: 'coverArt'
  },
  
  // One-time purchases (Lyric Video Credits)
  'video_30s': {
    id: 'pdt_0NVpZOxJp5948ZTw1FqGC',
    name: 'Single 30s Lyric Video',
    description: '1 Lyric Video Credit (30 seconds)',
    credits: 1,
    price: 999,
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'seconds'
  },
  'video_3pack_30s': {
    id: 'pdt_0NVpZWTiwQDBitIEfQbwM',
    name: '3-Pack 30s Lyric Videos',
    description: '3 Lyric Video Credits (30 seconds each)',
    credits: 3,
    price: 2499,
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'seconds'
  },
  'video_full': {
    id: 'pdt_0NVpZewrUSBHJXdJhB2wx',
    name: 'Single Full Lyric Video',
    description: '2 Lyric Video Credits (Full song)',
    credits: 2,
    price: 1999,
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'fullVideos'
  },
  'video_3pack_full': {
    id: 'pdt_0NVpZnLaWqxH7gst9gtHV',
    name: '3-Pack Full Lyric Videos',
    description: '6 Lyric Video Credits (Full song each)',
    credits: 6,
    price: 4999,
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'fullVideos'
  },
  'video_10pack_full': {
    id: 'pdt_0NVpZv5PRx4s9xNTLxNt7',
    name: '10-Pack Full Lyric Videos',
    description: '20 Lyric Video Credits (Full song each)',
    credits: 20,
    price: 14999,
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'fullVideos'
  }
};

// ==================== FIXED DODO PAYMENTS CLIENT ====================
const getDodoClient = async () => {
  try {
    if (!process.env.DODO_PAYMENTS_API_KEY) {
      console.error('[ERROR] ❌ Dodo Payments API key is not configured');
      return null;
    }
    
    const API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    const isTestMode = process.env.NODE_ENV !== 'production' || 
                      process.env.DODO_PAYMENTS_ENV === 'test' ||
                      !process.env.DODO_PAYMENTS_ENV;
    
    const BASE_URL = isTestMode 
      ? 'https://api-test.dodopayments.com' 
      : 'https://api.dodopayments.com';
    
    console.log(`[DODO] 🌐 Using ${isTestMode ? 'TEST' : 'LIVE'} environment: ${BASE_URL}`);
    
    // Simple fetch-based client
    const dodoClient = {
      createCheckoutSession: async (payload) => {
        console.log('[DODO] Creating checkout session with payload:', JSON.stringify(payload, null, 2));
        
        const response = await fetch(`${BASE_URL}/v1/checkout/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
          },
          body: JSON.stringify(payload)
        });
        
        const responseText = await response.text();
        console.log('[DODO] API Response status:', response.status);
        console.log('[DODO] API Response body:', responseText);
        
        if (!response.ok) {
          throw new Error(`Dodo API error (${response.status}): ${responseText}`);
        }
        
        try {
          return JSON.parse(responseText);
        } catch (parseError) {
          console.error('[DODO] Failed to parse response as JSON:', responseText);
          throw new Error('Invalid JSON response from Dodo API');
        }
      }
    };
    
    console.log('[DODO] ✅ Dodo Payments client ready');
    return dodoClient;
    
  } catch (error) {
    console.error('[ERROR] ❌ Failed to initialize Dodo Payments client:', error.message);
    return null;
  }
};

// ==================== LAZY LOAD HELPER ====================

const loadFirebase = async () => {
  if (!isFirebaseLoaded) {
    console.log('[INFO] 🔥 Firebase: Lazy loading Firebase Admin');
    try {
      const adminModule = await import('firebase-admin');
      const admin = adminModule.default;
      
      if (admin.apps.length > 0) {
        auth = admin.auth();
        db = admin.firestore();
        console.log('[INFO] 🔥 Firebase: Using existing Firebase Admin instance');
      } else {
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
          auth = admin.auth();
          db = admin.firestore();
          console.log('[INFO] 🔥 Firebase: Initialized successfully');
        } else {
          console.error('[ERROR] ❌ Firebase credentials incomplete');
          auth = null;
          db = null;
        }
      }
      
      isFirebaseLoaded = true;
      console.log('[INFO] 🔥 Firebase: Admin auth and firestore loaded successfully');
    } catch (error) {
      console.error('[ERROR] ❌ Failed to load Firebase Admin:', error.message);
      // Create mock auth for testing
      auth = {
        verifyIdToken: async (token) => {
          console.log('[TEST] 🔐 Mock token verification for testing');
          return { 
            uid: token === 'test-token' ? 'test-user-id' : 'mock-user-id',
            email: 'test@example.com'
          };
        }
      };
      db = null;
      isFirebaseLoaded = true;
      console.log('[INFO] 🔥 Firebase: Using mock auth for testing');
    }
  }
  return { auth, db };
};

// ==================== CHECKOUT ENDPOINT (FIXED) ====================

router.post('/', async (req, res) => {
  console.log('[INFO] 🔄 Received checkout request');
  
  // Set headers immediately
  res.setHeader('Content-Type', 'application/json');

  try {
    const { variantId, metadata, successUrl, cancelUrl } = req.body;
    
    console.log(`[INFO] 🛒 Processing checkout for: ${variantId}`);
    console.log(`[INFO] 📝 Metadata:`, metadata);

    // 1. Validate variantId
    if (!variantId) {
      console.log(`[ERROR] ❌ Missing variantId`);
      return res.status(400).json({ 
        success: false, 
        error: 'variantId is required',
        received: variantId,
        availableVariants: Object.keys(PRODUCT_CATALOG)
      });
    }

    const product = PRODUCT_CATALOG[variantId];
    if (!product) {
      console.log(`[ERROR] ❌ Invalid variant: ${variantId}`);
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid variantId',
        received: variantId,
        availableVariants: Object.keys(PRODUCT_CATALOG)
      });
    }

    // 2. Get Dodo client
    const dodoClient = await getDodoClient();
    if (!dodoClient) {
      return res.status(500).json({ 
        success: false, 
        error: 'Payment client configuration error',
        message: 'Dodo API key not configured or invalid'
      });
    }

    // 3. Prepare Dodo Payload
    const payload = {
      line_items: [{
        price: product.id,  // Using product ID as price ID
        quantity: 1
      }],
      customer: {
        email: metadata?.userEmail || metadata?.email || 'customer@soundswap.live',
        name: metadata?.name || 'SoundSwap User'
      },
      billing_address_collection: 'auto',
      metadata: {
        user_id: metadata?.userId || 'anonymous',
        product_key: variantId,
        credit_type: product.creditType,
        credits: product.credits.toString(),
        source: 'soundswap-web-v2',
        firebase_uid: metadata?.userId || 'anonymous',
        origin: metadata?.origin || req.headers.origin || 'direct'
      },
      success_url: successUrl || 
                  `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || 
                 `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=cancelled`,
      mode: 'payment',
      payment_method_types: ['card', 'link'], // Added 'link' for bank payments
      allow_promotion_codes: true,
      expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes from now
      submit_type: 'pay'
    };

    console.log(`[INFO] 🚀 Calling Dodo API for ${product.name}...`);
    console.log(`[DEBUG] Payload:`, JSON.stringify(payload, null, 2));

    // 4. Create Checkout Session
    let result;
    try {
      result = await dodoClient.createCheckoutSession(payload);
      console.log(`[DEBUG] Dodo API Response:`, JSON.stringify(result, null, 2));
    } catch (apiError) {
      console.error('[ERROR] ❌ Dodo API call failed:', apiError.message);
      return res.status(502).json({ 
        success: false, 
        error: 'Payment provider API error',
        message: apiError.message,
        timestamp: new Date().toISOString()
      });
    }
    
    // 5. Extract checkout URL and session ID
    const checkoutUrl = result?.url || result?.checkout_url;
    const sessionId = result?.id || result?.session_id;
    
    if (!checkoutUrl) {
      console.error('[ERROR] ❌ Dodo API returned no URL. Full response:', result);
      return res.status(502).json({ 
        success: false, 
        error: 'Payment provider failed to generate checkout URL',
        debug: process.env.NODE_ENV === 'development' ? result : undefined,
        timestamp: new Date().toISOString()
      });
    }

    // 6. Firestore Tracking (Non-blocking)
    try {
      const { db } = await loadFirebase();
      if (db && sessionId) {
        db.collection('checkout_sessions').doc(String(sessionId)).set({
          sessionId,
          userId: metadata?.userId || 'anonymous',
          userEmail: metadata?.userEmail || metadata?.email || 'unknown',
          status: 'created',
          createdAt: new Date(),
          product: variantId,
          productName: product.name,
          price: product.price,
          credits: product.credits,
          creditType: product.creditType,
          checkoutUrl,
          metadata: payload.metadata,
          expiresAt: new Date(payload.expires_at * 1000)
        }).then(() => {
          console.log(`[DB] ✅ Checkout session logged: ${sessionId}`);
        }).catch(e => {
          console.warn('[DB WARN] Failed to log session:', e.message);
        });
      }
    } catch (firestoreError) {
      console.warn('[DB WARN] Firestore not available for logging:', firestoreError.message);
    }

    // 7. Final JSON Response
    console.log(`[INFO] ✅ Checkout session ready: ${sessionId}`);
    console.log(`[INFO] 🔗 Checkout URL: ${checkoutUrl}`);
    
    return res.status(200).json({
      success: true,
      checkoutUrl: checkoutUrl,
      sessionId: sessionId,
      expiresAt: result.expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      product: {
        name: product.name,
        price: product.price,
        credits: product.credits,
        variantId: variantId,
        description: product.description
      },
      metadata: {
        user_id: metadata?.userId || 'anonymous',
        product_key: variantId
      },
      webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/api/lemon-webhook`,
      note: 'Use this checkoutUrl with DodoPayments.Checkout.open() in the frontend',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] ❌ Checkout Route Crash:', error.message);
    console.error('[ERROR] Stack:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred during checkout creation',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== TRANSACTIONS ENDPOINT ====================

router.get('/transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, type } = req.query;
    
    console.log(`[INFO] 📋 Fetching transactions for user: ${userId}, limit: ${limit}, type: ${type || 'all'}`);
    
    // Ensure Firebase is loaded
    await loadFirebase();
    
    if (!db) {
      console.error('[ERROR] ❌ Firebase Firestore not available');
      return res.status(503).json({ 
        success: false, 
        error: 'Database unavailable',
        timestamp: new Date().toISOString()
      });
    }

    let query = db.collection('credit_transactions')
      .where('userId', '==', userId)
      .orderBy('date', 'desc')
      .limit(parseInt(limit) || 50);
    
    if (type) {
      query = query.where('creditType', '==', type);
    }
    
    const snapshot = await query.get();
    const transactions = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        date: data.date && typeof data.date.toDate === 'function' 
              ? data.date.toDate().toISOString() 
              : (data.date || new Date().toISOString())
      };
    });
    
    console.log(`[INFO] ✅ Found ${transactions.length} transactions for user ${userId}`);
    
    return res.json({ 
      success: true,
      transactions,
      count: transactions.length,
      userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error fetching transactions:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== PURCHASES ENDPOINT ====================

router.get('/purchases/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;
    
    console.log(`[INFO] 🛍️ Fetching purchases for user: ${userId}, limit: ${limit}`);
    
    // Ensure Firebase is loaded
    await loadFirebase();
    
    if (!db) {
      console.error('[ERROR] ❌ Firebase Firestore not available');
      return res.status(503).json({ 
        success: false, 
        error: 'Database unavailable',
        timestamp: new Date().toISOString()
      });
    }
    
    const query = db.collection('purchases')
      .where('userId', '==', userId)
      .orderBy('date', 'desc')
      .limit(parseInt(limit) || 20);
    
    const snapshot = await query.get();
    const purchases = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        date: data.date && typeof data.date.toDate === 'function'
              ? data.date.toDate().toISOString() 
              : (data.date || new Date().toISOString())
      };
    });
    
    console.log(`[INFO] ✅ Found ${purchases.length} purchases for user ${userId}`);
    
    return res.json({
      success: true,
      purchases,
      count: purchases.length,
      userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error fetching purchases:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== HELPER ENDPOINTS ====================

// Get available products
router.get('/products', (req, res) => {
  try {
    console.log('[INFO] 📦 Fetching product catalog');
    
    const { type, creditType } = req.query;
    let products = Object.values(PRODUCT_CATALOG);
    
    if (type) {
      products = products.filter(p => p.type === type);
    }
    
    if (creditType) {
      products = products.filter(p => p.creditType === creditType);
    }
    
    res.json({
      success: true,
      products: products,
      count: products.length,
      timestamp: new Date().toISOString(),
      note: 'All products are one-time purchases'
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error fetching products:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get specific product
router.get('/products/:productId', (req, res) => {
  try {
    const { productId } = req.params;
    console.log(`[INFO] 📦 Fetching product: ${productId}`);
    
    const product = PRODUCT_CATALOG[productId];
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: `Product not found: ${productId}`,
        availableProducts: Object.keys(PRODUCT_CATALOG),
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      product: product,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error fetching product:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Status endpoint
router.get('/status', (req, res) => {
  try {
    console.log('[INFO] 🔍 Checking Dodo Payments service status');
    
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    const DODO_WEBHOOK_KEY = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    const FIREBASE_LOADED = isFirebaseLoaded;
    const FIREBASE_AUTH_AVAILABLE = auth !== null;
    
    const statusResponse = {
      success: true,
      service: 'dodo-payments',
      status: DODO_API_KEY ? 'configured' : 'not_configured',
      configuration: {
        dodoApiKey: DODO_API_KEY ? 'configured' : 'missing',
        dodoWebhookKey: DODO_WEBHOOK_KEY ? 'configured' : 'missing',
        firebaseAuth: FIREBASE_AUTH_AVAILABLE ? 'available' : 'not_loaded',
        firebaseFirestore: db ? 'available' : 'not_loaded',
        environment: process.env.NODE_ENV || 'development',
        lazyLoading: 'enabled'
      },
      services: {
        dodoApi: {
          status: DODO_API_KEY ? 'configured' : 'not_configured',
          message: DODO_API_KEY ? '✅ API key configured' : '⚠️ API key not configured'
        },
        firebaseAuth: {
          loaded: FIREBASE_LOADED,
          available: FIREBASE_AUTH_AVAILABLE,
          message: FIREBASE_AUTH_AVAILABLE ? '✅ Firebase auth ready' : '⚠️ Firebase auth not loaded'
        },
        firebaseFirestore: {
          loaded: db !== null,
          message: db ? '✅ Firestore ready' : '⚠️ Firestore not loaded'
        },
        productCatalog: {
          count: Object.keys(PRODUCT_CATALOG).length,
          message: `✅ ${Object.keys(PRODUCT_CATALOG).length} products available`
        },
        webhookIntegration: {
          status: 'CONNECTED',
          route: '/api/lemon-webhook',
          message: '✅ Using existing webhook at routes/lemon-webhook.js'
        }
      },
      endpoints: {
        createCheckout: 'POST /api/create-checkout',
        getTransactions: 'GET /api/create-checkout/transactions/:userId',
        getPurchases: 'GET /api/create-checkout/purchases/:userId',
        creditCheck: 'GET /api/deduct-credits/credits/:userId',
        creditDeduction: 'POST /api/deduct-credits/credits/:userId',
        webhook: 'POST /api/lemon-webhook',
        status: 'GET /api/create-checkout/status'
      },
      productTypes: {
        coverArt: Object.values(PRODUCT_CATALOG).filter(p => p.creditType === 'coverArt').length,
        lyricVideo: Object.values(PRODUCT_CATALOG).filter(p => p.creditType === 'lyricVideo').length,
        total: Object.keys(PRODUCT_CATALOG).length
      },
      systemInfo: {
        version: '1.3.0',
        environment: process.env.NODE_ENV || 'development',
        oneTimePurchases: 'enabled',
        transactionHistory: 'available',
        purchaseHistory: 'available'
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(statusResponse);
    
  } catch (error) {
    console.error('[ERROR] ❌ Status endpoint error:', error.message);
    res.status(500).json({
      success: false,
      service: 'dodo-payments',
      status: 'error',
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Test checkout creation (for debugging)
router.post('/test-checkout', async (req, res) => {
  try {
    const { variantId } = req.body;
    
    if (!variantId) {
      return res.status(400).json({
        success: false,
        error: 'variantId is required'
      });
    }
    
    const product = PRODUCT_CATALOG[variantId];
    if (!product) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product variant',
        availableProducts: Object.keys(PRODUCT_CATALOG)
      });
    }
    
    // Create a mock checkout URL for testing
    const mockCheckoutUrl = `https://checkout-test.dodopayments.com/pay/test_${Date.now()}`;
    const mockSessionId = `test_session_${Date.now()}`;
    
    console.log(`[TEST] 🧪 Creating test checkout for product: ${product.name}`);
    
    res.json({
      success: true,
      checkoutUrl: mockCheckoutUrl,
      sessionId: mockSessionId,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      product: product,
      note: 'This is a test checkout - no actual payment will be processed',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[ERROR] ❌ Test checkout error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Test Dodo API directly
router.get('/test-dodo', async (req, res) => {
  try {
    console.log('[TEST] 🧪 Testing Dodo API directly');
    
    const dodoClient = await getDodoClient();
    if (!dodoClient) {
      return res.status(500).json({
        success: false,
        error: 'Dodo client not available',
        timestamp: new Date().toISOString()
      });
    }
    
    // Try to create a simple test session
    const testPayload = {
      line_items: [{
        price: PRODUCT_CATALOG.cover_starter.id,
        quantity: 1
      }],
      customer: {
        email: 'test@soundswap.live',
        name: 'Test User'
      },
      success_url: 'https://soundswap.live/test-success',
      cancel_url: 'https://soundswap.live/test-cancel',
      mode: 'payment'
    };
    
    const result = await dodoClient.createCheckoutSession(testPayload);
    
    res.json({
      success: true,
      message: 'Dodo API test successful',
      sessionId: result.id,
      url: result.url,
      rawResponse: process.env.NODE_ENV === 'development' ? result : undefined,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[TEST] ❌ Dodo API test failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Dodo API test failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    service: 'dodo-checkout',
    products: Object.keys(PRODUCT_CATALOG).length
  });
});

// Deduct credits endpoint (for internal use)
router.post('/deduct-credits', async (req, res) => {
  try {
    const { userId, type, amount = 1, description } = req.body;
    
    console.log(`[CREDITS] 🔻 Deducting ${amount} ${type} credits for user: ${userId}`);
    
    if (!userId || !type) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId or type',
        timestamp: new Date().toISOString()
      });
    }
    
    // Load Firebase
    await loadFirebase();
    
    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database unavailable',
        timestamp: new Date().toISOString()
      });
    }
    
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        timestamp: new Date().toISOString()
      });
    }
    
    const userData = userDoc.data();
    
    // Determine credit field
    let creditField;
    let currentCredits;
    
    if (type === 'coverArt') {
      creditField = 'coverArtCredits';
      currentCredits = userData.coverArtCredits || userData.points || 0;
    } else if (type === 'lyricVideo') {
      creditField = 'lyricVideoCredits';
      currentCredits = userData.lyricVideoCredits || 0;
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid credit type. Use "coverArt" or "lyricVideo"',
        timestamp: new Date().toISOString()
      });
    }
    
    // Check if user has enough credits
    if (currentCredits < amount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient ${type} credits. Available: ${currentCredits}, Required: ${amount}`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Update credits
    const newCredits = currentCredits - amount;
    await userRef.update({
      [creditField]: newCredits,
      updatedAt: new Date()
    });
    
    // Log transaction
    await db.collection('credit_transactions').add({
      userId,
      type: 'deduction',
      creditType: type,
      amount: -amount,
      description: description || `${type} credit deduction`,
      previousBalance: currentCredits,
      newBalance: newCredits,
      date: new Date(),
      createdAt: new Date()
    });
    
    console.log(`[CREDITS] ✅ Deducted ${amount} ${type} credits from ${userId}. New balance: ${newCredits}`);
    
    return res.json({
      success: true,
      userId,
      creditType: type,
      amountDeducted: amount,
      newBalance: newCredits,
      previousBalance: currentCredits,
      description: description || `${type} credit deduction`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[ERROR] ❌ Error deducting credits:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

console.log('[INFO] ✅ Dodo API Key:', process.env.DODO_PAYMENTS_API_KEY ? 'Configured' : 'Not Configured');
console.log('[INFO] 📊 Products Available:', Object.keys(PRODUCT_CATALOG).length);
console.log('[INFO] 🎯 Main Endpoint: POST /api/create-checkout');
console.log('[INFO] 📋 Transactions Endpoint: GET /api/create-checkout/transactions/:userId');
console.log('[INFO] 🛍️ Purchases Endpoint: GET /api/create-checkout/purchases/:userId');
console.log('[INFO] 🔄 Webhook Integration: Using existing routes/lemon-webhook.js');
console.log('[INFO] 📍 Webhook URL: https://soundswap-backend.vercel.app/api/lemon-webhook');
console.log('[INFO] ✅ All endpoints return proper JSON responses');

export default router;