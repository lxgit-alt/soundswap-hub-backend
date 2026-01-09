// create-checkout.js - Dodo Payments Checkout API (Optimized)
import express from 'express';
import DodoPayments from 'dodopayments';

const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Checkout API Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;
let auth = null;

// Static product catalog - no imports needed
const PRODUCT_CATALOG = {
  // One-time purchases (credits)
  'prod_starter': {
    id: 'prod_starter',
    name: 'Starter Pack',
    description: '10 Cover Art Credits',
    credits: 10,
    price: 990, // $9.90 in cents
    type: 'one_time',
    creditType: 'coverArt'
  },
  'prod_creator': {
    id: 'prod_creator',
    name: 'Creator Pack',
    description: '25 Cover Art Credits',
    credits: 25,
    price: 2490, // $24.90 in cents
    type: 'one_time',
    creditType: 'coverArt'
  },
  'prod_pro': {
    id: 'prod_pro',
    name: 'Professional Pack',
    description: '100 Cover Art Credits',
    credits: 100,
    price: 8990, // $89.90 in cents
    type: 'one_time',
    creditType: 'coverArt'
  },
  'video_30s': {
    id: 'video_30s',
    name: 'Single 30s Lyric Video',
    description: '1 Lyric Video Credit (30 seconds)',
    credits: 1,
    price: 1490, // $14.90 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  'video_3pack_30s': {
    id: 'video_3pack_30s',
    name: '3-Pack 30s Lyric Videos',
    description: '3 Lyric Video Credits (30 seconds each)',
    credits: 3,
    price: 3990, // $39.90 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  'video_full': {
    id: 'video_full',
    name: 'Single Full Lyric Video',
    description: '2 Lyric Video Credits (Full song)',
    credits: 2,
    price: 2490, // $24.90 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  'video_3pack_full': {
    id: 'video_3pack_full',
    name: '3-Pack Full Lyric Videos',
    description: '6 Lyric Video Credits (Full song each)',
    credits: 6,
    price: 6990, // $69.90 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  'video_10pack_full': {
    id: 'video_10pack_full',
    name: '10-Pack Full Lyric Videos',
    description: '20 Lyric Video Credits (Full song each)',
    credits: 20,
    price: 19900, // $199.00 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  
  // Subscriptions
  'sub_basic_monthly': {
    id: 'sub_basic_monthly',
    name: 'Basic Monthly',
    description: '10 Cover Art Credits / Month',
    credits: 10,
    price: 990, // $9.90/month in cents
    type: 'subscription',
    creditType: 'coverArt',
    interval: 'monthly'
  },
  'sub_creator_monthly': {
    id: 'sub_creator_monthly',
    name: 'Creator Monthly',
    description: '25 Cover Art Credits / Month',
    credits: 25,
    price: 2490, // $24.90/month in cents
    type: 'subscription',
    creditType: 'coverArt',
    interval: 'monthly'
  },
  'sub_pro_monthly': {
    id: 'sub_pro_monthly',
    name: 'Professional Monthly',
    description: '100 Cover Art Credits / Month',
    credits: 100,
    price: 8990, // $89.90/month in cents
    type: 'subscription',
    creditType: 'coverArt',
    interval: 'monthly'
  }
};

// ==================== LAZY LOAD HELPER ====================

const loadFirebaseAuth = async () => {
  if (!isFirebaseLoaded) {
    console.log('[INFO] 🔥 Firebase: Lazy loading Firebase Admin auth');
    try {
      // Dynamically import Firebase Admin
      const adminModule = await import('firebase-admin');
      const admin = adminModule.default;
      
      // Check if Firebase is already initialized (by server.js)
      if (admin.apps.length > 0) {
        auth = admin.auth();
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
      // For testing, create a mock auth object
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

// ==================== DODO PAYMENTS CLIENT (LAZY SINGLETON) ====================
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

// ==================== CHECKOUT ENDPOINT WITH TIMEOUT PROTECTION ====================

router.post('/', async (req, res) => {
  // Signal that payments processing is active to suppress other modules
  try { process.__payments_running = true; } catch (e) { /* no-op */ }

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
  }, 8000); // 8 seconds timeout (slightly less than Vercel's 10s)

  try {
    console.log('[INFO] 🔄 Creating checkout session');
    
    // Get the authorization token from headers
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[WARN] ⚠️ No authorization header provided - allowing test mode');
      // For testing, allow without token but log warning
      console.log('[INFO] 🧪 Test mode: Skipping token verification');
    }

    const idToken = authHeader ? authHeader.split('Bearer ')[1] : 'test-token';
    
    // Verify Firebase ID token (lazy load if needed)
    let decodedToken;
    try {
      if (process.env.NODE_ENV === 'test' || !authHeader) {
        // Test mode - skip verification
        console.log('[TEST] 🧪 Test mode: Using mock user for checkout');
        decodedToken = { 
          uid: 'test-user-id', 
          email: req.body.email || 'test@example.com' 
        };
      } else {
        // Production - verify token (lazy load Firebase)
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
    const { variantId, type, successUrl, cancelUrl } = req.body;
    
    const { name, email: bodyEmail } = req.body;
    
    if (!variantId) {
      console.log('[ERROR] ❌ Missing variantId in request');
      clearTimeout(requestTimeout);
      return res.status(400).json({ 
        success: false,
        error: 'Missing product ID (variantId)' 
      });
    }

    // Security check (skip in test mode)
    if (process.env.NODE_ENV !== 'test') {
      const { userId } = req.body;
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
    
    console.log(`[INFO] 🛒 Creating checkout - User: ${uid}, Product: ${variantId}, Type: ${type}`);
    
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

    // Create Checkout Session via DodoPayments client with timeout
    try {
      const client = getDodoClient();

      // Send a unified one-time product to the payment provider while
      // retaining the requested variant in metadata for internal bookkeeping.
      // Include explicit amount/currency and allowed payment methods per spec.
      const product = PRODUCT_CATALOG[variantId];
      const defaultCurrency = (process.env.DEFAULT_CURRENCY || 'usd').toLowerCase();
      const allowedMethods = req.body.allowed_payment_method_types || [
        'credit',
        'debit',
        'apple_pay',
        'google_pay'
      ];

      const payload = {
        amount: product.price, // cents
        currency: defaultCurrency,
        allowed_payment_method_types: allowedMethods,
        product_cart: [ { product_id: 'prod_one_time', quantity: 1 } ],
        customer: { email: customerEmail, name: name || '' },
        metadata: { user_id: uid, type: type || 'one_time', firebase_uid: uid, requested_variant: variantId },
        return_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=success`,
        cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=cancelled`,
        payment_link: true
      };

      const apiTimeoutMs = Number(process.env.DODO_API_TIMEOUT_MS) || 5000;

      const createPromise = client.checkoutSessions.create(payload);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Dodo API timeout')), apiTimeoutMs));

      const result = await Promise.race([createPromise, timeoutPromise]);

      // Normalize possible response shapes
      const sessionId = result?.session_id || result?.id || result?.sessionId || (result?.data && result.data.id);
      const checkoutUrl = result?.checkout_url || result?.url || result?.checkoutUrl || (result?.data && result.data.checkout_url);
      const expiresAt = result?.expires_at || result?.expiresAt || (result?.data && result.data.expires_at);

      if (!sessionId) {
        console.error('[ERROR] ❌ Dodo client returned unexpected response:', result);
        clearTimeout(requestTimeout);
        return res.status(500).json({ success: false, error: 'Failed to create checkout', details: result });
      }

      console.log(`[INFO] ✅ Checkout created - Session ID: ${sessionId}`);
      clearTimeout(requestTimeout);
      return res.status(200).json({ success: true, checkoutUrl, sessionId, expiresAt, timestamp: new Date().toISOString() });
    } catch (err) {
      clearTimeout(requestTimeout);
      if (err && err.message && err.message.includes('timeout')) {
        console.error('[ERROR] ❌ Dodo API request timeout');
        return res.status(504).json({ success: false, error: 'Payment provider timeout', message: 'Payment service is taking too long to respond' });
      }
      console.error('[ERROR] ❌ Checkout creation error:', err?.message || err);
      return res.status(500).json({ success: false, error: 'Payment service error', details: err?.message || err });
    }

  } catch (error) {
    clearTimeout(requestTimeout);
    console.error('[ERROR] ❌ Checkout creation error:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    try { process.__payments_running = false; } catch (e) { /* no-op */ }
  }
});

// ==================== FAST ENDPOINTS (NO EXTERNAL DEPENDENCIES) ====================

// Get available products - FAST (no Firebase loading)
router.get('/products', (req, res) => {
  try {
    console.log('[INFO] 📦 Fetching product catalog');
    
    // Filter products by type if specified
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
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error fetching products:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get specific product - FAST (no Firebase loading)
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

// Test endpoint - FAST (no Firebase loading)
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Dodo Payments Checkout API is working',
    environment: process.env.NODE_ENV || 'development',
    firebaseAuth: isFirebaseAuthAvailable() ? 'loaded' : 'not loaded (lazy)',
    dodoApi: process.env.DODO_PAYMENTS_API_KEY ? 'configured' : 'not configured',
    lazy_loading: 'ENABLED - Firebase loads only when needed',
    products_available: Object.keys(PRODUCT_CATALOG).length,
    timestamp: new Date().toISOString()
  });
});

// Fast checkout test (for payment system testing without dependencies)
router.post('/test-fast-checkout', async (req, res) => {
  try {
    const { variantId, email } = req.body;
    
    if (!variantId || !email) {
      return res.status(400).json({
        success: false,
        error: 'variantId and email are required'
      });
    }
    
    // Validate product
    if (!PRODUCT_CATALOG[variantId]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product variant',
        availableProducts: Object.keys(PRODUCT_CATALOG)
      });
    }
    
    const product = PRODUCT_CATALOG[variantId];
    
    // Simulate checkout creation without external API calls
    const mockCheckoutUrl = `https://checkout.dodopayments.com/test/${Date.now()}`;
    const mockSessionId = `test_session_${Date.now()}`;
    
    console.log(`[TEST] 🧪 Fast checkout test - Product: ${product.name}, Email: ${email}`);
    
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
    console.error('[ERROR] ❌ Fast checkout test error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== ENDPOINTS WITH EXTERNAL DEPENDENCIES ====================

// Test Dodo API connection (lazy loads)
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
    
    // Test with a short timeout
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

// Get checkout session status (lazy loads if needed)
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

// Webhook test endpoint (for manual testing - minimal)
router.post('/test-webhook', async (req, res) => {
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
      message: `Simulated ${eventType} event`,
      eventType,
      data,
      note: 'This is a simulation - no actual webhook was sent',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[ERROR] ❌ Error in webhook test:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

console.log('[INFO] ✅ Dodo API Key:', process.env.DODO_PAYMENTS_API_KEY ? 'Configured' : 'Not Configured');
console.log('[INFO] 📊 Products Available:', Object.keys(PRODUCT_CATALOG).length);
console.log('[INFO] 🎯 Endpoint: /api/create-checkout');
console.log('[INFO] 🔄 Lazy loading enabled: Firebase Admin loads only for token verification');
console.log('[INFO] ⏱️  Timeout protection: 8s request timeout, 5s API timeouts');

export default router;