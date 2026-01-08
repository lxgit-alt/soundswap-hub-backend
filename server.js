// server.js - Main Express server (Optimized with Complete Lazy Loading)
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// Check if we're in Vercel deployment mode
const IS_VERCEL_DEPLOYMENT = process.env.VERCEL_DEPLOYMENT === 'true' || 
                            process.env.VERCEL === '1' || 
                            process.env.NODE_ENV === 'production';

const app = express();

// Minimal middleware for startup
app.use(express.json({
  limit: '20mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ==================== FAST HEALTH ENDPOINTS ====================
// These load immediately - no dependencies

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

// Fast health check - no dependencies
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
    lazy_loading: 'ENABLED',
    services: {
      server: 'running',
      payment_endpoints: 'available',
      note: 'Full routes load on first access'
    }
  });
});

// Simple health endpoint (alias)
app.get('/health', (req, res) => {
  res.redirect('/api/health');
});

// Fast API status - no dependencies
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
    lazy_loading: {
      status: 'ENABLED',
      note: 'Routes load on first access for faster startup'
    },
    endpoints: {
      health: '/api/health',
      status: '/api/status',
      payment_webhook: 'POST /api/lemon-webhook (available)',
      payment_checkout: 'POST /api/create-checkout (available)',
      test_payment: 'POST /api/create-checkout/test-fast-checkout',
      note: 'Other endpoints load on first access'
    }
  });
});

// Root endpoint - fast
app.get('/', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '2.1.0',
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timestamp: new Date().toISOString(),
    lazy_loading: 'ENABLED - Most routes load on first access',
    available_endpoints: {
      health: '/api/health',
      status: '/api/status',
      payment_webhook: 'POST /api/lemon-webhook',
      payment_checkout: 'POST /api/create-checkout',
      test_payment: 'POST /api/create-checkout/test-fast-checkout'
    },
    pending_endpoints: {
      email: '/api/email/*',
      reddit_admin: '/api/reddit-admin/*',
      lyric_video: '/api/lyric-video/*',
      doodle_art: '/api/doodle-art/*',
      credits: '/api/check-credits (POST)',
      note: 'These load when first accessed'
    }
  });
});

// ==================== PAYMENT ENDPOINTS (CRITICAL - LOAD IMMEDIATELY) ====================
// Payment endpoints are critical and should be available immediately

console.log('[INFO] 🚀 Initializing critical payment endpoints...');

// Import payment routes immediately (these are optimized with lazy loading internally)
let lemonWebhookRouter;
let createCheckoutRouter;

try {
  console.log('[INFO] 🔄 Loading payment webhook router...');
  lemonWebhookRouter = (await import('./api/lemon-webhook.js')).default;
  app.use('/api/lemon-webhook', lemonWebhookRouter);
  console.log('[INFO] ✅ Payment webhook routes loaded at /api/lemon-webhook');
} catch (error) {
  console.error('[ERROR] ❌ Failed to load payment webhook:', error.message);
  // Create placeholder route
  app.post('/api/lemon-webhook', (req, res) => {
    res.status(503).json({
      success: false,
      error: 'Payment webhook not available',
      message: 'Failed to load payment module',
      timestamp: new Date().toISOString()
    });
  });
}

try {
  console.log('[INFO] 🔄 Loading checkout router...');
  createCheckoutRouter = (await import('./api/create-checkout.js')).default;
  app.use('/api/create-checkout', createCheckoutRouter);
  console.log('[INFO] ✅ Checkout routes loaded at /api/create-checkout');
} catch (error) {
  console.error('[ERROR] ❌ Failed to load checkout:', error.message);
  // Create placeholder route
  app.post('/api/create-checkout', (req, res) => {
    res.status(503).json({
      success: false,
      error: 'Checkout not available',
      message: 'Failed to load checkout module',
      timestamp: new Date().toISOString()
    });
  });
}

// ==================== LAZY LOADING FOR OTHER ROUTES ====================

let isOtherRoutesLoaded = false;

// Lazy loaded routers for non-critical features
let redditAdminRoutes = null;
let emailRoutes = null;
let lyricVideoRoutes = null;
let doodleArtRoutes = null;

// Lazy load helper for other routes
const loadOtherRoutes = async () => {
  if (!isOtherRoutesLoaded) {
    console.log('[INFO] 🔄 Lazy loading non-critical routes...');
    
    try {
      redditAdminRoutes = (await import('./api/reddit-admin.js')).default;
      app.use('/api/reddit-admin', redditAdminRoutes);
      console.log('[INFO] ✅ Reddit admin routes loaded');
    } catch (error) {
      console.log('[WARN] ⚠️ Reddit admin routes not available');
    }
    
    try {
      emailRoutes = (await import('./api/send-welcome-email.js')).default;
      app.use('/api/email', emailRoutes);
      console.log('[INFO] ✅ Email routes loaded');
    } catch (error) {
      console.log('[WARN] ⚠️ Email routes not available');
    }
    
    try {
      lyricVideoRoutes = (await import('./api/generate-video.js')).default;
      app.use('/api/lyric-video', lyricVideoRoutes);
      app.use('/api/generate-video', lyricVideoRoutes);
      console.log('[INFO] ✅ Lyric video routes loaded');
    } catch (error) {
      console.log('[WARN] ⚠️ Lyric video routes not available');
    }
    
    try {
      doodleArtRoutes = (await import('./api/doodle-art.js')).default;
      app.use('/api/doodle-art', doodleArtRoutes);
      app.use('/api/ai-art', doodleArtRoutes);
      console.log('[INFO] ✅ Doodle art routes loaded');
    } catch (error) {
      console.log('[WARN] ⚠️ Doodle art routes not available');
    }
    
    // Load credit management endpoints
    await registerCreditEndpoints();
    
    isOtherRoutesLoaded = true;
    console.log('[INFO] ✅ All non-critical routes loaded');
  }
};

