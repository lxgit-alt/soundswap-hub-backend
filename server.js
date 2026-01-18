// server.js - Main Express server (FIXED)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import bodyParser from 'body-parser';

// Use the `VERCEL_INCLUDE_ROUTES=1` env var to enable; otherwise this
// block will not run. Using an env check avoids static "unreachable"
// warnings from linters that flag `if (false)` blocks.
if (process.env.VERCEL_INCLUDE_ROUTES === '1') {
  import('./routes/lemon-webhook.js');
  import('./routes/create-checkout.js');
  import('./routes/reddit-admin.js');
  import('./routes/send-welcome-email.js');
  import('./routes/doodle-art.js');
  import('./routes/generate-video.js');
}

// Load environment variables FIRST
dotenv.config();

// ==================== MODULE LOADING ISOLATION ====================
const MODULE_LOAD_TIMEOUT = 8000;
let loadedModules = {
  firebase: false,
  email: false,
  reddit: false,
  payments: false,
  doodleArt: false
};

// Safe timeout function
const safeSetTimeout = (callback, delay) => {
  const safeDelay = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Number(delay) || 1000));
  if (!Number.isFinite(safeDelay) || safeDelay <= 0) {
    return setTimeout(callback, 1000);
  }
  return setTimeout(callback, safeDelay);
};

// Timeout wrapper
const withTimeout = async (promise, timeoutMs, timeoutMessage = 'Operation timed out') => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = safeSetTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

// ==================== FIREBASE ADMIN INITIALIZATION ====================
let db = null;

// Initialize Firebase in the background to avoid blocking cold-start.
// Endpoints already check for `db` and will return 500 if Firebase
// isn't ready yet — this reduces startup latency in serverless envs.
const initFirebase = async () => {
  if (admin.apps.length) {
    db = admin.firestore();
    loadedModules.firebase = true;
    console.log('🔥 Firebase Admin already initialized');
    return;
  }

  try {
    const firebaseConfig = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };

    if (firebaseConfig.projectId && firebaseConfig.clientEmail && firebaseConfig.privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert(firebaseConfig),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
      db = admin.firestore();
      loadedModules.firebase = true;
      console.log('🔥 Firebase Admin initialized (background)');
    } else {
      console.warn('⚠️ Firebase config incomplete, Firebase Admin not initialized');
      db = null;
    }
  } catch (error) {
    console.error('❌ Firebase Admin initialization error (background):', error.message);
    db = null;
  }
};

// Kick off background initialization (non-blocking)
initFirebase().catch(err => console.error('Firebase background init failed:', err));

const app = express();

// ==================== TIMEZONE CONFIGURATION ====================
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';

const getCurrentTimeInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { 
    timeZone: APP_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).slice(0, 5);
};

const getCurrentDayInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleDateString('en-US', { 
    timeZone: APP_TIMEZONE,
    weekday: 'long'
  }).toLowerCase();
};

// Trust proxy
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// FIXED: CORS configuration - Allow all origins for local development
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
      'https://soundswap.live',
      'https://www.soundswap.live'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      console.log('⚠️ CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'webhook-id', 'webhook-timestamp', 'webhook-signature', 'Origin', 'x-client-id', 'X-Batch-Focus', 'X-Debug-Mode'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400 // 24 hours
}));

// Handle preflight requests
app.options('*', cors());

// ==================== DODO PAYMENTS CONFIGURATION ====================
const validateDodoPaymentsConfig = () => {
  const config = {
    apiKey: process.env.DODO_PAYMENTS_API_KEY,
    webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
    webhookSecret: process.env.DODO_PAYMENTS_WEBHOOK_SECRET,
    environment: process.env.DODO_PAYMENTS_ENV || (process.env.NODE_ENV === 'production' ? 'live' : 'test'),
    publicKey: process.env.DODO_PAYMENTS_PUBLIC_KEY || process.env.NEXT_PUBLIC_DODO_PUBLIC_KEY
  };

  console.log('🔐 Dodo Payments Configuration:');
  console.log(`   - API Key: ${config.apiKey ? '✅ Configured' : '❌ Missing'}`);
  console.log(`   - Webhook Key: ${config.webhookKey ? '✅ Configured' : '⚠️ Missing'}`);
  console.log(`   - Environment: ${config.environment}`);
  console.log(`   - Public Key: ${config.publicKey ? '✅ Configured' : '❌ Missing (Frontend will use CDN)'}`);

  if (!config.apiKey) {
    console.error('❌ CRITICAL: DODO_PAYMENTS_API_KEY is required for checkout functionality');
    console.error('   Get your API key from: https://dashboard.dodopayments.com');
  }

  return config;
};

// Validate on startup
const dodoConfig = validateDodoPaymentsConfig();

