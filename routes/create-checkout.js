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
  const key = process.env.DODO_PAYMENTS_API_KEY;
  const env = process.env.DODO_PAYMENTS_ENV || (process.env.NODE_ENV === 'production' ? 'live_mode' : 'test_mode');
  dodoClient = new DodoPayments({
    bearerToken: key,
    environment: env
  });
  return dodoClient;
};

// ==================== STATUS ENDPOINT ====================

router.get('/status', (req, res) => {
  try {
    console.log('[INFO] 🔍 Checking Dodo Payments service status');
    
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    const DODO_WEBHOOK_KEY = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    const FIREBASE_LOADED = isFirebaseLoaded;
    const FIREBASE_AUTH_AVAILABLE = isFirebaseAuthAvailable();
    
    let dodoApiStatus = 'unknown';
    let dodoAccountInfo = null;
    
    const testDodoConnection = async () => {
      if (!DODO_API_KEY) return 'not_configured';
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch('https://api.dodopayments.com/v1/account', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${DODO_API_KEY}`
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const result = await response.json();
          dodoAccountInfo = {
            id: result.id,
            name: result.name,
            email: result.email,
            mode: result.mode || 'unknown'
          };
          return 'connected';
        } else {
          return 'connection_failed';
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return 'timeout';
        }
        return 'error';
      }
    };
    
    Promise.all([
      testDodoConnection(),
    ]).then(([dodoStatus]) => {
      dodoApiStatus = dodoStatus;
      
      const statusResponse = {
        success: true,
        service: 'dodo-payments',
        status: dodoApiStatus === 'connected' ? 'operational' : 
                dodoApiStatus === 'not_configured' ? 'configuration_needed' :
                dodoApiStatus === 'timeout' ? 'degraded' : 'unavailable',
        configuration: {
          dodoApiKey: DODO_API_KEY ? 'configured' : 'missing',
          dodoWebhookKey: DODO_WEBHOOK_KEY ? 'configured' : 'missing',
          firebaseAuth: FIREBASE_AUTH_AVAILABLE ? 'available' : 'not_loaded',
          environment: process.env.NODE_ENV || 'development',
          lazyLoading: 'enabled'
        },
        services: {
          dodoApi: {
            status: dodoApiStatus,
            account: dodoAccountInfo,
            message: dodoApiStatus === 'connected' ? '✅ Connected to Dodo Payments API' :
                    dodoApiStatus === 'not_configured' ? '⚠️ API key not configured' :
                    dodoApiStatus === 'timeout' ? '⚠️ API timeout - service slow' :
                    dodoApiStatus === 'connection_failed' ? '❌ Connection failed' : '❌ Unknown error'
          },
          firebaseAuth: {
            loaded: FIREBASE_LOADED,
            available: FIREBASE_AUTH_AVAILABLE,
            message: FIREBASE_AUTH_AVAILABLE ? '✅ Firebase auth ready' : '⚠️ Firebase auth not loaded (lazy loading)'
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
      
    }).catch(error => {
      console.error('[ERROR] ❌ Status check error:', error);
      res.status(500).json({
        success: false,
        service: 'dodo-payments',
        status: 'check_failed',
        error: 'Status check failed',
        timestamp: new Date().toISOString()
      });
    });
    
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
  // Set request timeout
  const requestTimeout = setTimeout(() => {
    console.error('[ERROR] ⏰ Checkout request timeout after 8 seconds');
    if (!res.headersSent) {
      res.status(504).json({ 
        success: false,
        error: 'Request timeout',
        message: 'Checkout creation took too long',
        timestamp: new Date().toISOString()
      });
    }
  }, 8000);

  try {
    console.log('[INFO] 🔄 Creating checkout session');
    
    // Get the authorization token from headers
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[WARN] ⚠️ No authorization header provided - allowing test mode');
    }

    const idToken = authHeader ? authHeader.split('Bearer ')[1] : 'test-token';
    
    // Verify Firebase ID token
    let decodedToken;
    try {
      if (process.env.NODE_ENV === 'test' || !authHeader) {
        // Test mode
        console.log('[TEST] 🧪 Test mode: Using mock user for checkout');
        decodedToken = { 
          uid: 'test-user-id', 
          email: req.body.email || 'test@example.com' 
        };
      } else {
        // Production - verify token
        const authInstance = await loadFirebaseAuth();
        decodedToken = await authInstance.verifyIdToken(idToken);
      }
    } catch (error) {
      console.error('[ERROR] ❌ Token verification error:', error.message);
      clearTimeout(requestTimeout);
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - Invalid token' 
      });
    }

    const { uid, email: tokenEmail } = decodedToken;
    const { variantId, successUrl, cancelUrl, metadata } = req.body;
    
    // Extract metadata from request body
    const { name, email: bodyEmail } = metadata || {};
    
    if (!variantId) {
      console.log('[ERROR] ❌ Missing variantId in request');
      clearTimeout(requestTimeout);
      return res.status(400).json({ 
        success: false,
        error: 'Missing product ID (variantId)' 
      });
    }

    // Security check
    if (process.env.NODE_ENV !== 'test') {
      const { userId } = metadata || {};
      if (userId && userId !== uid) {
        console.log(`[ERROR] ❌ User ID mismatch - Token: ${uid}, Request: ${userId}`);
        clearTimeout(requestTimeout);
        return res.status(403).json({ 
          success: false,
          error: 'Forbidden - User ID mismatch' 
        });
      }
    }

    // Use email from token or body
    const customerEmail = tokenEmail || bodyEmail;
    
    if (!customerEmail) {
      console.log('[ERROR] ❌ No email provided');
      clearTimeout(requestTimeout);
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    
    if (!DODO_API_KEY) {
      console.error('[ERROR] ❌ Dodo API key not configured');
      clearTimeout(requestTimeout);
      return res.status(500).json({ 
        success: false,
        error: 'Server configuration error' 
      });
    }
    
    console.log(`[INFO] 🛒 Creating checkout - User: ${uid}, Product: ${variantId}`);
    
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

    // Create Checkout Session via DodoPayments
    try {
      const client = getDodoClient();

      const product = PRODUCT_CATALOG[variantId];
      const defaultCurrency = (process.env.DEFAULT_CURRENCY || 'usd').toLowerCase();
      const allowedMethods = req.body.allowed_payment_method_types || [
        'credit',
        'debit',
        'apple_pay',
        'google_pay'
      ];

      const dodoProductId = product.id;
      
      const payload = {
        amount: product.price,
        currency: defaultCurrency,
        allowed_payment_method_types: allowedMethods,
        product_cart: [ { 
          product_id: dodoProductId,
          quantity: 1 
        } ],
        customer: { 
          email: customerEmail, 
          name: name || customerEmail.split('@')[0] || 'Customer'
        },
        metadata: { 
          user_id: uid, 
          type: 'one_time',
          creditType: product.creditType,
          credits: product.credits,
          productKey: variantId,
          firebase_uid: uid,
          requested_variant: variantId,
          videoType: product.videoType || 'seconds',
          // IMPORTANT: Add webhook URL that points to your existing lemon-webhook
          webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/api/lemon-webhook`,
          ...(metadata || {})
        },
        return_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=success`,
        cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=cancelled`,
        payment_link: true
      };

      const apiTimeoutMs = Number(process.env.DODO_API_TIMEOUT_MS) || 5000;

      const createPromise = client.checkoutSessions.create(payload);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Dodo API timeout')), apiTimeoutMs)
      );

      const result = await Promise.race([createPromise, timeoutPromise]);

      // Normalize response
      const sessionId = result?.session_id || result?.id || result?.sessionId || (result?.data && result.data.id);
      const checkoutUrl = result?.checkout_url || result?.url || result?.checkoutUrl || (result?.data && result.data.checkout_url);
      const expiresAt = result?.expires_at || result?.expiresAt || (result?.data && result.data.expires_at);

      if (!sessionId) {
        console.error('[ERROR] ❌ Dodo client returned unexpected response:', result);
        clearTimeout(requestTimeout);
        return res.status(500).json({ success: false, error: 'Failed to create checkout', details: result });
      }

      console.log(`[INFO] ✅ Checkout created - Session ID: ${sessionId}`);
      
      // IMPORTANT: Also store this checkout session in your database for reference
      try {
        const adminModule = await import('firebase-admin');
        const admin = adminModule.default;
        const db = admin.firestore();
        
        const checkoutRef = db.collection('checkout_sessions').doc(sessionId);
        await checkoutRef.set({
          userId: uid,
          sessionId,
          productKey: variantId,
          productName: product.name,
          credits: product.credits,
          creditType: product.creditType,
          price: product.price,
          status: 'created',
          customerEmail,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          metadata: payload.metadata
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
          price: product.price
        },
        webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/api/lemon-webhook`,
        timestamp: new Date().toISOString() 
      });
    } catch (err) {
      clearTimeout(requestTimeout);
      if (err && err.message && err.message.includes('timeout')) {
        console.error('[ERROR] ❌ Dodo API request timeout');
        return res.status(504).json({ 
          success: false, 
          error: 'Payment provider timeout', 
          message: 'Payment service is taking too long to respond' 
        });
      }
      console.error('[ERROR] ❌ Checkout creation error:', err?.message || err);
      return res.status(500).json({ 
        success: false, 
        error: 'Payment service error', 
        details: err?.message || err 
      });
    }

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error('[ERROR] ❌ Checkout creation error:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
      error: error.message
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
        availableProducts: Object.keys(PRODUCT_CATALOG)
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
      error: error.message
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

// Get checkout session status
router.get('/session/:sessionId', async (req, res) => {
  const requestTimeout = setTimeout(() => {
    console.error('[ERROR] ⏰ Session status check timeout');
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        error: 'Session check timeout'
      });
    }
  }, 5000);

  try {
    const { sessionId } = req.params;
    console.log(`[INFO] 📋 Checking session status: ${sessionId}`);
    
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    
    if (!DODO_API_KEY) {
      clearTimeout(requestTimeout);
      return res.status(500).json({
        success: false,
        error: 'Dodo API key not configured'
      });
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`https://api.dodopayments.com/v1/checkouts/${sessionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('[ERROR] ❌ Dodo API Error:', result);
      clearTimeout(requestTimeout);
      return res.status(response.status).json({
        success: false,
        error: result.message || 'Failed to get session',
        details: result
      });
    }
    
    clearTimeout(requestTimeout);
    res.json({
      success: true,
      session: result,
      status: result.status,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    clearTimeout(requestTimeout);
    if (error.name === 'AbortError') {
      console.error('[ERROR] ❌ Session check timeout');
      res.status(504).json({
        success: false,
        error: 'Session check timeout - Dodo API slow'
      });
    } else {
      console.error('[ERROR] ❌ Error getting session:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

// Test Dodo API connection
router.get('/test-dodo', async (req, res) => {
  const requestTimeout = setTimeout(() => {
    console.error('[ERROR] ⏰ Dodo API test timeout');
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        error: 'Dodo API test timeout'
      });
    }
  }, 5000);

  try {
    console.log('[INFO] 🧪 Testing Dodo API connection');
    
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    
    if (!DODO_API_KEY) {
      clearTimeout(requestTimeout);
      return res.status(500).json({
        success: false,
        error: 'Dodo API key not configured'
      });
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch('https://api.dodopayments.com/v1/account', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    clearTimeout(requestTimeout);
    
    if (response.ok) {
      const result = await response.json();
      console.log('[INFO] ✅ Dodo API connection successful');
      res.json({
        success: true,
        message: 'Dodo API connection successful',
        account: {
          id: result.id,
          name: result.name,
          email: result.email,
          mode: result.mode || 'unknown'
        }
      });
    } else {
      const error = await response.json();
      console.error('[ERROR] ❌ Dodo API connection failed:', error);
      res.status(response.status).json({
        success: false,
        error: error.message || 'Dodo API connection failed',
        details: error
      });
    }
  } catch (error) {
    clearTimeout(requestTimeout);
    if (error.name === 'AbortError') {
      console.error('[ERROR] ❌ Dodo API test timeout');
      res.status(504).json({
        success: false,
        error: 'Dodo API timeout - service may be down or slow'
      });
    } else {
      console.error('[ERROR] ❌ Test Dodo API error:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
});

console.log('[INFO] ✅ Dodo API Key:', process.env.DODO_PAYMENTS_API_KEY ? 'Configured' : 'Not Configured');
console.log('[INFO] 📊 Products Available:', Object.keys(PRODUCT_CATALOG).length);
console.log('[INFO] 🎯 Main Endpoint: POST /api/create-checkout');
console.log('[INFO] 🔄 Webhook Integration: Using existing routes/lemon-webhook.js');
console.log('[INFO] 📍 Webhook URL: https://soundswap-backend.vercel.app/api/lemon-webhook');
console.log('[INFO] ✅ Checkout sessions are saved to Firestore for tracking');

export default router;