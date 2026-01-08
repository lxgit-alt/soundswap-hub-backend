// server.js - Main Express server (FIXED with lazy loading)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import bodyParser from 'body-parser';

dotenv.config();

// ==================== FIREBASE ADMIN INITIALIZATION ====================
// Initialize Firebase Admin SDK if not already initialized
let db;
if (!admin.apps.length) {
  try {
    const firebaseConfig = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };
    
    // Only initialize if we have the required config
    if (firebaseConfig.projectId && firebaseConfig.clientEmail && firebaseConfig.privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert(firebaseConfig),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
      console.log('🔥 Firebase Admin initialized');
      db = admin.firestore();
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

// Security headers with CSP disabled for API server
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: '*', // Allow all origins for API
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'webhook-id', 'webhook-timestamp', 'webhook-signature']
}));

// Body parsing middleware
app.use(bodyParser.json({
  limit: '20mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook signature verification
    req.rawBody = buf.toString();
  }
}));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));

// ==================== LAZY LOADING ROUTE HANDLER ====================
// This helps prevent timeout by loading heavy routes only when needed

// Function to lazy load a route module
const lazyLoadRoute = async (modulePath, defaultExport = true) => {
  try {
    console.log(`📦 Lazy loading route: ${modulePath}`);
    const module = await import(modulePath);
    return defaultExport ? module.default : module;
  } catch (error) {
    console.error(`❌ Failed to lazy load ${modulePath}:`, error.message);
    // Return an empty router if module fails to load
    const router = express.Router();
    router.get('/', (req, res) => {
      res.status(503).json({
        success: false,
        error: 'Route temporarily unavailable',
        message: `Module ${modulePath} failed to load`,
        timestamp: new Date().toISOString()
      });
    });
    return router;
  }
};

// ==================== ROUTE MOUNTING WITH LAZY LOADING ====================

// Mount lightweight health routes first
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
    version: '2.2.0',
    services: {
      email: process.env.GMAIL_USER ? 'configured' : 'not_configured',
      reddit_admin: 'operational',
      lyric_video: process.env.HF_TOKEN ? 'configured' : 'not_configured',
      doodle_art: process.env.REPLICATE_API_TOKEN ? 'configured' : 'not_configured',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'configured' : 'not_configured',
      reddit_automation: 'active',
      cron_scheduler: 'running',
      vercel_cron: process.env.CRON_SECRET ? 'configured' : 'not_configured',
      educational_posts: 'active',
      chart_notifications: 'active',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'configured' : 'not_configured',
      premium_feature_focus: 'active',
      lead_generation: 'active',
      rate_limit_management: 'active',
      credit_management: db ? 'configured' : 'not_configured',
      dodo_payments: process.env.DODO_PAYMENTS_API_KEY ? 'configured' : 'not_configured',
      webhook: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'not_configured'
    }
  });
});

// Mount webhook routes (needs raw body access)
app.use('/api/lemon-webhook', async (req, res, next) => {
  const lemonWebhookRouter = await lazyLoadRoute('./api/lemon-webhook.js');
  lemonWebhookRouter(req, res, next);
});

// Mount email routes
app.use('/api/email', async (req, res, next) => {
  const emailRoutes = await lazyLoadRoute('./api/send-welcome-email.js');
  emailRoutes(req, res, next);
});

// Mount checkout routes
app.use('/api/create-checkout', async (req, res, next) => {
  const createCheckoutRouter = await lazyLoadRoute('./api/create-checkout.js');
  createCheckoutRouter(req, res, next);
});

// Mount Reddit admin routes with chunked processing
app.use('/api/reddit-admin', async (req, res, next) => {
  // For cron endpoints, we use chunked processing
  if (req.path === '/cron' && req.method === 'POST') {
    // Use the chunked cron handler
    const redditAdminRoutes = await lazyLoadRoute('./api/reddit-admin-chunked.js');
    redditAdminRoutes(req, res, next);
  } else {
    // Use regular routes for other endpoints
    const redditAdminRoutes = await lazyLoadRoute('./api/reddit-admin.js');
    redditAdminRoutes(req, res, next);
  }
});

// Lyric Video API - lazy load
app.use('/api/lyric-video', async (req, res, next) => {
  const lyricVideoRoutes = await lazyLoadRoute('./api/generate-video.js');
  lyricVideoRoutes(req, res, next);
});
app.use('/api/generate-video', async (req, res, next) => {
  const lyricVideoRoutes = await lazyLoadRoute('./api/generate-video.js');
  lyricVideoRoutes(req, res, next);
});