// ==================== LAZY CREDIT ENDPOINTS ====================

let registerCreditEndpoints = async () => {
  try {
    const { default: admin } = await import('firebase-admin');
    
    // Initialize Firebase Admin only if needed
    let db = null;
    if (!admin.apps.length && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      try {
        const firebaseConfig = {
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        };
        
        admin.initializeApp({
          credential: admin.credential.cert(firebaseConfig),
          databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        db = admin.firestore();
      } catch (error) {
        console.log('[WARN] ⚠️ Firebase Admin initialization skipped');
      }
    } else if (admin.apps.length) {
      db = admin.firestore();
    }
    
    if (db) {
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
          console.error('[ERROR] ❌ Error checking credits:', error);
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
          console.error('[ERROR] ❌ Error deducting credits:', error);
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
          console.error('[ERROR] ❌ Error fetching transactions:', error);
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
          console.error('[ERROR] ❌ Error getting credit balance:', error);
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
          console.error('[ERROR] ❌ Error fetching purchases:', error);
          res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      });
      
      console.log('[INFO] ✅ Credit management endpoints registered');
    } else {
      console.log('[INFO] ⚠️ Firebase not available, credit endpoints disabled');
    }
  } catch (error) {
    console.log('[WARN] ⚠️ Credit endpoints not available:', error.message);
  }
};

// ==================== LAZY LOADING MIDDLEWARE ====================
// This middleware loads other routes when they're first accessed

app.use(async (req, res, next) => {
  // Skip health/status/root/payment endpoints - they work without loading
  if (req.path === '/api/health' || 
      req.path === '/health' || 
      req.path === '/api/status' ||
      req.path === '/' ||
      req.path.startsWith('/api/lemon-webhook') ||
      req.path.startsWith('/api/create-checkout')) {
    return next();
  }
  
  // Load other routes if not already loaded
  if (!isOtherRoutesLoaded) {
    console.log(`[INFO] 🔄 Lazy loading routes for: ${req.method} ${req.path}`);
    try {
      await loadOtherRoutes();
    } catch (error) {
      console.error(`[ERROR] ❌ Failed to load routes:`, error.message);
      return res.status(503).json({
        success: false,
        error: 'Service temporarily unavailable',
        message: 'Failed to load required modules',
        timestamp: new Date().toISOString()
      });
    }
  }
  
  next();
});

// ==================== LOAD ROUTES ENDPOINT ====================

// Trigger lazy loading manually
app.get('/api/load-routes', async (req, res) => {
  try {
    await loadOtherRoutes();
    res.json({
      success: true,
      message: 'All routes loaded successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error loading routes:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== ERROR HANDLING ====================

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
      '/api/lemon-webhook (webhook)',
      '/api/create-checkout (checkout)',
      '/api/create-checkout/test-fast-checkout (test)',
      '/api/load-routes (loads other routes)'
    ],
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('[ERROR] ❌ Unhandled error:', error.message);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// ==================== START SERVER ====================

// For Vercel serverless functions, export the app
export default app;

// For local development, start the server
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
    console.log(`🔧 Payment endpoints: IMMEDIATELY AVAILABLE`);
    console.log(`🔄 Other routes: LAZY LOADED`);
    
    console.log(`\n💰 PAYMENT TESTING (AVAILABLE NOW):`);
    console.log(`   GET  /api/health - Quick health check`);
    console.log(`   POST /api/lemon-webhook - Payment webhook`);
    console.log(`   POST /api/create-checkout - Create checkout`);
    console.log(`   POST /api/create-checkout/test-fast-checkout - Test endpoint`);
    
    console.log(`\n🔧 Configuration Status:`);
    console.log(`   🔐 DODO PAYMENTS: ${process.env.DODO_PAYMENTS_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`   🔐 DODO WEBHOOK: ${process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`   🔐 CRON_SECRET: ${process.env.CRON_SECRET ? 'Configured' : 'Not configured'}`);
    console.log(`   🤖 Gemini AI: ${process.env.GOOGLE_GEMINI_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`   🎨 Hugging Face AI: ${process.env.HF_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   🖌️  Replicate AI: ${process.env.REPLICATE_API_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   🔗 Reddit API: ${process.env.REDDIT_CLIENT_ID ? 'LIVE INTEGRATION' : 'SIMULATION MODE'}`);
    console.log(`   🎨 Doodle-to-Art: ${process.env.REPLICATE_API_TOKEN ? 'AVAILABLE' : 'NOT CONFIGURED'}`);
    console.log(`   🔐 Firebase Admin: ${db ? 'INITIALIZED' : 'NOT CONFIGURED'}`);
    console.log(`   💰 Credit System: ${db ? 'READY' : 'NEEDS FIREBASE CONFIG'}`);
    console.log(`   💳 Payment System: ${process.env.DODO_PAYMENTS_API_KEY ? 'READY' : 'NEEDS DODO CONFIG'}`);
 
    console.log(`\n💡 Payment endpoints are available immediately`);
    console.log(`   Other routes (email, reddit, etc.) load when first accessed`);
  });
}