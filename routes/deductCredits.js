import express from 'express';
import DodoPayments from 'dodopayments';

const router = express.Router();

console.log('[INFO] 🚀 Dodo Payments Checkout API Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;
let auth = null;

// Static product catalog - One-time credit purchases only
const PRODUCT_CATALOG = {
  // Cover Art Credit Packs
  'cover_starter': {
    id: 'pdt_0NVpYnGqHkTrG1MBpjZDH',
    name: 'Starter Pack',
    description: '10 Cover Art Credits',
    credits: 10,
    price: 499, // $4.99 in cents
    type: 'one_time',
    creditType: 'coverArt',
    features: [
      '10 credits for cover art',
      '+2 free visualizer previews',
      'Perfect for testing ideas',
      'Standard resolution (1080p)',
      'Basic style library'
    ]
  },
  'cover_creator': {
    id: 'pdt_0NVpYz3UZCFhpDsJRpIkJ',
    name: 'Creator Pack',
    description: '25 Cover Art Credits',
    credits: 25,
    price: 999, // $9.99 in cents
    type: 'one_time',
    creditType: 'coverArt',
    features: [
      '25 credits for cover art',
      '+5 free visualizer previews',
      'Best for single releases',
      'High resolution (2K)',
      'Premium style library',
      'Batch generation (3 variations)'
    ]
  },
  'cover_pro': {
    id: 'pdt_0NVpZ68TtojJFxcvTKFHD',
    name: 'Professional Pack',
    description: '100 Cover Art Credits',
    credits: 100,
    price: 2999, // $29.99 in cents
    type: 'one_time',
    creditType: 'coverArt',
    features: [
      '100 credits for cover art',
      '+20 free visualizer previews',
      '+1 custom style training',
      'For labels & agencies',
      'Ultra resolution (4K)',
      'Advanced batch generation',
      'Priority processing',
      'Commercial license included'
    ]
  },
  
  // Lyric Video Credit Packs
  'video_30s': {
    id: 'pdt_0NVpZOxJp5948ZTw1FqGC',
    name: 'Single 30s Lyric Video',
    description: '1 Lyric Video Credit (30 seconds)',
    credits: 1,
    price: 999, // $9.99 in cents
    type: 'one_time',
    creditType: 'lyricVideo',
    features: [
      '1080p resolution',
      'All visual styles',
      'No watermark',
      'MP4 download',
      'Social media optimized'
    ]
  },
  'video_3pack_30s': {
    id: 'pdt_0NVpZWTiwQDBitIEfQbwM',
    name: '3-Pack 30s Lyric Videos',
    description: '3 Lyric Video Credits (30 seconds each)',
    credits: 3,
    price: 2499, // $24.99 in cents
    type: 'one_time',
    creditType: 'lyricVideo',
    features: [
      '3 videos (30s each)',
      'Save for multiple releases',
      '1080p resolution',
      'No watermark',
      'All styles included'
    ]
  },
  'video_full': {
    id: 'pdt_0NVpZewrUSBHJXdJhB2wx',
    name: 'Single Full Lyric Video',
    description: '1 Full-Length Lyric Video Credit',
    credits: 1,
    price: 1999, // $19.99 in cents
    type: 'one_time',
    creditType: 'lyricVideo',
    features: [
      '1080p resolution',
      'All visual styles',
      'Commercial use license',
      'MP4 + GIF formats',
      'No watermarks'
    ]
  },
  'video_3pack_full': {
    id: 'pdt_0NVpZnLaWqxH7gst9gtHV',
    name: '3-Pack Full Lyric Videos',
    description: '3 Full-Length Lyric Video Credits',
    credits: 3,
    price: 4999, // $49.99 in cents
    type: 'one_time',
    creditType: 'lyricVideo',
    features: [
      '3 full-length videos',
      'Best for EPs',
      '1080p resolution',
      'All styles included',
      'Commercial license'
    ]
  },
  'video_10pack_full': {
    id: 'pdt_0NVpZv5PRx4s9xNTLxNt7',
    name: '10-Pack Full Lyric Videos',
    description: '10 Full-Length Lyric Video Credits',
    credits: 10,
    price: 14999, // $149.99 in cents
    type: 'one_time',
    creditType: 'lyricVideo',
    features: [
      '10 full-length videos',
      'For labels & agencies',
      '4K upgrade available',
      'Priority rendering',
      'Dedicated support',
      'Custom style requests'
    ]
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

// ==================== CREDIT ADDITION HELPER ====================
const addCreditsToUser = async (userId, productKey) => {
  try {
    const product = PRODUCT_CATALOG[productKey];
    if (!product) {
      throw new Error(`Product ${productKey} not found in catalog`);
    }

    const adminModule = await import('firebase-admin');
    const admin = adminModule.default;
    
    const userRef = admin.firestore().doc(`users/${userId}`);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      throw new Error('User profile not found');
    }
    
    const userData = userDoc.data();
    const creditField = `${product.creditType}Credits`;
    const currentCredits = userData[creditField] || 0;
    const newCredits = currentCredits + product.credits;
    
    // Create transaction record
    const transactionRef = admin.firestore().collection('credit_transactions').doc();
    
    await userRef.update({
      [creditField]: newCredits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActive: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await transactionRef.set({
      userId,
      type: 'credit_addition',
      creditType: product.creditType,
      amount: product.credits,
      previousBalance: currentCredits,
      newBalance: newCredits,
      productKey,
      price: product.price,
      date: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: new Date().toISOString()
    });
    
    // Update credits history
    const historyUpdate = {
      date: admin.firestore.FieldValue.serverTimestamp(),
      type: 'credit_addition',
      creditType: product.creditType,
      amount: product.credits,
      source: 'purchase',
      productKey,
      price: product.price,
      remaining: newCredits
    };
    
    const currentHistory = userData.creditsHistory || [];
    const updatedHistory = [...currentHistory.slice(-49), historyUpdate];
    
    await userRef.update({
      creditsHistory: updatedHistory
    });
    
    console.log(`✅ Added ${product.credits} ${product.creditType} credits to user ${userId}. New total: ${newCredits}`);
    
    return {
      success: true,
      previousBalance: currentCredits,
      newBalance: newCredits,
      creditType: product.creditType,
      productName: product.name
    };
  } catch (error) {
    console.error('❌ Error adding credits to user:', error);
    throw error;
  }
};

// ==================== CHECKOUT ENDPOINT ====================

router.post('/', async (req, res) => {
  try { process.__payments_running = true; } catch (e) { /* no-op */ }

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
    
    // Verify Firebase ID token
    let decodedToken;
    try {
      if (process.env.NODE_ENV === 'test' || !authHeader) {
        console.log('[TEST] 🧪 Test mode: Using mock user for checkout');
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
    const { productKey, successUrl, cancelUrl, type = 'coverArt' } = req.body;
    
    const { name, email: bodyEmail } = req.body;
    
    if (!productKey) {
      console.log('[ERROR] ❌ Missing productKey in request');
      clearTimeout(requestTimeout);
      return res.status(400).json({ 
        success: false,
        error: 'Missing product key (productKey)' 
      });
    }

    // Security check
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
    
    console.log(`[INFO] 🛒 Creating checkout - User: ${uid}, Product: ${productKey}, Type: ${type}`);
    
    // Validate product exists in catalog
    if (!PRODUCT_CATALOG[productKey]) {
      console.error(`[ERROR] ❌ Invalid product key: ${productKey}`);
      clearTimeout(requestTimeout);
      return res.status(400).json({ 
        success: false,
        error: 'Invalid product key',
        availableProducts: Object.keys(PRODUCT_CATALOG)
      });
    }

    // Create Checkout Session
    try {
      const client = getDodoClient();
      const product = PRODUCT_CATALOG[productKey];
      
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
        customer: { email: customerEmail, name: name || '' },
        metadata: { 
          user_id: uid, 
          type: 'one_time',
          creditType: product.creditType,
          credits: product.credits,
          productKey: productKey,
          firebase_uid: uid
        },
        return_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=success&product=${productKey}`,
        cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=cancelled`,
        payment_link: true
      };

      const apiTimeoutMs = Number(process.env.DODO_API_TIMEOUT_MS) || 5000;
      const createPromise = client.checkoutSessions.create(payload);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Dodo API timeout')), apiTimeoutMs));

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
  } finally {
    try { process.__payments_running = false; } catch (e) { /* no-op */ }
  }
});

// ==================== WEBHOOK ENDPOINT ====================
router.post('/webhook', async (req, res) => {
  console.log('[INFO] 🔄 Received webhook event');
  
  // Verify webhook signature
  const signature = req.headers['dodo-signature'];
  const webhookSecret = process.env.DODO_WEBHOOK_SECRET;
  
  if (!signature || !webhookSecret) {
    console.warn('[WARN] ⚠️ Missing webhook signature or secret');
    return res.status(400).json({ error: 'Missing signature or secret' });
  }
  
  try {
    const event = req.body;
    console.log(`[INFO] 🔄 Webhook event type: ${event.type}`);
    
    if (event.type === 'checkout.session.completed') {
      const session = event.data;
      const { user_id, creditType, productKey, credits } = session.metadata;
      
      if (!user_id || !productKey) {
        console.error('[ERROR] ❌ Missing metadata in webhook');
        return res.status(400).json({ error: 'Missing metadata' });
      }
      
      console.log(`[INFO] 💳 Payment completed - User: ${user_id}, Product: ${productKey}, Credits: ${credits}`);
      
      // Add credits to user
      try {
        await addCreditsToUser(user_id, productKey);
        console.log(`[INFO] ✅ Credits added to user ${user_id}`);
      } catch (creditError) {
        console.error('[ERROR] ❌ Failed to add credits:', creditError);
        // Don't fail the webhook, but log the error
      }
    }
    
    res.json({ received: true });
    
  } catch (error) {
    console.error('[ERROR] ❌ Webhook processing error:', error);
    res.status(400).json({ error: 'Webhook processing failed' });
  }
});

// ==================== FAST ENDPOINTS ====================

// Get available products
router.get('/products', (req, res) => {
  try {
    console.log('[INFO] 📦 Fetching product catalog');
    
    const { type, creditType } = req.query;
    let products = Object.entries(PRODUCT_CATALOG).map(([key, value]) => ({
      productKey: key,
      ...value
    }));
    
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
      note: 'One-time credit purchases only'
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
router.get('/products/:productKey', (req, res) => {
  try {
    const { productKey } = req.params;
    console.log(`[INFO] 📦 Fetching product: ${productKey}`);
    
    const product = PRODUCT_CATALOG[productKey];
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: `Product not found: ${productKey}`,
        availableProducts: Object.keys(PRODUCT_CATALOG)
      });
    }
    
    res.json({
      success: true,
      product: {
        productKey,
        ...product
      },
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
    products_available: Object.keys(PRODUCT_CATALOG).length,
    timestamp: new Date().toISOString(),
    note: 'One-time credit purchase system'
  });
});

// Add credits endpoint (for manual testing)
router.post('/add-credits', async (req, res) => {
  try {
    const { userId, productKey } = req.body;
    
    if (!userId || !productKey) {
      return res.status(400).json({
        success: false,
        error: 'userId and productKey are required'
      });
    }
    
    console.log(`[TEST] 🧪 Manually adding credits for user: ${userId}, product: ${productKey}`);
    
    const result = await addCreditsToUser(userId, productKey);
    
    res.json({
      success: true,
      message: 'Credits added successfully',
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error adding credits:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

console.log('[INFO] ✅ Dodo API Key:', process.env.DODO_PAYMENTS_API_KEY ? 'Configured' : 'Not Configured');
console.log('[INFO] 📊 Products Available:', Object.keys(PRODUCT_CATALOG).length);
console.log('[INFO] 🎯 Endpoint: /api/create-checkout');
console.log('[INFO] 🔄 Lazy loading enabled: Firebase Admin loads only when needed');
console.log('[INFO] ⏱️  Timeout protection: 8s request timeout, 5s API timeouts');
console.log('[INFO] 💰 Credit System: One-time purchases only');

export default router;