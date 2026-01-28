// api/create-checkout.js - UPDATED FOR LEMON SQUEEZY
import express from 'express';
import cors from 'cors';

const router = express.Router();

console.log('[INFO] 🚀 Lemon Squeezy Checkout API Initialized');

// Enable CORS for this specific router
router.use(cors({
  origin: [
    'http://localhost:3000',
    'https://localhost:3000', 
    'http://localhost:5173',
    'https://localhost:5173',
    'http://localhost:3001',
    'https://localhost:3001',
    'https://soundswap-backend.vercel.app',
    'https://soundswap.onrender.com',
    'https://www.soundswap.onrender.com',
    'https://soundswap.live',
    'https://www.soundswap.live',
    'https://sound-swap-frontend.onrender.com',
    'https://soundswap-hub.vercel.app',
    /\.vercel\.app$/ // Allow all Vercel subdomains
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Middleware to ensure JSON response
const ensureJsonResponse = (req, res, next) => {
  // Capture original send function
  const originalSend = res.send;
  res.send = function(body) {
    // Ensure we always send JSON
    if (typeof body !== 'string') {
      body = JSON.stringify(body);
    }
    
    // Ensure content-type is JSON
    res.setHeader('Content-Type', 'application/json');
    
    // Call original send
    originalSend.call(this, body);
  };
  next();
};

router.use(ensureJsonResponse);

// Static product catalog with your actual Lemon Squeezy variant IDs
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
    console.log('[LEMON] 🍋 Initializing Lemon Squeezy client...');
    
    if (!process.env.LEMON_SQUEEZY_API_KEY) {
      console.error('[LEMON] ❌ Lemon Squeezy API key is not configured');
      throw new Error('Lemon Squeezy API key is not configured');
    }

    const API_KEY = process.env.LEMON_SQUEEZY_API_KEY;
    const STORE_ID = process.env.LEMON_SQUEEZY_STORE_ID;
    const BASE_URL = 'https://api.lemonsqueezy.com/v1';

    if (!STORE_ID) {
      console.error('[LEMON] ❌ Lemon Squeezy Store ID is not configured');
      throw new Error('Lemon Squeezy Store ID is not configured');
    }

    console.log('[LEMON] ✅ Using Lemon Squeezy API:', {
      baseUrl: BASE_URL,
      storeId: STORE_ID,
      apiKeyLength: API_KEY.length
    });

    // Fetch-based Lemon Squeezy client with strong error handling
    const lemonClient = {
      createCheckoutSession: async (payload) => {
        console.log('[LEMON] 🛒 Creating Lemon Squeezy checkout session...');
        console.log('[LEMON] 📦 Payload:', JSON.stringify(payload, null, 2));

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

          console.log('[LEMON] 📤 Sending request to Lemon Squeezy API...');
          
          const response = await fetch(`${BASE_URL}/checkouts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${API_KEY}`,
              'Accept': 'application/vnd.api+json',
              'Content-Type': 'application/vnd.api+json',
              'User-Agent': 'SoundSwap/2.0'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          console.log('[LEMON] Response status:', response.status, response.statusText);

          // Get response as text first
          const responseText = await response.text();
          console.log('[LEMON] Raw response:', responseText.substring(0, 500));

          if (!response.ok) {
            console.error('[LEMON] ❌ API Error Response:', responseText);
            throw new Error(
              `Lemon Squeezy API error (${response.status}): ${responseText.substring(0, 200)}`
            );
          }

          // Try to parse JSON
          let data;
          try {
            data = JSON.parse(responseText);
          } catch (parseError) {
            console.error('[LEMON] ❌ Failed to parse JSON response:', parseError.message);
            console.error('[LEMON] Raw response that failed to parse:', responseText.substring(0, 200));
            throw new Error('Lemon Squeezy API returned invalid JSON');
          }

          console.log('[LEMON] ✅ Checkout created:', {
            checkoutId: data.data?.id,
            url: data.data?.attributes?.url ? 'Yes' : 'No URL',
            testMode: data.data?.attributes?.test_mode || false
          });

          return data;

        } catch (error) {
          if (error.name === 'AbortError') {
            console.error('[LEMON] ❌ Request timed out after 15 seconds');
            throw new Error('Lemon Squeezy API request timed out after 15 seconds');
          }
          console.error('[LEMON] ❌ Error creating checkout session:', error.message);
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

// ==================== SIMPLE AUTH HELPER ====================

const verifyAuth = async (req) => {
  // Simple authentication check - just verify we have a user ID
  const { userId } = req.body;
  
  if (!userId || userId === 'anonymous' || userId === 'undefined') {
    console.warn('[AUTH] ⚠️ No valid userId provided:', userId);
    return {
      authenticated: false,
      userId: 'anonymous',
      email: 'anonymous@soundswap.live'
    };
  }
  
  return {
    authenticated: true,
    userId,
    email: req.body.email || 'user@soundswap.live'
  };
};

// ==================== CHECKOUT ENDPOINT ====================

router.post('/', async (req, res) => {
  console.log('[INFO] 🔄 Received checkout request');
  
  try {
    // Always send JSON headers first
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

    console.log('[INFO] Request body:', JSON.stringify(req.body, null, 2));

    const { variantId, metadata, successUrl, cancelUrl } = req.body;
    
    console.log(`[INFO] 🛒 Processing checkout for variant: ${variantId}`);
    console.log(`[INFO] 📝 Metadata:`, metadata || 'No metadata provided');

    // 1. Validate variantId
    if (!variantId) {
      console.log(`[ERROR] ❌ Missing variantId`);
      return res.status(400).json({ 
        success: false, 
        error: 'variantId is required',
        timestamp: new Date().toISOString()
      });
    }

    const product = PRODUCT_CATALOG[variantId];
    if (!product) {
      console.log(`[ERROR] ❌ Invalid variant: ${variantId}`);
      return res.status(400).json({ 
        success: false, 
        error: `Invalid variantId: ${variantId}`,
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

    // 3. Verify authentication
    const authInfo = await verifyAuth(req);
    console.log('[AUTH] 🔐 Authentication result:', authInfo);

    // 4. Prepare Lemon Squeezy Payload
    const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
    
    if (!storeId) {
      console.error('[ERROR] ❌ Lemon Squeezy Store ID not configured');
      return res.status(500).json({
        success: false,
        error: 'Store configuration error',
        timestamp: new Date().toISOString()
      });
    }

    // Set up custom data for webhook
    const customData = {
      userId: authInfo.userId,
      userEmail: authInfo.email,
      productKey: variantId,
      productName: product.name,
      creditType: product.creditType,
      credits: product.credits,
      price: product.displayPrice,
      currency: product.currency,
      source: 'soundswap-web-v2',
      timestamp: new Date().toISOString(),
      videoType: product.videoType || '',
      sessionId: `checkout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    // Build the payload according to Lemon Squeezy API spec
    const payload = {
      data: {
        type: 'checkouts',
        attributes: {
          product_options: {
            redirect_url: successUrl || 
              `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/studio?payment=success`,
            receipt_link_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/dashboard`,
            receipt_button_text: "Go to Dashboard",
            description: product.description,
            enabled_variants: [product.variantId]
          },
          checkout_options: {
            embed: false,
            media: false,
            logo: true,
            button_color: '#FF6B35'
          },
          checkout_data: {
            custom: customData,
            email: authInfo.email,
            name: metadata?.name || 'SoundSwap User',
            billing_address: {
              country: 'US'
            }
          },
          expires_at: null, // No expiry
          preview: false,
          test_mode: process.env.NODE_ENV !== 'production'
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

    // 5. Create Checkout Session
    let result;
    try {
      result = await lemonClient.createCheckoutSession(payload);
      console.log(`[INFO] ✅ Lemon Squeezy API response received`);
    } catch (apiError) {
      console.error('[ERROR] ❌ Lemon Squeezy API call failed:', apiError.message);
      
      return res.status(502).json({ 
        success: false, 
        error: 'Payment gateway error',
        message: apiError.message,
        timestamp: new Date().toISOString()
      });
    }
    
    // 6. Extract checkout URL and session ID
    const checkoutData = result?.data;
    const checkoutUrl = checkoutData?.attributes?.url;
    const checkoutId = checkoutData?.id;
    
    if (!checkoutUrl) {
      console.error('[ERROR] ❌ Lemon Squeezy API returned no URL');
      return res.status(502).json({ 
        success: false, 
        error: 'Payment gateway failed to generate checkout URL',
        debug: process.env.NODE_ENV !== 'production' ? { result, payload } : undefined,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[INFO] ✅ Checkout session ready: ${checkoutId}`);
    console.log(`[INFO] 🔗 Checkout URL: ${checkoutUrl}`);
    
    // 7. Final JSON Response
    const response = {
      success: true,
      checkoutUrl: checkoutUrl,
      checkoutId: checkoutId,
      product: {
        name: product.name,
        price: product.displayPrice,
        credits: product.credits,
        variantId: variantId,
        description: product.description,
        lemonVariantId: product.variantId
      },
      metadata: {
        user_id: authInfo.userId,
        product_key: variantId
      },
      note: 'Redirect user to checkoutUrl to complete payment',
      timestamp: new Date().toISOString()
    };
    
    console.log(`[INFO] 📤 Sending successful response`);
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

// ==================== TEST ENDPOINTS ====================

// Simple test endpoint
router.post('/test', async (req, res) => {
  console.log('[TEST] 🧪 Testing checkout endpoint');
  
  try {
    res.json({
      success: true,
      message: 'Lemon Squeezy checkout endpoint is working',
      timestamp: new Date().toISOString(),
      requestBody: req.body || 'No body',
      environment: process.env.NODE_ENV || 'development',
      endpoint: '/api/create-checkout/test'
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
    
    const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
    
    if (!storeId) {
      return res.status(500).json({
        success: false,
        error: 'Store ID not configured',
        timestamp: new Date().toISOString()
      });
    }

    // Simple test payload
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
              credits: '10',
              test: true
            },
            email: 'test@soundswap.live',
            name: 'Test User'
          },
          test_mode: true
        },
        relationships: {
          store: {
            data: { type: 'stores', id: storeId }
          },
          variant: {
            data: { type: 'variants', id: '1256036' } // cover_starter variant
          }
        }
      }
    };
    
    console.log('[TEST] 📤 Sending test request to Lemon Squeezy...');
    const result = await lemonClient.createCheckoutSession(testPayload);
    
    res.json({
      success: true,
      message: 'Lemon Squeezy API test successful',
      checkoutId: result.data?.id,
      url: result.data?.attributes?.url,
      testMode: result.data?.attributes?.test_mode || false,
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
  const configStatus = {
    lemonSqueezyApiKey: process.env.LEMON_SQUEEZY_API_KEY ? 
      `Configured (${process.env.LEMON_SQUEEZY_API_KEY.substring(0, 10)}...)` : 
      'Missing',
    lemonSqueezyStoreId: process.env.LEMON_SQUEEZY_STORE_ID || 'Missing',
    environment: process.env.NODE_ENV || 'development',
    productsAvailable: Object.keys(PRODUCT_CATALOG).length
  };
  
  console.log('[HEALTH] ❤️ Health check:', configStatus);
  
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'lemon-squeezy-checkout',
    config: configStatus
  });
});

// Debug endpoint
router.get('/debug', (req, res) => {
  console.log('[DEBUG] 🔍 Debug endpoint called');
  
  try {
    const config = {
      lemonSqueezyApiKey: process.env.LEMON_SQUEEZY_API_KEY ? 
        `${process.env.LEMON_SQUEEZY_API_KEY.substring(0, 10)}...` : 'Not configured',
      lemonSqueezyStoreId: process.env.LEMON_SQUEEZY_STORE_ID || 'Not set',
      nodeEnv: process.env.NODE_ENV || 'development',
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'Not set',
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
        testLemon: 'GET /test-lemon',
        health: 'GET /health',
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

// Status endpoint
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
      service: 'lemon-squeezy-checkout',
      status: 'operational',
      configuration: {
        lemonSqueezyApiKey: process.env.LEMON_SQUEEZY_API_KEY ? 'configured' : 'missing',
        lemonSqueezyStoreId: process.env.LEMON_SQUEEZY_STORE_ID ? 'configured' : 'missing',
        environment: process.env.NODE_ENV || 'development'
      },
      services: {
        lemonSqueezyApi: {
          status: process.env.LEMON_SQUEEZY_API_KEY ? 'configured' : 'not_configured',
          message: process.env.LEMON_SQUEEZY_API_KEY ? '✅ API key configured' : '⚠️ API key not configured',
          test: lemonTest
        },
        productCatalog: {
          count: Object.keys(PRODUCT_CATALOG).length,
          message: `✅ ${Object.keys(PRODUCT_CATALOG).length} products available`
        }
      },
      productTypes: {
        coverArt: Object.values(PRODUCT_CATALOG).filter(p => p.creditType === 'coverArt').length,
        lyricVideo: Object.values(PRODUCT_CATALOG).filter(p => p.creditType === 'lyricVideo').length,
        total: Object.keys(PRODUCT_CATALOG).length
      },
      systemInfo: {
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        oneTimePurchases: 'enabled'
      },
      timestamp: new Date().toISOString()
    };
    
    console.log('[INFO] ✅ Status check complete');
    return res.json(statusResponse);
    
  } catch (error) {
    console.error('[ERROR] ❌ Status endpoint error:', error.message);
    return res.status(500).json({
      success: false,
      service: 'lemon-squeezy-checkout',
      status: 'error',
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== STARTUP LOGS ====================

console.log('[INFO] ✅ Lemon Squeezy API Key:', process.env.LEMON_SQUEEZY_API_KEY ? 
  `Configured (${process.env.LEMON_SQUEEZY_API_KEY.substring(0, 10)}...)` : 
  'Not Configured');
console.log('[INFO] 🏪 Lemon Squeezy Store ID:', process.env.LEMON_SQUEEZY_STORE_ID || 'Not Configured');
console.log('[INFO] 📊 Products Available:', Object.keys(PRODUCT_CATALOG).length);
console.log('[INFO] 🎯 Main Endpoint: POST /');
console.log('[INFO] 🧪 Test Endpoint: POST /test');
console.log('[INFO] 🔍 Debug Endpoint: GET /debug');
console.log('[INFO] 📋 Status Endpoint: GET /status');
console.log('[INFO] ✅ All endpoints return proper JSON responses');
console.log('[INFO] 🔧 Environment:', process.env.NODE_ENV || 'development');
console.log('[INFO] 🌐 CORS Enabled for:', [
  'http://localhost:3000',
  'https://soundswap.live',
  '*.vercel.app'
].join(', '));

export default router;