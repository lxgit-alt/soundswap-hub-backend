import express from 'express';
const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Checkout API Initialized');

// ==================== STATIC CONFIGURATION ====================
// No heavy imports at the top

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

// ==================== LAZY LOAD HELPERS ====================
let firebaseAuth = null;
let isFirebaseLoaded = false;

const loadFirebaseAuth = async () => {
  if (!isFirebaseLoaded) {
    try {
      console.log('[LAZY-LOAD] 🔥 Loading Firebase Admin auth for checkout...');
      const adminModule = await import('firebase-admin');
      const admin = adminModule.default;
      
      if (admin.apps.length === 0) {
        // Initialize with env variables
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
          console.log('[LAZY-LOAD] 🔥 Firebase initialized for checkout');
        } else {
          console.warn('[WARN] ⚠️ Firebase credentials incomplete for checkout');
        }
      }
      
      firebaseAuth = admin.auth();
      isFirebaseLoaded = true;
      console.log('[LAZY-LOAD] 🔥 Firebase auth loaded for checkout');
    } catch (error) {
      console.error('[ERROR] ❌ Failed to load Firebase auth:', error.message);
      // Mock auth for testing
      firebaseAuth = {
        verifyIdToken: async (token) => {
          console.log('[TEST] 🔐 Mock token verification');
          return { 
            uid: token === 'test-token' ? 'test-user-id' : 'mock-user-id',
            email: 'test@example.com'
          };
        }
      };
      isFirebaseLoaded = true;
    }
  }
  return firebaseAuth;
};

// ==================== CHECKOUT ENDPOINT ====================
router.post('/', async (req, res) => {
  // Set timeout
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
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[WARN] ⚠️ No authorization header provided - allowing test mode');
    }

    const idToken = authHeader ? authHeader.split('Bearer ')[1] : 'test-token';
    
    // Verify token (lazy load if needed)
    let decodedToken;
    try {
      if (process.env.NODE_ENV === 'test' || !authHeader) {
        decodedToken = { 
          uid: 'test-user-id', 
          email: req.body.email || 'test@example.com' 
        };
      } else {
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
      console.log('[ERROR] ❌ Missing variantId');
      clearTimeout(requestTimeout);
      return res.status(400).json({ 
        success: false,
        error: 'Missing product ID (variantId)' 
      });
    }

    // Security check
    if (process.env.NODE_ENV !== 'test') {
      const { userId } = req.body;
      if (userId && userId !== uid) {
        console.log(`[ERROR] ❌ User ID mismatch`);
        clearTimeout(requestTimeout);
        return res.status(403).json({ 
          success: false,
          error: 'Forbidden - User ID mismatch' 
        });
      }
    }

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
    
    // Validate product
    if (!PRODUCT_CATALOG[variantId]) {
      console.error(`[ERROR] ❌ Invalid product variant: ${variantId}`);
      clearTimeout(requestTimeout);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid product variant',
        availableProducts: Object.keys(PRODUCT_CATALOG)
      });
    }

    // Call Dodo API
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('https://api.dodopayments.com/v1/checkouts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DODO_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          product_cart: [
            {
              product_id: variantId,
              quantity: 1
            }
          ],
          customer: {
            email: customerEmail,
            name: name || ''
          },
          metadata: {
            user_id: uid,
            type: type || 'one_time',
            firebase_uid: uid
          },
          return_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=success`,
          cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=cancelled`,
          payment_link: true
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const result = await response.json();

      if (!response.ok) {
        console.error('[ERROR] ❌ Dodo API Error:', result);
        clearTimeout(requestTimeout);
        return res.status(response.status).json({
          success: false,
          error: result.message || 'Failed to create checkout',
          details: result
        });
      }

      console.log(`[INFO] ✅ Checkout created - Session ID: ${result.id}`);
      
      clearTimeout(requestTimeout);
      res.status(200).json({
        success: true,
        checkoutUrl: result.checkout_url,
        sessionId: result.id,
        expiresAt: result.expires_at,
        timestamp: new Date().toISOString()
      });

    } catch (fetchError) {
      clearTimeout(requestTimeout);
      if (fetchError.name === 'AbortError') {
        console.error('[ERROR] ❌ Dodo API request timeout');
        res.status(504).json({
          success: false,
          error: 'Payment provider timeout',
          message: 'Payment service is taking too long to respond'
        });
      } else {
        console.error('[ERROR] ❌ Checkout creation error:', fetchError.message);
        res.status(500).json({ 
          success: false,
          error: 'Payment service error',
          details: fetchError.message
        });
      }
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

// ==================== FAST ENDPOINTS ====================
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

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Dodo Payments Checkout API is working',
    environment: process.env.NODE_ENV || 'development',
    lazy_loading: 'ENABLED - Firebase loads only when needed',
    products_available: Object.keys(PRODUCT_CATALOG).length,
    timestamp: new Date().toISOString()
  });
});

export default router;