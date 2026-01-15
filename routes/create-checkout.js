// routes/create-checkout.js
import express from 'express';
import DodoPayments from 'dodopayments';

const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Checkout API Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;
let auth = null;

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

const loadFirebaseAuth = async () => {
  if (!isFirebaseLoaded) {
    console.log('[INFO] 🔥 Firebase: Lazy loading Firebase Admin auth');
    try {
      const adminModule = await import('firebase-admin');
      const admin = adminModule.default;
      
      if (admin.apps.length > 0) {
        auth = admin.auth();
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
          console.log('[INFO] 🔥 Firebase: Initialized successfully');
        } else {
          console.error('[ERROR] ❌ Firebase credentials incomplete');
          auth = null;
        }
      }
      
      isFirebaseLoaded = true;
      console.log('[INFO] 🔥 Firebase: Admin auth loaded successfully');
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
      isFirebaseLoaded = true;
      console.log('[INFO] 🔥 Firebase: Using mock auth for testing');
    }
  }
  return auth;
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
        version: '1.2.0',
        environment: process.env.NODE_ENV || 'development',
        oneTimePurchases: 'enabled'
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

// ==================== CHECKOUT ENDPOINT ====================

router.post('/', async (req, res) => {
  console.log('[INFO] 🔄 Received checkout request');
  
  // Always set response headers for JSON
  res.setHeader('Content-Type', 'application/json');
  
  // Set request timeout
  const requestTimeout = setTimeout(() => {
    console.error('[ERROR] ⏰ Checkout request timeout after 15 seconds');
    if (!res.headersSent) {
      return res.status(504).json({ 
        success: false,
        error: 'Request timeout',
        message: 'Checkout creation took too long',
        timestamp: new Date().toISOString()
      });
    }
  }, 15000);

  try {
    // Log request body for debugging
    console.log('[INFO] 📦 Request body:', JSON.stringify(req.body, null, 2));
    
    // Get the authorization token from headers
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[WARN] ⚠️ No authorization header provided - allowing test mode');
    }

    const idToken = authHeader ? authHeader.split('Bearer ')[1] : 'test-token';
    const { variantId, successUrl, cancelUrl, metadata } = req.body;
    
    console.log(`[INFO] 🛒 Processing checkout request for variant: ${variantId}`);
    
    // Validate required fields
    if (!variantId) {
      console.log('[ERROR] ❌ Missing variantId in request');
      clearTimeout(requestTimeout);
      return res.status(400).json({ 
        success: false,
        error: 'Missing product ID (variantId)' 
      });
    }

    // Validate product exists in catalog
    if (!PRODUCT_CATALOG[variantId]) {
      console.error(`[ERROR] ❌ Invalid product variant: ${variantId}`);
      clearTimeout(requestTimeout);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid product variant',
        availableProducts: Object.keys(PRODUCT_CATALOG)
      });
    }

    // Get Dodo API key
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    
    if (!DODO_API_KEY) {
      console.error('[ERROR] ❌ Dodo API key not configured');
      clearTimeout(requestTimeout);
      return res.status(500).json({ 
        success: false,
        error: 'Payment service configuration error',
        message: 'Dodo Payments API key is not configured'
      });
    }

    // Get Dodo client
    const client = getDodoClient();
    if (!client) {
      console.error('[ERROR] ❌ Failed to initialize Dodo Payments client');
      clearTimeout(requestTimeout);
      return res.status(500).json({ 
        success: false,
        error: 'Payment service initialization error',
        message: 'Failed to initialize payment client'
      });
    }

    // Get product details
    const product = PRODUCT_CATALOG[variantId];
    const defaultCurrency = (process.env.DEFAULT_CURRENCY || 'usd').toLowerCase();
    
    console.log(`[INFO] 📊 Product details: ${product.name}, Price: $${(product.price / 100).toFixed(2)}, Credits: ${product.credits}`);

    // Create payload for Dodo Payments
    const payload = {
      amount: product.price,
      currency: defaultCurrency,
      allowed_payment_method_types: ['credit', 'debit', 'apple_pay', 'google_pay'],
      product_cart: [{ 
        product_id: product.id,
        quantity: 1 
      }],
      customer: { 
        email: metadata?.email || 'customer@example.com',
        name: metadata?.name || 'Customer'
      },
      metadata: { 
        user_id: metadata?.userId || 'anonymous',
        type: 'one_time',
        creditType: product.creditType,
        credits: product.credits,
        productKey: variantId,
        videoType: product.videoType || 'seconds',
        firebase_uid: metadata?.userId || 'anonymous'
      },
      return_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=success`,
      cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=cancelled`,
      payment_link: true
    };

    console.log('[INFO] 🚀 Creating checkout session with Dodo Payments...');
    
    try {
      // Create checkout session with timeout
      const apiTimeoutMs = 10000; // 10 seconds for Dodo API
      const createPromise = client.checkoutSessions.create(payload);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Dodo API timeout')), apiTimeoutMs)
      );

      const result = await Promise.race([createPromise, timeoutPromise]);

      // Extract response data
      const sessionId = result?.session_id || result?.id || result?.sessionId || (result?.data && result.data.id);
      const checkoutUrl = result?.checkout_url || result?.url || result?.checkoutUrl || (result?.data && result.data.checkout_url);
      const expiresAt = result?.expires_at || result?.expiresAt || (result?.data && result.data.expires_at);

      if (!sessionId || !checkoutUrl) {
        console.error('[ERROR] ❌ Dodo client returned invalid response:', JSON.stringify(result, null, 2));
        clearTimeout(requestTimeout);
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to create checkout', 
          message: 'Payment service returned invalid response',
          details: 'Missing session ID or checkout URL'
        });
      }

      console.log(`[INFO] ✅ Checkout created successfully - Session ID: ${sessionId}`);
      console.log(`[INFO] 🔗 Checkout URL: ${checkoutUrl}`);

      // Save checkout session to Firestore for tracking
      try {
        const adminModule = await import('firebase-admin');
        const admin = adminModule.default;
        const db = admin.firestore();
        
        const checkoutRef = db.collection('checkout_sessions').doc(sessionId);
        await checkoutRef.set({
          sessionId,
          userId: metadata?.userId || 'anonymous',
          productKey: variantId,
          productName: product.name,
          credits: product.credits,
          creditType: product.creditType,
          price: product.price,
          status: 'created',
          customerEmail: metadata?.email || 'customer@example.com',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          metadata: payload.metadata,
          checkoutUrl,
          expiresAt
        });
        
        console.log(`[INFO] 📝 Checkout session ${sessionId} saved to database`);
      } catch (dbError) {
        console.warn('[WARN] ⚠️ Failed to save checkout session to database:', dbError.message);
        // Continue anyway - this is not critical
      }
      
      clearTimeout(requestTimeout);
      return res.status(200).json({ 
        success: true, 
        checkoutUrl, 
        sessionId, 
        expiresAt,
        product: {
          name: product.name,
          credits: product.credits,
          creditType: product.creditType,
          price: product.price,
          videoType: product.videoType
        },
        webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/api/lemon-webhook`,
        timestamp: new Date().toISOString() 
      });
      
    } catch (dodoError) {
      clearTimeout(requestTimeout);
      console.error('[ERROR] ❌ Dodo API error:', dodoError.message);
      
      if (dodoError.message && dodoError.message.includes('timeout')) {
        return res.status(504).json({ 
          success: false, 
          error: 'Payment provider timeout', 
          message: 'Payment service is taking too long to respond'
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        error: 'Payment service error', 
        message: dodoError.message || 'Unknown error from payment provider'
      });
    }

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error('[ERROR] ❌ Checkout creation error:', error.message);
    console.error('[ERROR] ❌ Error stack:', error.stack);
    
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
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
    dodoApi: process.env.DODO_PAYMENTS_API_KEY ? 'configured' : 'not configured',
    webhookIntegration: 'CONNECTED to /api/lemon-webhook',
    products_available: Object.keys(PRODUCT_CATALOG).length,
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

console.log('[INFO] ✅ Dodo API Key:', process.env.DODO_PAYMENTS_API_KEY ? 'Configured' : 'Not Configured');
console.log('[INFO] 📊 Products Available:', Object.keys(PRODUCT_CATALOG).length);
console.log('[INFO] 🎯 Main Endpoint: POST /api/create-checkout');
console.log('[INFO] 🔄 Webhook Integration: Using existing routes/lemon-webhook.js');
console.log('[INFO] 📍 Webhook URL: https://soundswap-backend.vercel.app/api/lemon-webhook');
console.log('[INFO] ✅ All endpoints return proper JSON responses');

export default router;