// ==================== LAZY ROUTE LOADERS (DEFINED EARLY FOR WEBHOOK) ====================
const createLazyRouter = (modulePath, moduleName) => {
  let router = null;
  let loading = false;
  
  return async (req, res, next) => {
    // Skip loading for cron requests (except reddit)
    if ((req.path.includes('/api/reddit-admin/cron') || req.path.includes('/api/cron-reddit')) && moduleName !== 'reddit') {
      console.log(`[ISOLATION] ⏭️ Skipping ${moduleName} loading for cron`);
      return next();
    }

    // If the automation engine is running, skip non-reddit modules
    if (process.__automation_running && moduleName !== 'reddit') {
      console.log(`[ISOLATION] ⏭️ Skipping ${moduleName} loading due to automation engine`);
      return next();
    }

    // If payments are running, skip non-payments modules
    if (process.__payments_running && moduleName !== 'payments') {
      console.log(`[ISOLATION] ⏭️ Skipping ${moduleName} loading due to payments processing`);
      return next();
    }
    
    if (!router && !loading) {
      try {
        loading = true;
        console.log(`[LAZY-LOAD] 📦 Loading ${moduleName} module...`);
        
        // Resolve module path relative to this file for serverless/bundled environments
        const module = await withTimeout(import('./' + modulePath.replace(/^\.\//, '')), 10000, `Module ${moduleName} load timeout`);
        router = module.default;
        loadedModules[moduleName] = true;
        
        console.log(`[LAZY-LOAD] ✅ ${moduleName} module loaded`);
      } catch (error) {
        console.error(`[LAZY-LOAD] ❌ Failed to load ${moduleName} module:`, error.message);
        router = express.Router();
        router.use((req, res) => {
          res.status(503).json({
            error: `${moduleName} module temporarily unavailable`,
            timestamp: new Date().toISOString()
          });
        });
      } finally {
        loading = false;
      }
    }
    
    if (router) {
      return router(req, res, next);
    } else {
      res.status(503).json({
        error: `Module ${moduleName} is loading, please try again`,
        timestamp: new Date().toISOString()
      });
    }
  };
};

// ==================== WEBHOOK ROUTE (BEFORE BODY PARSERS) ====================
// Mount webhook FIRST before global body parsers to ensure raw body access for signature verification
app.use('/api/lemon-webhook', createLazyRouter('./routes/lemon-webhook.js', 'payments'));

// Body parsing middleware
app.use(bodyParser.json({
  limit: '20mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));

// ==================== ROUTE LOADING MIDDLEWARE ====================
app.use((req, res, next) => {
  const path = req.path;
  
  if (path.includes('/api/reddit-admin/cron') || path.includes('/api/cron-reddit')) {
    console.log('[ISOLATION] 🚫 Cron detected - suppressing non-essential modules');
    loadedModules.email = false;
    loadedModules.payments = false;
    loadedModules.doodleArt = false;
  }
  
  if (path.includes('/api/email')) loadedModules.email = true;
  if (path.includes('/api/create-checkout') || path.includes('/api/lemon-webhook')) loadedModules.payments = true;
  if (path.includes('/api/reddit-admin')) loadedModules.reddit = true;
  if (path.includes('/api/doodle-art') || path.includes('/api/ai-art/generate-ai')) loadedModules.doodleArt = true;
  
  next();
});

// Request logging middleware (for debugging)
app.use((req, res, next) => {
  console.log(`🌐 ${req.method} ${req.path} from ${req.headers.origin || 'unknown'}`);
  next();
});

// ==================== MOUNT ROUTERS ====================

// Mount other routers with lazy loading
app.use('/api/reddit-admin', createLazyRouter('./routes/reddit-admin.js', 'reddit'));
// Add this near line 263 where other reddit-admin routes are mounted
app.use('/api/reddit-admin/cron', bodyParser.json({ limit: '10mb' }), createLazyRouter('./routes/reddit-admin.js', 'reddit'));
app.use('/api/email', createLazyRouter('./routes/send-welcome-email.js', 'email'));
// Mount create-checkout with standard JSON parser
app.use('/api/create-checkout', bodyParser.json({ limit: '20mb' }), createLazyRouter('./routes/create-checkout.js', 'payments'));
app.use('/api/deduct-credits', createLazyRouter('./routes/deduct-credits.js', 'payments'));

// Lyric Video API - lazy loaded to improve cold start
app.use('/api/lyric-video', createLazyRouter('./routes/generate-video.js', 'lyricVideo'));
app.use('/api/generate-video', createLazyRouter('./routes/generate-video.js', 'lyricVideo'));

// Doodle-to-Art API - LAZY LOADED
app.use('/api/doodle-art', createLazyRouter('./routes/doodle-art.js', 'doodleArt'));
app.use('/api/ai-art', createLazyRouter('./routes/doodle-art.js', 'doodleArt'));

// ==================== DODO PAYMENTS CONFIGURATION ENDPOINTS ====================

// Public endpoint for frontend to get Dodo Payments configuration
app.get('/api/dodo-config', (req, res) => {
  try {
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    // Public configuration for frontend (safe to expose)
    const publicConfig = {
      success: true,
      mode: dodoConfig.environment,
      publicKey: dodoConfig.publicKey,
      isTestMode: dodoConfig.environment === 'test' || isDevelopment,
      sdkUrl: dodoConfig.environment === 'live' 
        ? 'https://checkout.dodopayments.com/v1/checkout.js' 
        : 'https://checkout-test.dodopayments.com/v1/checkout.js',
      apiBaseUrl: dodoConfig.environment === 'live'
        ? 'https://api.dodopayments.com/v1'
        : 'https://api-test.dodopayments.com/v1',
      allowedPaymentMethods: ['card', 'apple_pay', 'google_pay'],
      supportedCurrencies: ['USD'],
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    };

    console.log('[DODO-CONFIG] 📋 Providing public Dodo configuration to frontend');
    console.log(`   - Mode: ${publicConfig.mode}`);
    console.log(`   - Public Key: ${publicConfig.publicKey ? 'Provided' : 'Missing'}`);
    console.log(`   - SDK URL: ${publicConfig.sdkUrl}`);
    
    res.json(publicConfig);
  } catch (error) {
    console.error('[DODO-CONFIG] ❌ Error providing configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load payment configuration',
      timestamp: new Date().toISOString()
    });
  }
});

// Private endpoint for admin/status checks
app.get('/api/dodo-config/internal', (req, res) => {
  try {
    // Check for admin authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        timestamp: new Date().toISOString()
      });
    }

    const token = authHeader.split('Bearer ')[1];
    const adminToken = process.env.ADMIN_API_TOKEN;
    
    if (!adminToken || token !== adminToken) {
      return res.status(401).json({
        success: false,
        error: 'Invalid authorization token',
        timestamp: new Date().toISOString()
      });
    }

    // Internal configuration (includes more details)
    const internalConfig = {
      success: true,
      configuration: {
        apiKey: dodoConfig.apiKey ? 'Configured' : 'Missing',
        webhookKey: dodoConfig.webhookKey ? 'Configured' : 'Missing',
        webhookSecret: dodoConfig.webhookSecret ? 'Configured' : 'Missing',
        publicKey: dodoConfig.publicKey ? 'Configured' : 'Missing',
        environment: dodoConfig.environment,
        nodeEnv: process.env.NODE_ENV || 'development'
      },
      endpoints: {
        createCheckout: '/api/create-checkout',
        webhook: '/api/lemon-webhook',
        status: '/api/create-checkout/status',
        test: '/api/payments/test',
        publicConfig: '/api/dodo-config'
      },
      services: {
        firebase: db ? 'Connected' : 'Disconnected',
        webhookValidation: 'Enabled',
        productCatalog: 'Available'
      },
      webhookConfiguration: {
        url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://soundswap.live'}/api/lemon-webhook`,
        events: ['checkout.session.completed', 'checkout.session.expired', 'checkout.session.cancelled'],
        secret: dodoConfig.webhookSecret ? 'Configured' : 'Not configured'
      },
      timestamp: new Date().toISOString()
    };

    console.log('[DODO-CONFIG] 🔐 Providing internal Dodo configuration');
    res.json(internalConfig);
  } catch (error) {
    console.error('[DODO-CONFIG] ❌ Error providing internal configuration:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load internal configuration',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== CREDIT MANAGEMENT ENDPOINTS ====================

// Check user credits
app.post('/api/deduct-credits/check', async (req, res) => {
  try {
    // 1. Validate Body Existence
    if (!req.body) {
      console.warn('[WARN] ⚠️ Request body is missing');
      return res.status(400).json({ error: 'Request body missing' });
    }

    const { userId, type } = req.body;
    console.log(`[INFO] 🔍 Checking credits | User: ${userId} | Type: ${type}`);
    
    // 2. Validate Required Fields
    if (!userId || !type) {
      console.warn('[WARN] ⚠️ Missing required fields for credit check');
      return res.status(400).json({ 
        error: 'Missing required fields',
        timestamp: new Date().toISOString()
      });
    }
    
    // 3. Database Check
    if (!db) {
      console.error('[ERROR] ❌ Firebase not initialized');
      return res.status(503).json({
        success: false,
        error: 'Database unavailable',
        timestamp: new Date().toISOString()
      });
    }
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.warn(`[WARN] ⚠️ User not found: ${userId}`);
      return res.status(404).json({ 
        error: 'User not found',
        timestamp: new Date().toISOString()
      });
    }
    
    const userData = userDoc.data();
    let credits = 0;
    
    // 4. Safe Credit Retrieval (Handle undefined values)
    // FIXED: Use correct field names
    if (type === 'coverArt') {
      credits = userData.coverArtCredits || userData.points || 0; // Check both for backward compatibility
    } else if (type === 'lyricVideo') {
      credits = userData.lyricVideoCredits || 0;
    } else {
        console.warn(`[WARN] ⚠️ Unknown credit type requested: ${type}`);
        credits = 0;
    }
    
    console.log(`[INFO] ✅ Credits check: ${credits} ${type} credits available`);
    
    return res.json({
      success: true,
      credits,
      type,
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] ❌ Exception in /api/deduct-credits/check:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal Server Error during credit check',
      details: error.message, 
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== DEDUCT CREDITS ENDPOINT ====================
// This forwards to the create-checkout.js router which has the proper implementation
app.post('/api/deduct-credits', bodyParser.json({ limit: '10mb' }), async (req, res) => {
  try {
    // Get the lazy router for create-checkout
    const lazyRouter = createLazyRouter('./routes/create-checkout.js', 'payments');
    
    // Modify the request to match the create-checkout router's expected path
    const originalUrl = req.originalUrl;
    const originalPath = req.path;
    
    // Store original values
    req._originalUrl = originalUrl;
    req._originalPath = originalPath;
    
    // Update to match the create-checkout router's internal route
    req.url = '/deduct-credits';
    req.originalUrl = '/create-checkout/deduct-credits';
    req.path = '/deduct-credits';
    
    console.log(`[ROUTE-FORWARD] 🔄 Forwarding /api/deduct-credits to create-checkout router`);
    
    // Create a custom response handler
    const originalJson = res.json;
    const originalStatus = res.status;
    
    let responseSent = false;
    
    // Override res.json to capture the response
    res.json = function(data) {
      if (!responseSent) {
        responseSent = true;
        console.log(`[ROUTE-FORWARD] ✅ Response from create-checkout router:`, 
          data.success ? 'Success' : 'Failed');
        return originalJson.call(this, data);
      }
    };
    
    // Override res.status
    res.status = function(code) {
      if (!responseSent) {
        return {
          json: function(data) {
            responseSent = true;
            console.log(`[ROUTE-FORWARD] ✅ Response with status ${code}:`, 
              data.success ? 'Success' : 'Failed');
            return originalJson.call(res, data);
          }
        };
      }
      return this;
    };
    
    // Call the lazy router
    await lazyRouter(req, res, (error) => {
      if (error) {
        console.error('[ROUTE-FORWARD] ❌ Error in lazy router:', error);
        if (!responseSent) {
          res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message,
            timestamp: new Date().toISOString()
          });
        }
      } else if (!responseSent) {
        // If the router didn't send a response
        res.status(404).json({
          success: false,
          error: 'Endpoint not found in create-checkout router',
          timestamp: new Date().toISOString()
        });
      }
    });
    
  } catch (error) {
    console.error('[ROUTE-FORWARD] ❌ Error forwarding request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to forward request to credit service',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get credit balance
app.get('/api/deduct-credits/credits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!db) return res.status(503).json({ error: 'Database unavailable' });
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    
    return res.json({
      success: true,
      userId,
      credits: {
        coverArt: userData.coverArtCredits || userData.points || 0, // Updated field name
        lyricVideo: userData.lyricVideoCredits || 0,
        subscription: userData.subscription || 'free',
        founderPoints: userData.founderPoints || 0
      },
      subscription: {
        status: userData.subscriptionStatus || 'none',
        plan: userData.subscriptionVariant || 'none',
        id: userData.subscriptionId || 'none',
        monthlyCredits: {
          coverArt: userData.monthlyCoverArtCredits || 0,
          lyricVideo: userData.monthlyLyricVideoCredits || 0
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error getting credit balance:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== DODO PAYMENTS STATUS ENDPOINTS ====================

app.get('/api/create-checkout/status', (req, res) => {
  console.log('[INFO] 🔍 Checking Dodo Payments service status');
  res.json({
    success: true,
    service: 'dodo-payments',
    status: dodoConfig.apiKey ? 'active' : 'inactive',
    configuration: {
      dodoApiKey: dodoConfig.apiKey ? 'configured' : 'missing',
      dodoWebhookKey: dodoConfig.webhookKey ? 'configured' : 'missing',
      dodoPublicKey: dodoConfig.publicKey ? 'configured' : 'missing',
      environment: dodoConfig.environment,
      firebase: db ? 'connected' : 'disconnected'
    },
    publicConfigEndpoint: '/api/dodo-config',
    endpoints: {
      create_checkout: 'POST /api/create-checkout',
      checkout_status: 'GET /api/create-checkout/status',
      checkout_products: 'GET /api/create-checkout/products',
      transactions: 'GET /api/create-checkout/transactions/:userId',
      purchases: 'GET /api/create-checkout/purchases/:userId',
      createCheckout: 'POST /api/create-checkout',
      webhook: 'POST /api/lemon-webhook',
      testWebhook: 'POST /api/lemon-webhook/simulate',
      webhookStatus: 'GET /api/lemon-webhook/status',
      products: 'GET /api/create-checkout/products',
      testDodo: 'GET /api/create-checkout/test-dodo'
    },
    timestamp: new Date().toISOString()
  });
});

// Test Dodo API connection
app.get('/api/payments/test', async (req, res) => {
  try {
    console.log('[INFO] 🧪 Testing Dodo API connection');
    
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    
    if (!DODO_API_KEY) {
      console.error('[ERROR] ❌ Dodo API key not configured');
      return res.status(500).json({
        success: false,
        error: 'Dodo API key not configured',
        timestamp: new Date().toISOString()
      });
    }
    
    const apiUrl = dodoConfig.environment === 'live' 
      ? 'https://api.dodopayments.com/v1/account' 
      : 'https://api-test.dodopayments.com/v1/account';
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`
      }
    });
    
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
          mode: result.mode || dodoConfig.environment
        },
        timestamp: new Date().toISOString()
      });
    } else {
      const error = await response.json();
      console.error('[ERROR] ❌ Dodo API connection failed:', error.message || 'Unknown error');
      res.status(response.status).json({
        success: false,
        error: error.message || 'Dodo API connection failed',
        details: error,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('[ERROR] ❌ Dodo API test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== CRITICAL WATCH ITEM ENDPOINTS ====================

// Shadow-delete check endpoint (standalone for manual testing)
app.get('/api/shadow-check', async (req, res) => {
  try {
    console.log('[SHADOW-CHECK] 🔍 Manual shadow-delete check requested');
    
    // Dynamically load the reddit admin module
    const redditModule = await import('./routes/reddit-admin.js');
    const redditRouter = redditModule.default;
    
    // Create a wrapped request for the shadow-check endpoint
    const shadowReq = {
      ...req,
      method: 'GET',
      path: '/api/reddit-admin/shadow-check-list'
    };
    
    let shadowResponse = null;
    const shadowRes = {
      json: (data) => {
        shadowResponse = data;
      },
      status: (code) => {
        return {
          json: (data) => {
            shadowResponse = data;
          }
        };
      }
    };
    
    await new Promise((resolve, reject) => {
      redditRouter(shadowReq, shadowRes, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    if (shadowResponse) {
      res.json(shadowResponse);
    } else {
      res.status(404).json({
        success: false,
        error: 'Shadow-check endpoint not found',
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('[SHADOW-CHECK] ❌ Error in shadow-check:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check shadow-delete status',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health monitor endpoint (standalone for monitoring)
app.get('/api/reddit-admin/health-monitor', async (req, res) => {
  try {
    console.log('[HEALTH-MONITOR] 🔍 Manual health monitor check requested');
    
    // Dynamically load the reddit admin module
    const redditModule = await import('./routes/reddit-admin.js');
    const redditRouter = redditModule.default;
    
    // Create a wrapped request for the health-monitor endpoint
    const monitorReq = {
      ...req,
      method: 'GET',
      path: '/api/reddit-admin/health-monitor'
    };
    
    let monitorResponse = null;
    const monitorRes = {
      json: (data) => {
        monitorResponse = data;
      },
      status: (code) => {
        return {
          json: (data) => {
            monitorResponse = data;
          }
        };
      }
    };
    
    await new Promise((resolve, reject) => {
      redditRouter(monitorReq, monitorRes, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    if (monitorResponse) {
      res.json(monitorResponse);
    } else {
      res.status(404).json({
        success: false,
        error: 'Health monitor endpoint not found',
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('[HEALTH-MONITOR] ❌ Error in health monitor:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get health monitor status',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== CRON ISOLATION ENDPOINTS ====================

app.get('/api/module-status', (req, res) => {
  res.json({
    success: true,
    modules: loadedModules,
    timestamp: new Date().toISOString(),
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// Isolate modules for cron
const isolateCronExecution = async () => {
  console.log('[ISOLATION] 🔒 Isolating Reddit cron execution');
  loadedModules.email = false;
  loadedModules.payments = false;
  loadedModules.doodleArt = false;
  return true;
};

// Restore modules after cron
const restoreModulesAfterCron = () => {
  console.log('[ISOLATION] 🔄 Restoring modules after cron completion');
  return true;
};

app.post('/api/isolate-for-cron', async (req, res) => {
  try {
    await isolateCronExecution();
    res.json({
      success: true,
      message: 'Modules isolated for cron execution',
      isolated: true,
      modules: loadedModules,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== ISOLATED CRON ENDPOINT WITH BATCH SUPPORT ====================

app.post('/api/cron-reddit', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Quick auth check
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized',
        timestamp: new Date().toISOString()
      });
    }

    console.log('[CRON-ISOLATED] 🚀 Starting isolated Reddit cron execution');
    
    // Extract batch focus from headers or body
    const batchFocus = req.headers['x-batch-focus'] || req.body?.batchFocus || 'all';
    const debugMode = req.headers['x-debug-mode'] === 'true' || req.body?.debugMode === true;
    
    console.log(`[CRON-ISOLATED] 🎭 Batch focus: ${batchFocus}, Debug: ${debugMode}`);
    
    // Isolate modules for cron
    await isolateCronExecution();
    
    // Dynamically load ONLY the reddit admin module
    const redditModule = await withTimeout(
      import('./routes/reddit-admin.js'), 
      3000, 
      'Reddit module load timeout'
    );
    
    const redditRouter = redditModule.default;
    
    // Create enhanced request wrapper with batch focus
    const cronReq = {
      ...req,
      method: 'POST',
      path: '/cron',
      headers: {
        ...req.headers,
        'x-isolated-cron': 'true',
        'x-batch-focus': batchFocus,
        'x-debug-mode': debugMode.toString()
      },
      body: {
        ...req.body,
        batchFocus,
        debugMode
      }
    };
    
    // Create response wrapper
    let cronResponse = null;
    const cronRes = {
      json: (data) => {
        cronResponse = data;
      },
      status: (code) => {
        return {
          json: (data) => {
            cronResponse = data;
          }
        };
      }
    };
    
    // Execute the cron with timeout
    await withTimeout(
      new Promise((resolve, reject) => {
        redditRouter(cronReq, cronRes, (err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
      25000, // Increased timeout for batched orchestration
      'Cron execution timeout'
    );
    
    // Restore modules
    restoreModulesAfterCron();
    
    const processingTime = Date.now() - startTime;
    console.log(`[CRON-ISOLATED] ✅ Cron completed in ${processingTime}ms`);
    console.log(`[CRON-ISOLATED] 📊 Results: ${cronResponse?.totalPosted || 0} posts, ${cronResponse?.premiumLeads || 0} leads`);
    
    res.json({
      ...cronResponse,
      isolated: true,
      processingTime: processingTime,
      batchFocus: batchFocus,
      debugMode: debugMode,
      modulesLoaded: loadedModules,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[CRON-ISOLATED] ❌ Error in isolated cron:', error);
    
    // Restore modules even on error
    restoreModulesAfterCron();
    
    const processingTime = Date.now() - startTime;
    
    res.json({
      success: false,
      message: 'Cron execution failed',
      error: error.message,
      isolated: true,
      processingTime: processingTime,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== ENDPOINTS ====================

// Health check endpoint - cron safe
app.get('/api/health', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.status(200).json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    version: '2.3.0',
    cronSafe: true,
    moduleLoading: 'isolated',
    paymentGateway: dodoConfig.apiKey ? 'Dodo Payments (Active)' : 'Dodo Payments (Inactive)',
    services: {
      reddit_automation: 'available',
      cron_scheduler: 'running',
      module_isolation: 'active',
      batched_orchestration: 'enabled',
      payment_processing: dodoConfig.apiKey ? 'enabled' : 'disabled'
    },
    batched_automation: {
      strategy: '4-Batch Rotation',
      subreddits: 20,
      human_window: '12:00-22:00 UTC',
      discord_threshold: 'Score > 85',
      shadow_delete_monitoring: 'active'
    }
  });
});

// Simple health endpoint (alias)
app.get('/health', (req, res) => {
  res.redirect('/api/health');
});

// Enhanced API status endpoint
app.get('/api/status', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.json({
    success: true,
    service: 'soundswap-backend',
    status: 'operational',
    version: '2.3.0',
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timestamp: new Date().toISOString(),
    paymentConfiguration: {
      gateway: 'Dodo Payments',
      status: dodoConfig.apiKey ? 'configured' : 'not configured',
      mode: dodoConfig.environment,
      publicConfigEndpoint: '/api/dodo-config'
    },
    endpoints: {
      health: '/api/health',
      status: '/api/status',
      dodo_config: '/api/dodo-config',
      isolated_cron: 'POST /api/cron-reddit (For GitHub Actions)',
      shadow_check: 'GET /api/shadow-check (Manual verification)',
      health_monitor: 'GET /api/reddit-admin/health-monitor (System monitoring)',
      email: '/api/email/send-welcome-email',
      reddit_admin: '/api/reddit-admin/admin',
      lyric_video: '/api/lyric-video',
      generate_video: '/api/generate-video',
      doodle_art: '/api/doodle-art/generate',
      ai_art: '/api/ai-art/generate-ai',
      gemini_ai: '/api/reddit-admin/generate-comment',
      automation: '/api/reddit-admin/cron-status',
      reddit_api_test: '/api/reddit-admin/test-reddit',
      cron: '/api/reddit-admin/cron (POST)',
      premium_analytics: '/api/reddit-admin/premium-analytics',
      generate_premium_content: '/api/reddit-admin/generate-premium-content',
      optimized_schedule: '/api/reddit-admin/optimized-schedule',
      post_premium_feature: '/api/reddit-admin/post-premium-feature',
      reset_daily: '/api/reddit-admin/reset-daily',
      create_checkout: 'POST /api/create-checkout',
      lemon_webhook: 'POST /api/lemon-webhook',
      checkout_status: 'GET /api/create-checkout/status',
      payment_test: 'GET /api/payments/test',
      check_credits: 'POST /api/deduct-credits/check',
      deduct_credits: 'POST /api/deduct-credits',
      get_transactions: 'GET /api/deduct-credits/transactions/:userId',
      get_balance: 'GET /api/deduct-credits/credits/:userId',
      get_purchases: 'GET /api/deduct-credits/purchases/:userId'
    },
    batched_automation_endpoints: {
      shadow_delete_check: 'GET /api/reddit-admin/shadow-check-list',
      health_monitor: 'GET /api/reddit-admin/health-monitor',
      batch_targets: 'GET /api/reddit-admin/targets',
      today_schedule: 'GET /api/reddit-admin/schedule/today',
      cron_status: 'GET /api/reddit-admin/cron-status'
    },
    payment_api_endpoints: {
      create_checkout: 'POST /api/create-checkout - Create a checkout session',
      checkout_status: 'GET /api/create-checkout/status - Check payment service status',
      dodo_config: 'GET /api/dodo-config - Get public payment configuration',
      payment_test: 'GET /api/payments/test - Test Dodo API connection',
      webhook: 'POST /api/lemon-webhook - Payment webhook endpoint',
      products: 'GET /api/create-checkout/products - Get available products'
    },
    video_generation_api: {
      generate_video: 'POST /api/generate-video',
      generate_video_optimized: 'POST /api/generate-video/optimized',
      regular_job_status: 'GET /api/generate-video?action=status&jobId={jobId}',
      optimized_job_status: 'GET /api/generate-video/optimized/status?jobId={jobId}',
      storage_usage: 'GET /api/generate-video/storage-usage',
      manual_cleanup: 'POST /api/generate-video/manual-cleanup',
      cleanup_expired_videos: 'GET /api/generate-video/cleanup-expired-videos',
      physics_animations: 'GET /api/generate-video/physics-animations',
      webhook_callback: 'POST /api/generate-video?action=webhook'
    },
    doodle_to_art_api: {
      generate: 'POST /api/doodle-art/generate',
      test: 'GET /api/doodle-art/test',
      features: {
        model: 'ControlNet Scribble',
        creativity_slider: '0.1 (creative) to 1.0 (strict)',
        nsfw_filter: 'enabled',
        cost: '$0.30 - $0.50 per credit',
        speed: '5-8 seconds',
        text_warning: 'AI may not render text accurately'
      }
    },
    credit_management_api: {
      check_credits: 'POST /api/deduct-credits/check - Check user credit balance',
      deduct_credits: 'POST /api/deduct-credits - Deduct credits for generation',
      get_transactions: 'GET /api/deduct-credits/transactions/:userId - Get transaction history',
      get_balance: 'GET /api/deduct-credits/credits/:userId - Get complete credit balance'
    },
    reddit_premium_endpoints: {
      premium_analytics: 'GET /api/reddit-admin/premium-analytics - Track premium lead generation',
      generate_premium_content: 'POST /api/reddit-admin/generate-premium-content - Generate premium-focused content',
      optimized_schedule: 'GET /api/reddit-admin/optimized-schedule - View optimized posting schedule',
      post_premium_feature: 'POST /api/reddit-admin/post-premium-feature - Manual premium feature post',
      reset_daily: 'POST /api/reddit-admin/reset-daily - Manual daily reset'
    },
    ai_features: {
      comment_generation: 'active',
      dm_replies: 'active',
      post_analysis: 'active',
      audio_analysis: 'active',
      lyric_enhancement: 'active',
      doodle_to_art: 'active',
      automation_system: 'active',
      cron_scheduler: 'running',
      vercel_cron: 'active',
      educational_posts: 'active',
      top50_promotion: 'active',
      chart_notifications: 'active',
      reddit_api: 'live',
      premium_feature_focus: 'active',
      credit_system: 'active',
      payment_processing: dodoConfig.apiKey ? 'active' : 'inactive'
    },
    batched_orchestration_features: {
      version: '8.0.0',
      strategy: '4-Batch Rotation',
      subreddits: 20,
      batches: ['A: Feedback Loop', 'B: Visual Showdown', 'C: Problem Solvers', 'D: Growth Hackers'],
      human_window: '12:00-22:00 UTC',
      discord_threshold: 'Score > 85',
      industry_authority: '80% expert advice, 20% promotion',
      rate_limit_protection: 'Exponential backoff with jitter',
      shadow_delete_monitoring: '30% check probability',
      critical_alerts: 'Active'
    },
    critical_monitoring: {
      shadow_delete_checks: 'Weekly manual verification recommended',
      batch_c_focus: 'Prioritize Batch C comment verification',
      rate_limit_monitoring: 'Automatic exponential backoff',
      discord_signal_noise: 'High-priority leads only (Score > 85)',
      payment_gateway: dodoConfig.apiKey ? 'Active - Monitor webhooks' : 'Inactive - Configuration required'
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '2.3.0',
    environment: 'production',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay.toLowerCase(),
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      status: '/api/status',
      dodo_config: '/api/dodo-config',
      isolated_cron: 'POST /api/cron-reddit (GitHub Actions)',
      shadow_check: 'GET /api/shadow-check (Critical monitoring)',
      health_monitor: 'GET /api/reddit-admin/health-monitor (System health)',
      email: '/api/email/send-welcome-email',
      reddit_admin: '/api/reddit-admin/admin',
      lyric_video: '/api/lyric-video',
      generate_video: '/api/generate-video',
      doodle_art: '/api/doodle-art/generate',
      ai_art: '/api/ai-art/generate-ai',
      gemini_ai: '/api/reddit-admin/generate-comment',
      automation: '/api/reddit-admin/cron-status',
      reddit_api_test: '/api/reddit-admin/test-reddit',
      cron: '/api/reddit-admin/cron (POST)',
      premium_analytics: '/api/reddit-admin/premium-analytics',
      generate_premium_content: '/api/reddit-admin/generate-premium-content',
      optimized_schedule: '/api/reddit-admin/optimized-schedule',
      post_premium_feature: '/api/reddit-admin/post-premium-feature',
      reset_daily: '/api/reddit-admin/reset-daily',
      create_checkout: 'POST /api/create-checkout',
      lemon_webhook: 'POST /api/lemon-webhook',
      checkout_status: 'GET /api/create-checkout/status',
      payment_test: 'GET /api/payments/test',
      check_credits: 'POST /api/deduct-credits/check',
      deduct_credits: 'POST /api/deduct-credits',
      get_transactions: 'GET /api/deduct-credits/transactions/:userId',
      get_balance: 'GET /api/deduct-credits/credits/:userId'
    },
    batched_automation: {
      strategy: '4-Batch Rotation System',
      total_subreddits: 20,
      schedule: 'Every 15 minutes, 12:00-22:00 UTC',
      batches: [
        'A: Feedback Loop (Morning/Trust Building)',
        'B: Visual Showdown (Mid-Day/High Impact OC)',
        'C: Problem Solvers (Afternoon/Direct Utility)',
        'D: Growth Hackers (Evening/Marketing & ROI)'
      ],
      critical_features: [
        'Discord High-Priority Filter (Score > 85)',
        'Shadow-Delete Detection System',
        'Rate Limit Protection with Exponential Backoff',
        '80/20 Industry Authority Strategy',
        'Human Window Enforcement (12:00-22:00 UTC)'
      ]
    },
    payment_system: {
      gateway: 'Dodo Payments',
      status: dodoConfig.apiKey ? 'Active' : 'Configuration required',
      mode: dodoConfig.environment,
      public_config: 'GET /api/dodo-config'
    },
    video_generation_api: {
      generate_video: 'POST /api/generate-video',
      generate_video_optimized: 'POST /api/generate-video/optimized',
      regular_job_status: 'GET /api/generate-video?action=status&jobId={jobId}',
      optimized_job_status: 'GET /api/generate-video/optimized/status?jobId={jobId}',
      storage_usage: 'GET /api/generate-video/storage-usage',
      manual_cleanup: 'POST /api/generate-video/manual-cleanup',
      cleanup_expired_videos: 'GET /api/generate-video/cleanup-expired-videos',
      physics_animations: 'GET /api/generate-video/physics-animations',
      webhook_callback: 'POST /api/generate-video?action=webhook'
    },
    doodle_to_art_api: {
      generate: 'POST /api/doodle-art/generate',
      test: 'GET /api/doodle-art/test',
      features: {
        model: 'ControlNet Scribble',
        creativity_slider: '0.1 (creative) to 1.0 (strict)',
        nsfw_filter: 'enabled',
        cost: '$0.30 - $0.50 per credit',
        speed: '5-8 seconds',
        text_warning: 'AI may not render text accurately'
      }
    },
    credit_management_api: {
      check_credits: 'POST /api/deduct-credits/check - Check user credit balance',
      deduct_credits: 'POST /api/deduct-credits - Deduct credits for generation',
      get_transactions: 'GET /api/deduct-credits/transactions/:userId - Get transaction history',
      get_balance: 'GET /api/deduct-credits/credits/:userId - Get complete credit balance'
    },
    reddit_premium_endpoints: {
      premium_analytics: 'GET /api/reddit-admin/premium-analytics - Track premium lead generation',
      generate_premium_content: 'POST /api/reddit-admin/generate-premium-content - Generate premium-focused content',
      optimized_schedule: 'GET /api/reddit-admin/optimized-schedule - View optimized posting schedule',
      post_premium_feature: 'POST /api/reddit-admin/post-premium-feature - Manual premium feature post',
      reset_daily: 'POST /api/reddit-admin/reset-daily - Manual daily reset'
    },
    ai_features: {
      comment_generation: 'active',
      dm_replies: 'active',
      post_analysis: 'active',
      audio_analysis: 'active',
      lyric_enhancement: 'active',
      doodle_to_art: 'active',
      automation_system: 'active',
      cron_scheduler: 'running',
      vercel_cron: 'active',
      educational_posts: 'active',
      top50_promotion: 'active',
      chart_notifications: 'active',
      reddit_api: 'live',
      premium_feature_focus: 'active',
      credit_system: 'active',
      payment_processing: dodoConfig.apiKey ? 'active' : 'inactive'
    }
  });
});

// Handle 404
app.use('*', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    availableEndpoints: [
      '/api/health',
      '/health',
      '/api/status',
      '/api/dodo-config',
      '/api/cron-reddit (POST)',
      '/api/shadow-check (Critical monitoring)',
      '/api/reddit-admin/health-monitor (System health)',
      '/api/email/send-welcome-email',
      '/api/reddit-admin/admin',
      '/api/lyric-video',
      '/api/generate-video',
      '/api/doodle-art/generate',
      '/api/ai-art/generate-ai',
      '/api/reddit-admin/generate-comment',
      '/api/reddit-admin/cron-status',
      '/api/reddit-admin/test-reddit',
      '/api/reddit-admin/cron (POST)',
      '/api/reddit-admin/premium-analytics',
      '/api/reddit-admin/generate-premium-content',
      '/api/reddit-admin/optimized-schedule',
      '/api/reddit-admin/post-premium-feature',
      '/api/reddit-admin/reset-daily',
      '/api/create-checkout',
      '/api/lemon-webhook',
      '/api/create-checkout/status',
      '/api/payments/test',
      '/api/deduct-credits/check (POST)',
      '/api/deduct-credits (POST)',
      '/api/deduct-credits/transactions/:userId',
      '/api/deduct-credits/credits/:userId',
      '/api/deduct-credits/purchases/:userId'
    ],
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error.message);
  console.error(error.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// For Vercel serverless functions, export the app
export default app;

// For local development
const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();

    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`⏰ Timezone: ${APP_TIMEZONE}`);
    console.log(`📅 Current time: ${currentTime} on ${currentDay}`);
    console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
    console.log(`🔒 Isolated cron: POST http://localhost:${PORT}/api/cron-reddit`);
    console.log(`👁️  Shadow-check: GET http://localhost:${PORT}/api/shadow-check`);
    console.log(`📊 Health monitor: GET http://localhost:${PORT}/api/reddit-admin/health-monitor`);
    console.log(`🔧 Module status: GET http://localhost:${PORT}/api/module-status`);
    console.log(`💰 Payment config: GET http://localhost:${PORT}/api/dodo-config`);
    console.log(`🌐 CORS enabled for: localhost:3000, localhost:3001, soundswap.live`);
    console.log(`🎭 Batched Orchestration: 20 subreddits, 4 batches, Discord threshold: Score > 85`);
    
    // Log Dodo Payments configuration status
    console.log('\n🔐 Dodo Payments Configuration:');
    console.log(`   - API Key: ${dodoConfig.apiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   - Public Key: ${dodoConfig.publicKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   - Environment: ${dodoConfig.environment}`);
    console.log(`   - Configuration endpoint: http://localhost:${PORT}/api/dodo-config`);
  });
}