// Doodle-to-Art API - lazy load with fallback
app.use('/api/doodle-art', async (req, res, next) => {
  try {
    const doodleArtRoutes = await lazyLoadRoute('./api/doodle-art.js');
    doodleArtRoutes(req, res, next);
  } catch (error) {
    // Create a placeholder router if module fails
    const router = express.Router();
    router.get('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Doodle Art module not available',
        timestamp: new Date().toISOString()
      });
    });
    router(req, res, next);
  }
});
app.use('/api/ai-art', async (req, res, next) => {
  try {
    const doodleArtRoutes = await lazyLoadRoute('./api/doodle-art.js');
    doodleArtRoutes(req, res, next);
  } catch (error) {
    const router = express.Router();
    router.get('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'AI Art module not available',
        timestamp: new Date().toISOString()
      });
    });
    router(req, res, next);
  }
});

// ==================== CREDIT MANAGEMENT ENDPOINTS ====================
// These are lightweight and can stay loaded

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
    
    // Get user from Firestore
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
    
    // Check if user has enough credits
    if (currentCredits < amount) {
      return res.status(400).json({ 
        success: false,
        error: 'Insufficient credits',
        required: amount,
        available: currentCredits,
        timestamp: new Date().toISOString()
      });
    }
    
    // Deduct credits
    const newCredits = currentCredits - amount;
    
    await userRef.update({
      [fieldToUpdate]: newCredits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Record transaction
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

// ==================== CHUNKED PROCESSING ENDPOINTS ====================

// Chunked Reddit processing endpoint - processes only one subreddit per call
app.post('/api/reddit-chunk', async (req, res) => {
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

    console.log('✅ Starting chunked Reddit processing');
    
    const { subreddit, processType = 'goldenHour' } = req.body;
    
    if (!subreddit) {
      return res.status(400).json({
        success: false,
        error: 'Subreddit parameter required',
        timestamp: new Date().toISOString()
      });
    }
    
    // Import the chunked processor
    const chunkedProcessor = await lazyLoadRoute('./api/reddit-chunked-processor.js', false);
    
    // Process single subreddit
    const result = await chunkedProcessor.processSingleSubreddit(subreddit, processType);
    
    res.json({
      success: true,
      message: `Chunked processing completed for r/${subreddit}`,
      result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in chunked processing:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Batch processing endpoint - triggers multiple chunks
app.post('/api/reddit-batch', async (req, res) => {
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

    console.log('✅ Starting batch Reddit processing');
    
    // Get the list of subreddits to process
    const { subreddits = [], maxChunks = 3 } = req.body;
    
    if (!subreddits || subreddits.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Subreddits array required',
        timestamp: new Date().toISOString()
      });
    }
    
    // Return immediately and let the batch run in background
    res.json({
      success: true,
      message: 'Batch processing initiated',
      subredditsCount: subreddits.length,
      maxChunks,
      timestamp: new Date().toISOString(),
      note: 'Processing runs asynchronously'
    });
    
    // Process chunks asynchronously
    setTimeout(async () => {
      try {
        const chunkedProcessor = await lazyLoadRoute('./api/reddit-chunked-processor.js', false);
        await chunkedProcessor.processBatch(subreddits, maxChunks);
      } catch (error) {
        console.error('❌ Error in async batch processing:', error);
      }
    }, 100);
    
  } catch (error) {
    console.error('❌ Error in batch processing:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== SIMPLE ENDPOINTS ====================

// Root endpoint
app.get('/', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '2.2.0',
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timestamp: new Date().toISOString(),
    features: {
      lazy_loading: 'enabled',
      chunked_processing: 'available',
      timeout_protection: 'active',
      vercel_optimized: 'yes'
    },
    endpoints: {
      health: '/api/health',
      reddit_chunk: 'POST /api/reddit-chunk (process single subreddit)',
      reddit_batch: 'POST /api/reddit-batch (batch processing)',
      credit_management: '/api/check-credits, /api/deduct-credits'
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
    
    console.log(`\n🔧 CHUNKED PROCESSING ENDPOINTS:`);
    console.log(`   POST /api/reddit-chunk - Process single subreddit`);
    console.log(`   POST /api/reddit-batch - Batch process multiple subreddits`);
    
    console.log(`\n⚡ PERFORMANCE OPTIMIZATIONS:`);
    console.log(`   ✅ Lazy loading enabled`);
    console.log(`   ✅ Chunked processing`);
    console.log(`   ✅ Timeout protection`);
    console.log(`   ✅ Vercel-optimized`);
  });
}