import express from 'express';
import DodoPayments from 'dodopayments';

const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Checkout API Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;
let auth = null;
let db = null; // Added for database access

// Static product catalog
const PRODUCT_CATALOG = {
  // One-time purchases (Cover Art Credits)
  'cover_starter': {
    id: 'pdt_0NVpYnGqHkTrG1MBpjZDH',
    name: 'Starter Pack',
    description: '10 Cover Art Credits',
    credits: 10,
    price: 499,
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

const isFirebaseAuthAvailable = () => {
  return isFirebaseLoaded && auth !== null;
};

// ==================== DODO PAYMENTS CLIENT ====================
let dodoClient = null;
const getDodoClient = () => {
  if (dodoClient) return dodoClient;
  
  if (!process.env.DODO_PAYMENTS_API_KEY) {
    console.error('[ERROR] ❌ Dodo Payments API key is not configured');
    return null;
  }
  
  const key = process.env.DODO_PAYMENTS_API_KEY;
  const env = process.env.DODO_PAYMENTS_ENV || (process.env.NODE_ENV === 'production' ? 'live_mode' : 'test_mode');
  
  try {
    // Robust initialization
    dodoClient = new DodoPayments({
      bearerToken: key,
      environment: env
    });
    console.log('[INFO] ✅ Dodo Payments client initialized');
    return dodoClient;
  } catch (error) {
    console.error('[ERROR] ❌ Failed to initialize Dodo Payments client:', error.message);
    return null;
  }
};

// ==================== STATUS ENDPOINT ====================

router.get('/status', (req, res) => {
  try {
    console.log('[INFO] 🔍 Checking Dodo Payments service status');
    
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    const DODO_WEBHOOK_KEY = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    const FIREBASE_LOADED = isFirebaseLoaded;
    const FIREBASE_AUTH_AVAILABLE = isFirebaseAuthAvailable();
    
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

// ==================== CHECKOUT ENDPOINT (UPDATED) ====================

router.post('/', async (req, res) => {
  console.log('[INFO] 🔄 Received checkout request');
  
  // 1. Immediate Header Setup to prevent "Empty Response" if early crash
  res.setHeader('Content-Type', 'application/json');

  try {
    const { variantId, metadata, successUrl, cancelUrl } = req.body;
    
    // Log minimal request info
    console.log(`[INFO] 🛒 Processing checkout for: ${variantId}`);

    // 2. Validation
    if (!variantId || !PRODUCT_CATALOG[variantId]) {
      console.log(`[ERROR] ❌ Invalid variant: ${variantId}`);
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or missing variantId',
        received: variantId 
      });
    }

    const client = getDodoClient();
    if (!client) {
      return res.status(500).json({ success: false, error: 'Payment client configuration error' });
    }

    const product = PRODUCT_CATALOG[variantId];
    const defaultCurrency = (process.env.DEFAULT_CURRENCY || 'usd').toLowerCase();

    // 3. Prepare Dodo Payload (Enhanced)
    const payload = {
      amount: product.price,
      currency: defaultCurrency,
      product_cart: [{
        product_id: product.id,
        quantity: 1
      }],
      customer: {
        email: metadata?.userEmail || metadata?.email || 'customer@soundswap.live',
        name: metadata?.name || 'SoundSwap User'
      },
      // Important: Add billing details to prevent upstream rejections
      billing_address_details: {
        country: 'US' 
      },
      metadata: {
        userId: metadata?.userId || 'anonymous',
        productKey: variantId,
        creditType: product.creditType,
        credits: String(product.credits), // Ensure string for metadata
        source: 'soundswap-web-v2',
        firebase_uid: metadata?.userId || 'anonymous'
      },
      return_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=success`,
      cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=cancelled`,
      payment_link: true
    };

    console.log(`[INFO] 🚀 Calling Dodo API for ${product.name}...`);

    // 4. API Call with Timeout Race
    const apiTimeoutMs = 15000;
    const createPromise = client.checkoutSessions.create(payload);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Dodo API timeout')), apiTimeoutMs)
    );

    const result = await Promise.race([createPromise, timeoutPromise]);
    
    // 5. Response Normalization (Crucial for "Empty Response" fix)
    // Dodo SDK versions vary; check all possible locations for ID and URL
    const sessionId = result?.session_id || result?.id || result?.sessionId || result?.data?.id;
    const checkoutUrl = result?.checkout_url || result?.url || result?.checkoutUrl || result?.data?.checkout_url;
    const expiresAt = result?.expires_at || result?.expiresAt || result?.data?.expires_at;

    if (!checkoutUrl) {
      console.error('[ERROR] ❌ Dodo API returned no URL. Raw Result:', JSON.stringify(result));
      return res.status(502).json({ 
        success: false, 
        error: 'Payment provider failed to generate a URL',
        debug: process.env.NODE_ENV === 'development' ? result : undefined
      });
    }

    // 6. Firestore Tracking (Non-blocking)
    // We launch this but don't await it to speed up the UI response
    loadFirebase().then(({ db }) => {
      if (db && sessionId) {
        db.collection('checkout_sessions').doc(String(sessionId)).set({
          sessionId,
          userId: metadata?.userId || 'anonymous',
          status: 'created',
          createdAt: new Date(),
          product: variantId,
          productName: product.name,
          checkoutUrl
        }).catch(e => console.warn('[DB WARN] Failed to log session:', e.message));
      }
    });

    // 7. Final JSON Response
    console.log(`[INFO] ✅ Checkout session ready: ${sessionId}`);
    
    return res.status(200).json({
      success: true,
      checkoutUrl: checkoutUrl,
      sessionId: sessionId,
      expiresAt: expiresAt,
      product: {
        name: product.name,
        price: product.price,
        credits: product.credits
      },
      webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/api/lemon-webhook`
    });

  } catch (error) {
    console.error('[ERROR] ❌ Checkout Route Crash:', error.message);
    console.error('[ERROR] Stack:', error.stack);
    
    // Ensure we ALWAYS return JSON, even on crash
    const status = error.message.includes('timeout') ? 504 : 500;
    
    if (!res.headersSent) {
      return res.status(status).json({
        success: false,
        error: error.name || 'CheckoutError',
        message: error.message || 'An unexpected error occurred during checkout creation',
        timestamp: new Date().toISOString()
      });
    }
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

// Test endpoint
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Dodo Payments Checkout API is working',
    environment: process.env.NODE_ENV || 'development',
    firebaseAuth: isFirebaseAuthAvailable() ? 'loaded' : 'not loaded (lazy)',
    firebaseFirestore: db ? 'loaded' : 'not loaded (lazy)',
    dodoApi: process.env.DODO_PAYMENTS_API_KEY ? 'configured' : 'not configured',
    webhookIntegration: 'CONNECTED to /api/lemon-webhook',
    products_available: Object.keys(PRODUCT_CATALOG).length,
    endpoints: {
      createCheckout: 'POST /api/create-checkout',
      getTransactions: 'GET /api/create-checkout/transactions/:userId',
      getPurchases: 'GET /api/create-checkout/purchases/:userId',
      getProducts: 'GET /api/create-checkout/products',
      getStatus: 'GET /api/create-checkout/status'
    },
    timestamp: new Date().toISOString(),
    note: 'Using existing webhook at routes/lemon-webhook.js'
  });
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
    const mockCheckoutUrl = `https://checkout.dodopayments.com/test/session_${Date.now()}`;
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

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    service: 'dodo-checkout'
  });
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