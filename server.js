import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import bodyParser from 'body-parser';

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
let db;
if (!admin.apps.length) {
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
      console.log('🔥 Firebase Admin initialized');
      db = admin.firestore();
      loadedModules.firebase = true;
    } else {
      console.warn('⚠️ Firebase config incomplete, Firebase Admin not initialized');
      db = null;
    }
  } catch (error) {
    console.error('❌ Firebase Admin initialization error:', error.message);
    db = null;
  }
} else {
  db = admin.firestore();
  console.log('🔥 Firebase Admin already initialized');
  loadedModules.firebase = true;
}

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

// CORS configuration
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'webhook-id', 'webhook-timestamp', 'webhook-signature']
}));

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
  if (path.includes('/api/doodle-art') || path.includes('/api/ai-art')) loadedModules.doodleArt = true;
  
  next();
});

// ==================== LAZY ROUTE LOADERS ====================
const createLazyRouter = (modulePath, moduleName) => {
  let router = null;
  let loading = false;
  
  return async (req, res, next) => {
    // Skip loading for cron requests (except reddit)
    if ((req.path.includes('/api/reddit-admin/cron') || req.path.includes('/api/cron-reddit')) && 
        moduleName !== 'reddit') {
      console.log(`[ISOLATION] ⏭️ Skipping ${moduleName} loading for cron`);
      return next();
    }
    
    if (!router && !loading) {
      try {
        loading = true;
        console.log(`[LAZY-LOAD] 📦 Loading ${moduleName} module from ${modulePath}...`);
        
        // Try multiple path variations since we're in a serverless environment
        const pathVariations = [
          modulePath,  // Original path
          modulePath.startsWith('./') ? modulePath.substring(2) : `./${modulePath}`, // Remove/add ./
          modulePath.includes('backend/') ? modulePath : `./backend/${modulePath}`, // Add backend/
          modulePath.includes('backend/') ? modulePath.substring(9) : `backend/${modulePath}`, // Remove/add backend/
          `./${modulePath.replace('./', '')}`, // Ensure starts with ./
        ];
        
        let importError = null;
        
        for (const tryPath of pathVariations) {
          try {
            console.log(`[LAZY-LOAD] 🔄 Trying path: ${tryPath}`);
            const module = await withTimeout(import(tryPath), 3000, `Module ${moduleName} load timeout`);
            router = module.default;
            loadedModules[moduleName] = true;
            console.log(`[LAZY-LOAD] ✅ ${moduleName} module loaded successfully from ${tryPath}`);
            break; // Exit loop on success
          } catch (error) {
            importError = error;
            console.log(`[LAZY-LOAD] ❌ Path ${tryPath} failed:`, error.message);
            continue; // Try next path
          }
        }
        
        if (!router) {
          console.error(`[LAZY-LOAD] ❌ All import attempts failed for ${moduleName}:`, importError?.message);
          throw new Error(`Could not load ${moduleName} module from any path. Last error: ${importError?.message}`);
        }
      } catch (error) {
        console.error(`[LAZY-LOAD] ❌ Failed to load ${moduleName} module:`, error.message);
        
        // Create a minimal router for the module
        router = express.Router();
        
        // Add basic routes for the specific module
        if (moduleName === 'payments') {
          console.log(`[LAZY-LOAD] 🛠️ Creating minimal router for ${moduleName}`);
          
          // For lemon-webhook routes
          if (modulePath.includes('lemon-webhook')) {
            router.post('/', (req, res) => {
              res.status(503).json({
                error: 'Payment webhook service temporarily unavailable',
                message: 'The payment webhook module failed to load',
                timestamp: new Date().toISOString()
              });
            });
            
            router.get('/test', (req, res) => {
              res.json({
                success: false,
                message: 'Payment webhook module not loaded',
                error: 'Module failed to load',
                timestamp: new Date().toISOString()
              });
            });
            
            router.get('/status', (req, res) => {
              res.json({
                success: false,
                service: 'dodo-payments-webhook',
                status: 'module-load-failed',
                timestamp: new Date().toISOString()
              });
            });
          }
          
          // For create-checkout routes
          if (modulePath.includes('create-checkout')) {
            router.post('/', (req, res) => {
              res.status(503).json({
                error: 'Checkout service temporarily unavailable',
                message: 'The checkout module failed to load',
                timestamp: new Date().toISOString()
              });
            });
            
            router.get('/products', (req, res) => {
              res.json({
                success: false,
                message: 'Checkout module not loaded',
                products: [],
                timestamp: new Date().toISOString()
              });
            });
            
            router.get('/test', (req, res) => {
              res.json({
                success: false,
                message: 'Checkout module not loaded',
                timestamp: new Date().toISOString()
              });
            });
          }
        } else {
          // Generic fallback for other modules
          router.use((req, res) => {
            res.status(503).json({
              error: `${moduleName} module temporarily unavailable`,
              timestamp: new Date().toISOString()
            });
          });
        }
        
        loadedModules[moduleName] = false;
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

// ==================== MOUNT ROUTERS ====================

// Mount webhook first (needs raw body access)
app.use('/api/lemon-webhook', createLazyRouter('./backend/api/lemon-webhook.js', 'payments'));

// Mount other routers with lazy loading
app.use('/api/reddit-admin', createLazyRouter('./backend/api/reddit-admin.js', 'reddit'));
app.use('/api/email', createLazyRouter('./backend/api/send-welcome-email.js', 'email'));
app.use('/api/create-checkout', createLazyRouter('./backend/api/create-checkout.js', 'payments'));

// Lyric Video API - load immediately (not in the issue)
import lyricVideoRoutes from './backend/api/generate-video.js';
app.use('/api/lyric-video', lyricVideoRoutes);
app.use('/api/generate-video', lyricVideoRoutes);

// Doodle-to-Art API - LAZY LOADED
app.use('/api/doodle-art', createLazyRouter('./backend/api/doodle-art.js', 'doodleArt'));
app.use('/api/ai-art', createLazyRouter('./backend/api/doodle-art.js', 'doodleArt'));

// ==================== CREDIT MANAGEMENT ENDPOINTS ====================

// Check user credits
app.post('/api/check-credits', async (req, res) => {
  try {
    const { userId, type } = req.body;
    
    if (!userId || !type) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        timestamp: new Date().toISOString()
      });
    }
    
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Firebase not initialized',
        timestamp: new Date().toISOString()
      });
    }
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: 'User not found',
        timestamp: new Date().toISOString()
      });
    }
    
    const userData = userDoc.data();
    let credits = 0;
    
    if (type === 'coverArt') {
      credits = userData.points || 0;
    } else if (type === 'lyricVideo') {
      credits = userData.lyricVideoCredits || 0;
    }
    
    res.json({
      success: true,
      credits,
      type,
      userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error checking credits:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Deduct credits
app.post('/api/deduct-credits', async (req, res) => {
  try {
    const { userId, type, amount, reason } = req.body;
    
    if (!userId || !type || !amount) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        timestamp: new Date().toISOString()
      });
    }
    
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Firebase not initialized',
        timestamp: new Date().toISOString()
      });
    }
    
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: 'User not found',
        timestamp: new Date().toISOString()
      });
    }
    
    const userData = userDoc.data();
    let fieldToUpdate = '';
    let currentCredits = 0;
    
    if (type === 'coverArt') {
      fieldToUpdate = 'points';
      currentCredits = userData.points || 0;
    } else if (type === 'lyricVideo') {
      fieldToUpdate = 'lyricVideoCredits';
      currentCredits = userData.lyricVideoCredits || 0;
    } else {
      return res.status(400).json({ 
        error: 'Invalid credit type',
        timestamp: new Date().toISOString()
      });
    }
    
    if (currentCredits < amount) {
      return res.status(400).json({ 
        success: false,
        error: 'Insufficient credits',
        required: amount,
        available: currentCredits,
        timestamp: new Date().toISOString()
      });
    }
    
    const newCredits = currentCredits - amount;
    
    await userRef.update({
      [fieldToUpdate]: newCredits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const transactionRef = db.collection('credit_transactions').doc();
    await transactionRef.set({
      userId,
      type: 'deduction',
      creditType: type,
      amount: -amount,
      reason: reason || 'generation',
      remaining: newCredits,
      date: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: Date.now()
    });
    
    res.json({
      success: true,
      type,
      deducted: amount,
      remaining: newCredits,
      transactionId: transactionRef.id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error deducting credits:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get transaction history
app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, type } = req.query;
    
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Firebase not initialized',
        timestamp: new Date().toISOString()
      });
    }
    
    let query = db.collection('credit_transactions')
      .where('userId', '==', userId)
      .orderBy('date', 'desc')
      .limit(parseInt(limit));
    
    if (type) {
      query = query.where('creditType', '==', type);
    }
    
    const snapshot = await query.get();
    const transactions = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      transactions.push({
        id: doc.id,
        ...data,
        date: data.date?.toDate?.()?.toISOString() || data.date
      });
    });
    
    res.json({ 
      success: true,
      transactions,
      count: transactions.length,
      userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error fetching transactions:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get credit balance
app.get('/api/credits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Firebase not initialized',
        timestamp: new Date().toISOString()
      });
    }
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: 'User not found',
        timestamp: new Date().toISOString()
      });
    }
    
    const userData = userDoc.data();
    
    res.json({
      success: true,
      userId,
      credits: {
        coverArt: userData.points || 0,
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
    console.error('❌ Error getting credit balance:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get user's purchases
app.get('/api/purchases/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;
    
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Firebase not initialized',
        timestamp: new Date().toISOString()
      });
    }
    
    const query = db.collection('purchases')
      .where('userId', '==', userId)
      .orderBy('date', 'desc')
      .limit(parseInt(limit));
    
    const snapshot = await query.get();
    const purchases = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      purchases.push({
        id: doc.id,
        ...data,
        date: data.date?.toDate?.()?.toISOString() || data.date
      });
    });
    
    res.json({
      success: true,
      purchases,
      count: purchases.length,
      userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error fetching purchases:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== DODO PAYMENTS STATUS ENDPOINTS ====================

app.get('/api/payments/status', (req, res) => {
  res.json({
    success: true,
    service: 'dodo-payments',
    status: 'active',
    configuration: {
      dodoApiKey: process.env.DODO_PAYMENTS_API_KEY ? 'configured' : 'missing',
      dodoWebhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'missing',
      firebase: db ? 'connected' : 'disconnected',
      environment: process.env.NODE_ENV || 'development'
    },
    endpoints: {
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
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    
    if (!DODO_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Dodo API key not configured',
        timestamp: new Date().toISOString()
      });
    }
    
    const response = await fetch('https://api.dodopayments.com/v1/account', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      res.json({
        success: true,
        message: 'Dodo API connection successful',
        account: {
          id: result.id,
          name: result.name,
          email: result.email,
          mode: result.mode || 'test'
        },
        timestamp: new Date().toISOString()
      });
    } else {
      const error = await response.json();
      res.status(response.status).json({
        success: false,
        error: error.message || 'Dodo API connection failed',
        details: error,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ Dodo API test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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

// ==================== ISOLATED CRON ENDPOINT ====================

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
    
    // Isolate modules for cron
    await isolateCronExecution();
    
    // Dynamically load ONLY the reddit admin module
    const redditModule = await withTimeout(
      import('./backend/api/reddit-admin.js'), 
      3000, 
      'Reddit module load timeout'
    );
    
    const redditRouter = redditModule.default;
    
    // Create minimal request wrapper
    const cronReq = {
      ...req,
      method: 'POST',
      path: '/cron',
      headers: {
        ...req.headers,
        'x-isolated-cron': 'true'
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
      8000,
      'Cron execution timeout'
    );
    
    // Restore modules
    restoreModulesAfterCron();
    
    const processingTime = Date.now() - startTime;
    console.log(`[CRON-ISOLATED] ✅ Cron completed in ${processingTime}ms`);
    
    res.json({
      ...cronResponse,
      isolated: true,
      processingTime: processingTime,
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
    version: '2.1.0',
    cronSafe: true,
    moduleLoading: 'isolated',
    services: {
      reddit_automation: 'available',
      cron_scheduler: 'running',
      module_isolation: 'active'
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
    version: '2.1.0',
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      status: '/api/status',
      isolated_cron: 'POST /api/cron-reddit (For GitHub Actions)',
      email: '/api/email/send-welcome-email',
      reddit_admin: '/api/reddit-admin/admin',
      lyric_video: '/api/lyric-video',
      generate_video: '/api/generate-video',
      doodle_art: '/api/doodle-art/generate',
      ai_art: '/api/ai-art/generate',
      gemini_ai: '/api/reddit-admin/generate-comment',
      automation: '/api/reddit-admin/cron-status',
      reddit_api_test: '/api/reddit-admin/test-reddit',
      cron: '/api/reddit-admin/cron (POST)',
      premium_analytics: '/api/reddit-admin/premium-analytics',
      generate_premium_content: '/api/reddit-admin/generate-premium-content',
      optimized_schedule: '/api/reddit-admin/optimized-schedule',
      post_premium_feature: '/api/reddit-admin/post-premium-feature',
      reset_daily: '/api/reddit-admin/reset-daily',
      check_credits: 'POST /api/check-credits',
      deduct_credits: 'POST /api/deduct-credits',
      get_transactions: 'GET /api/transactions/:userId',
      get_balance: 'GET /api/credits/:userId',
      get_purchases: 'GET /api/purchases/:userId'
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
      check_credits: 'POST /api/check-credits - Check user credit balance',
      deduct_credits: 'POST /api/deduct-credits - Deduct credits for generation',
      get_transactions: 'GET /api/transactions/:userId - Get transaction history',
      get_balance: 'GET /api/credits/:userId - Get complete credit balance'
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
      credit_system: 'active'
    },
    reddit_automation_updates: {
      total_subreddits: 12,
      new_premium_subreddits: 8,
      total_audience: '5M+',
      daily_comments: '15 posts/day (rate limit safe)',
      premium_focus: '80% of content focuses on premium features',
      features: 'Rate limit aware, lead tracking, daily reset',
      api_mode: 'LIVE REDDIT API'
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
    version: '2.1.0',
    environment: 'production',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay.toLowerCase(),
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      status: '/api/status',
      email: '/api/email/send-welcome-email',
      reddit_admin: '/api/reddit-admin/admin',
      lyric_video: '/api/lyric-video',
      generate_video: '/api/generate-video',
      doodle_art: '/api/doodle-art/generate',
      ai_art: '/api/ai-art/generate',
      gemini_ai: '/api/reddit-admin/generate-comment',
      automation: '/api/reddit-admin/cron-status',
      reddit_api_test: '/api/reddit-admin/test-reddit',
      cron: '/api/reddit-admin/cron (POST)',
      premium_analytics: '/api/reddit-admin/premium-analytics',
      generate_premium_content: '/api/reddit-admin/generate-premium-content',
      optimized_schedule: '/api/reddit-admin/optimized-schedule',
      post_premium_feature: '/api/reddit-admin/post-premium-feature',
      reset_daily: '/api/reddit-admin/reset-daily',
      check_credits: 'POST /api/check-credits',
      deduct_credits: 'POST /api/deduct-credits',
      get_transactions: 'GET /api/transactions/:userId',
      get_balance: 'GET /api/credits/:userId'
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
      check_credits: 'POST /api/check-credits - Check user credit balance',
      deduct_credits: 'POST /api/deduct-credits - Deduct credits for generation',
      get_transactions: 'GET /api/transactions/:userId - Get transaction history',
      get_balance: 'GET /api/credits/:userId - Get complete credit balance'
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
      credit_system: 'active'
    },
    reddit_automation_updates: {
      total_subreddits: 12,
      new_premium_subreddits: 8,
      total_audience: '5M+',
      daily_comments: '15 posts/day (rate limit safe)',
      premium_focus: '80% of content focuses on premium features',
      features: 'Rate limit aware, lead tracking, daily reset',
      api_mode: 'LIVE REDDIT API'
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
      '/api/cron-reddit (POST)',
      '/api/email/send-welcome-email',
      '/api/reddit-admin/admin',
      '/api/lyric-video',
      '/api/generate-video',
      '/api/doodle-art/generate',
      '/api/ai-art/generate',
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
      '/api/payments/status',
      '/api/check-credits (POST)',
      '/api/deduct-credits (POST)',
      '/api/transactions/:userId',
      '/api/credits/:userId',
      '/api/purchases/:userId'
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
    console.log(`📊 Module status: GET http://localhost:${PORT}/api/module-status`);
  });
}