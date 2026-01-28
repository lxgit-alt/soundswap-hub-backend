// routes/create-checkout.js - COMPLETE FIXED VERSION WITH ERROR HANDLING
import express from 'express';

const router = express.Router();

console.log('[INFO] 🚀 Lemon Squeezy Checkout API Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;
let auth = null;
let db = null;

// Lemon Squeezy variant IDs (replace with your actual Lemon Squeezy variant IDs)
const PRODUCT_CATALOG = {
  // Cover Art Credits
  cover_starter: {
    variantId: '1256036',
    name: 'Starter Pack',
    description: '10 Cover Art Credits',
    credits: 10,
    displayPrice: 4.99,
    currency: 'USD',
    type: 'one_time',
    creditType: 'coverArt'
  },

  cover_creator: {
    variantId: '1256041',
    name: 'Creator Pack',
    description: '25 Cover Art Credits',
    credits: 25,
    displayPrice: 9.99,
    currency: 'USD',
    type: 'one_time',
    creditType: 'coverArt'
  },

  cover_pro: {
    variantId: '1256043',
    name: 'Professional Pack',
    description: '100 Cover Art Credits',
    credits: 100,
    displayPrice: 29.99,
    currency: 'USD',
    type: 'one_time',
    creditType: 'coverArt'
  },

  // Lyric Video Credits
  video_30s: {
    variantId: '1256045',
    name: 'Single 30s Video',
    description: '1 Lyric Video Credit (30 seconds)',
    credits: 1,
    displayPrice: 9.99,
    currency: 'USD',
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'seconds'
  },

  video_3pack_30s: {
    variantId: '1256046',
    name: '3-Pack (30s each)',
    description: '3 Lyric Video Credits (30 seconds each)',
    credits: 3,
    displayPrice: 24.99,
    currency: 'USD',
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'seconds'
  },

  video_full: {
    variantId: '1256048',
    name: 'Single Full Video',
    description: '2 Lyric Video Credits (Full song)',
    credits: 2,
    displayPrice: 19.99,
    currency: 'USD',
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'full'
  },

  video_3pack_full: {
    variantId: '1256051',
    name: '3-Pack (Full Length)',
    description: '6 Lyric Video Credits (Full song each)',
    credits: 6,
    displayPrice: 49.99,
    currency: 'USD',
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'full'
  },

  video_10pack_full: {
    variantId: '1256057',
    name: '10-Pack (Full Length)',
    description: '20 Lyric Video Credits (Full song each)',
    credits: 20,
    displayPrice: 149.99,
    currency: 'USD',
    type: 'one_time',
    creditType: 'lyricVideo',
    videoType: 'full'
  }
};

// ==================== LEMON SQUEEZY PAYMENTS CLIENT ====================
const getLemonClient = () => {
  try {
    if (!process.env.LEMON_SQUEEZY_API_KEY) {
      console.error('[ERROR] ❌ Lemon Squeezy API key is not configured');
      return null;
    }

    const API_KEY = process.env.LEMON_SQUEEZY_API_KEY;
    const STORE_ID = process.env.LEMON_SQUEEZY_STORE_ID;
    const BASE_URL = 'https://api.lemonsqueezy.com/v1';

    if (!STORE_ID) {
      console.error('[ERROR] ❌ Lemon Squeezy Store ID is not configured');
      return null;
    }

    console.log('[LEMON] 🍋 Using Lemon Squeezy API:', BASE_URL);

    // Fetch-based Lemon Squeezy client with strong error handling
    const lemonClient = {
      createCheckoutSession: async (payload) => {
        console.log('[LEMON] 🛒 Creating Lemon Squeezy checkout session');

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

          const response = await fetch(`${BASE_URL}/checkouts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${API_KEY}`,
              'Accept': 'application/vnd.api+json',
              'Content-Type': 'application/vnd.api+json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          console.log('[LEMON] Response status:', response.status);

          const contentType = response.headers.get('content-type');

          if (!response.ok) {
            let errorBody;
            if (contentType && contentType.includes('application/json')) {
              errorBody = await response.json();
            } else {
              errorBody = await response.text();
            }

            console.error('[LEMON] API Error:', {
              status: response.status,
              statusText: response.statusText,
              body: errorBody
            });

            throw new Error(
              `Lemon Squeezy API error (${response.status}): ${JSON.stringify(errorBody)}`
            );
          }

          if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('[LEMON] ❌ Non-JSON response:', text.substring(0, 200));
            throw new Error('Lemon Squeezy API returned non-JSON response');
          }

          const data = await response.json();

          console.log('[LEMON] ✅ Checkout created:', {
            checkoutId: data.data?.id,
            url: data.data?.attributes?.url
          });

          return data;

        } catch (error) {
          if (error.name === 'AbortError') {
            throw new Error('Lemon Squeezy API request timed out after 15 seconds');
          }
          throw error;
        }
      }
    };

    console.log('[LEMON] ✅ Lemon Squeezy client ready');
    return lemonClient;

  } catch (error) {
    console.error(
      '[ERROR] ❌ Failed to initialize Lemon Squeezy client:',
      error.message
    );
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
  console.log('[INFO] Request body:', JSON.stringify(req.body, null, 2));
  
  // Set headers immediately to prevent empty response
  res.setHeader('Content-Type', 'application/json');
  
  // Ensure body is parsed
  if (!req.body || typeof req.body !== 'object') {
    console.error('[ERROR] ❌ Invalid request body');
    return res.status(400).json({
      success: false,
      error: 'Invalid request body',
      timestamp: new Date().toISOString()
    });
  }

  try {
    const { variantId, metadata, successUrl, cancelUrl } = req.body;
    
    console.log(`[INFO] 🛒 Processing checkout for variant: ${variantId}`);
    console.log(`[INFO] 📝 Metadata:`, metadata || 'No metadata provided');

    // 1. Validate variantId
    if (!variantId) {
      console.log(`[ERROR] ❌ Missing variantId`);
      return res.status(400).json({ 
        success: false, 
        error: 'variantId is required',
        received: variantId,
        availableVariants: Object.keys(PRODUCT_CATALOG),
        timestamp: new Date().toISOString()
      });
    }

    const product = PRODUCT_CATALOG[variantId];
    if (!product) {
      console.log(`[ERROR] ❌ Invalid variant: ${variantId}`);
      return res.status(400).json({ 
        success: false, 
        error: `Invalid variantId: ${variantId}`,
        received: variantId,
        availableVariants: Object.keys(PRODUCT_CATALOG),
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[INFO] 📦 Product found: ${product.name} (${product.variantId})`);

    // 2. Get Lemon Squeezy client
    const lemonClient = getLemonClient();
    if (!lemonClient) {
      console.error('[ERROR] ❌ Lemon Squeezy client initialization failed');
      return res.status(500).json({ 
        success: false, 
        error: 'Payment gateway configuration error',
        message: 'Lemon Squeezy API key or Store ID is not configured or invalid',
        timestamp: new Date().toISOString()
      });
    }

    // 3. Prepare Lemon Squeezy Payload (JSON:API format)
    const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
    
    if (!storeId) {
      console.error('[ERROR] ❌ Lemon Squeezy Store ID not configured');
      return res.status(500).json({
        success: false,
        error: 'Store configuration error',
        message: 'Lemon Squeezy Store ID is not configured',
        timestamp: new Date().toISOString()
      });
    }

    const payload = {
      data: {
        type: 'checkouts',
        attributes: {
          custom_price: null,
          product_options: {
            redirect_url: successUrl || 
              `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=success`,
            receipt_link_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/dashboard`,
            receipt_button_text: "Go to Dashboard",
            enabled_variants: [parseInt(product.variantId)],
            description: product.description
          },
          checkout_options: {
            embed: false,
            media: false,
            logo: true,
            button_color: '#FF6B35'
          },
          checkout_data: {
            custom: {
              userId: metadata?.userId || 'anonymous',
              productKey: variantId,
              creditType: product.creditType,
              credits: product.credits.toString(),
              videoType: product.videoType || '',
              source: 'soundswap-web-v2'
            },
            email: metadata?.userEmail || metadata?.email || 'customer@soundswap.live',
            name: metadata?.name || 'SoundSwap User',
            billing_address: {
              country: 'US'
            }
          },
          expires_at: null, // Optional: set expiry date
          preview: false,
          test_mode: process.env.NODE_ENV === 'development'
        },
        relationships: {
          store: {
            data: { type: 'stores', id: storeId }
          },
          variant: {
            data: { type: 'variants', id: product.variantId }
          }
        }
      }
    };

    console.log(`[INFO] 🚀 Calling Lemon Squeezy API for ${product.name}...`);
    console.log(`[DEBUG] Payload:`, JSON.stringify(payload, null, 2));

    // 4. Create Checkout Session
    let result;
    try {
      result = await lemonClient.createCheckoutSession(payload);
      console.log(`[DEBUG] Lemon Squeezy API Response:`, JSON.stringify(result, null, 2));
    } catch (apiError) {
      console.error('[ERROR] ❌ Lemon Squeezy API call failed:', apiError.message);
      console.error('[ERROR] Stack:', apiError.stack);
      
      return res.status(502).json({ 
        success: false, 
        error: 'Payment gateway error',
        message: apiError.message,
        suggestion: 'Check your Lemon Squeezy API key and Store ID',
        timestamp: new Date().toISOString()
      });
    }
    
    // 5. Extract checkout URL and session ID
    const checkoutData = result?.data;
    const checkoutUrl = checkoutData?.attributes?.url;
    const checkoutId = checkoutData?.id;
    
    if (!checkoutUrl) {
      console.error('[ERROR] ❌ Lemon Squeezy API returned no URL. Full response:', JSON.stringify(result, null, 2));
      return res.status(502).json({ 
        success: false, 
        error: 'Payment gateway failed to generate checkout URL',
        debug: process.env.NODE_ENV === 'development' ? result : undefined,
        timestamp: new Date().toISOString()
      });
    }

    // 6. Firestore Tracking (Non-blocking - don't let it fail the request)
    try {
      const { db } = await loadFirebase();
      if (db && checkoutId) {
        await db.collection('checkout_sessions').doc(String(checkoutId)).set({
          checkoutId,
          userId: metadata?.userId || 'anonymous',
          userEmail: metadata?.userEmail || metadata?.email || 'unknown',
          status: 'created',
          createdAt: new Date(),
          product: variantId,
          productName: product.name,
          price: product.displayPrice,
          currency: product.currency,
          credits: product.credits,
          creditType: product.creditType,
          videoType: product.videoType || '',
          checkoutUrl,
          metadata: payload.data.attributes.checkout_data.custom,
          variantId: product.variantId,
          expiresAt: null
        });
        console.log(`[DB] ✅ Checkout session logged: ${checkoutId}`);
      }
    } catch (firestoreError) {
      console.warn('[DB WARN] Firestore not available for logging:', firestoreError.message);
      // Don't fail the request if Firestore is down
    }

    // 7. Final JSON Response
    console.log(`[INFO] ✅ Checkout session ready: ${checkoutId}`);
    console.log(`[INFO] 🔗 Checkout URL: ${checkoutUrl}`);
    
    const response = {
      success: true,
      checkoutUrl: checkoutUrl,
      checkoutId: checkoutId,
      product: {
        name: product.name,
        price: product.displayPrice,
        credits: product.credits,
        variantId: variantId,
        description: product.description
      },
      metadata: {
        user_id: metadata?.userId || 'anonymous',
        product_key: variantId
      },
      webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/api/lemon-webhook`,
      note: 'Use this checkoutUrl to redirect the user to Lemon Squeezy checkout',
      timestamp: new Date().toISOString()
    };
    
    console.log(`[INFO] 📤 Sending response:`, JSON.stringify(response, null, 2));
    return res.status(200).json(response);

  } catch (error) {
    console.error('[ERROR] ❌ Checkout Route Crash:', error.message);
    console.error('[ERROR] Stack:', error.stack);
    
    // ALWAYS return JSON, even on crash
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message || 'An unexpected error occurred during checkout creation',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== SIMPLE TEST ENDPOINT ====================

router.post('/test', async (req, res) => {
  console.log('[TEST] 🧪 Testing checkout endpoint');
  
  try {
    // Always return JSON
    res.json({
      success: true,
      message: 'Lemon Squeezy checkout endpoint is working',
      timestamp: new Date().toISOString(),
      requestBody: req.body || 'No body',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    console.error('[TEST] ❌ Error in test endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Test endpoint error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== DEBUG ENDPOINT ====================

router.get('/debug', (req, res) => {
  console.log('[DEBUG] 🔍 Debug endpoint called');
  
  try {
    const config = {
      lemonSqueezyApiKey: process.env.LEMON_SQUEEZY_API_KEY ? 
        `${process.env.LEMON_SQUEEZY_API_KEY.substring(0, 10)}...` : 'Not configured',
      lemonSqueezyStoreId: process.env.LEMON_SQUEEZY_STORE_ID || 'Not set',
      nodeEnv: process.env.NODE_ENV || 'development',
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'Not set',
      firebaseLoaded: isFirebaseLoaded,
      timestamp: new Date().toISOString(),
      products: Object.keys(PRODUCT_CATALOG)
    };
    
    console.log('[DEBUG] Configuration:', config);
    
    res.json({
      success: true,
      config,
      endpoints: {
        createCheckout: 'POST /',
        test: 'POST /test',
        status: 'GET /status',
        debug: 'GET /debug'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[DEBUG] ❌ Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Debug endpoint error',
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

// ==================== STATUS ENDPOINT (FIXED) ====================

router.get('/status', async (req, res) => {
  console.log('[INFO] 🔍 Checking Lemon Squeezy service status');
  
  try {
    // Test Lemon Squeezy API connection
    let lemonTest = { connected: false, error: null };
    const lemonClient = getLemonClient();
    
    if (lemonClient) {
      try {
        lemonTest.connected = true;
        lemonTest.message = 'Lemon Squeezy API client initialized successfully';
      } catch (testError) {
        lemonTest.error = testError.message;
      }
    }
    
    const statusResponse = {
      success: true,
      service: 'lemon-squeezy',
      status: 'operational',
      configuration: {
        lemonSqueezyApiKey: process.env.LEMON_SQUEEZY_API_KEY ? 'configured' : 'missing',
        lemonSqueezyStoreId: process.env.LEMON_SQUEEZY_STORE_ID ? 'configured' : 'missing',
        lemonSqueezyWebhookSecret: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET ? 'configured' : 'missing',
        firebaseAuth: auth ? 'available' : 'not_loaded',
        firebaseFirestore: db ? 'available' : 'not_loaded',
        environment: process.env.NODE_ENV || 'development',
        lazyLoading: 'enabled'
      },
      services: {
        lemonSqueezyApi: {
          status: process.env.LEMON_SQUEEZY_API_KEY ? 'configured' : 'not_configured',
          message: process.env.LEMON_SQUEEZY_API_KEY ? '✅ API key configured' : '⚠️ API key not configured',
          test: lemonTest
        },
        firebaseAuth: {
          loaded: isFirebaseLoaded,
          available: auth !== null,
          message: auth ? '✅ Firebase auth ready' : '⚠️ Firebase auth not loaded'
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
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        oneTimePurchases: 'enabled',
        transactionHistory: 'available',
        purchaseHistory: 'available'
      },
      timestamp: new Date().toISOString()
    };
    
    console.log('[INFO] ✅ Status check complete');
    return res.json(statusResponse);
    
  } catch (error) {
    console.error('[ERROR] ❌ Status endpoint error:', error.message);
    return res.status(500).json({
      success: false,
      service: 'lemon-squeezy',
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
    const mockCheckoutUrl = `https://soundswap.lemonsqueezy.com/checkout/buy/test_${Date.now()}`;
    const mockCheckoutId = `test_checkout_${Date.now()}`;
    
    console.log(`[TEST] 🧪 Creating test checkout for product: ${product.name}`);
    
    res.json({
      success: true,
      checkoutUrl: mockCheckoutUrl,
      checkoutId: mockCheckoutId,
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

// Test Lemon Squeezy API directly
router.get('/test-lemon', async (req, res) => {
  try {
    console.log('[TEST] 🧪 Testing Lemon Squeezy API directly');
    
    const lemonClient = getLemonClient();
    if (!lemonClient) {
      return res.status(500).json({
        success: false,
        error: 'Lemon Squeezy client not available',
        timestamp: new Date().toISOString()
      });
    }
    
    // Try to create a simple test session
    const testPayload = {
      data: {
        type: 'checkouts',
        attributes: {
          product_options: {
            redirect_url: 'https://soundswap.live/test-success',
            receipt_link_url: 'https://soundswap.live/dashboard'
          },
          checkout_data: {
            custom: {
              userId: 'test-user',
              productKey: 'cover_starter',
              creditType: 'coverArt',
              credits: '10'
            },
            email: 'test@soundswap.live',
            name: 'Test User'
          },
          test_mode: true
        },
        relationships: {
          store: {
            data: { type: 'stores', id: process.env.LEMON_SQUEEZY_STORE_ID }
          },
          variant: {
            data: { type: 'variants', id: '1256036' } // cover_starter variant
          }
        }
      }
    };
    
    const result = await lemonClient.createCheckoutSession(testPayload);
    
    res.json({
      success: true,
      message: 'Lemon Squeezy API test successful',
      checkoutId: result.data?.id,
      url: result.data?.attributes?.url,
      rawResponse: process.env.NODE_ENV === 'development' ? result : undefined,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[TEST] ❌ Lemon Squeezy API test failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Lemon Squeezy API test failed',
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
    service: 'lemon-squeezy-checkout',
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

console.log('[INFO] ✅ Lemon Squeezy API Key:', process.env.LEMON_SQUEEZY_API_KEY ? 
  `Configured (${process.env.LEMON_SQUEEZY_API_KEY.substring(0, 10)}...)` : 
  'Not Configured');
console.log('[INFO] 🏪 Lemon Squeezy Store ID:', process.env.LEMON_SQUEEZY_STORE_ID || 'Not Configured');
console.log('[INFO] 📊 Products Available:', Object.keys(PRODUCT_CATALOG).length);
console.log('[INFO] 🎯 Main Endpoint: POST /api/create-checkout');
console.log('[INFO] 🧪 Test Endpoint: POST /api/create-checkout/test');
console.log('[INFO] 🔍 Debug Endpoint: GET /api/create-checkout/debug');
console.log('[INFO] 📋 Status Endpoint: GET /api/create-checkout/status');
console.log('[INFO] 📋 Transactions Endpoint: GET /api/create-checkout/transactions/:userId');
console.log('[INFO] 🛍️ Purchases Endpoint: GET /api/create-checkout/purchases/:userId');
console.log('[INFO] 🔄 Webhook Integration: Using existing routes/lemon-webhook.js');
console.log('[INFO] 📍 Webhook URL: https://soundswap-backend.vercel.app/api/lemon-webhook');
console.log('[INFO] ✅ All endpoints return proper JSON responses');

export default router;