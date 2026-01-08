import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import bodyParser from 'body-parser';

// Import route modules
import redditAdminRoutes from './api/reddit-admin.js';
import emailRoutes from './api/send-welcome-email.js';
import lyricVideoRoutes from './api/generate-video.js';
import doodleArtRoutes from './api/doodle-art.js';
import createCheckoutRouter from './api/create-checkout.js';
import lemonWebhookRouter from './api/lemon-webhook.js';

dotenv.config();

// ==================== FIREBASE ADMIN INITIALIZATION ====================
// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log('🔥 Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Firebase Admin initialization error:', error);
  }
}

const db = admin.firestore();

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
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://soundswap-backend.vercel.app", "wss:"]
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
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
    'https://soundswap-hub-git-main-thamindas-projects.vercel.app',
    /\.vercel\.app$/ // Allow all Vercel subdomains
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'webhook-id', 'webhook-timestamp', 'webhook-signature']
}));

// Body parsing middleware - IMPORTANT: For lemon-webhook we need raw body
app.use(bodyParser.json({
  limit: '20mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook signature verification
    req.rawBody = buf.toString();
  }
}));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));

// ==================== MOUNT ROUTERS ====================

// Mount webhook first (needs raw body access)
app.use('/api/lemon-webhook', lemonWebhookRouter);

// Mount other routers
app.use('/api/reddit-admin', redditAdminRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/create-checkout', createCheckoutRouter);

// Lyric Video API
app.use('/api/lyric-video', lyricVideoRoutes);
app.use('/api/generate-video', lyricVideoRoutes); // Alias for compatibility

// Doodle-to-Art API
app.use('/api/doodle-art', doodleArtRoutes);
app.use('/api/ai-art', doodleArtRoutes); // Alias for convenience

// ==================== CREDIT MANAGEMENT ENDPOINTS ====================

// Check user credits
app.post('/api/check-credits', async (req, res) => {
  try {
    const { userId, type } = req.body;
    
    if (!userId || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Get user from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
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
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
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
      return res.status(400).json({ error: 'Invalid credit type' });
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
        // Convert Firestore timestamp to ISO string
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

// Get credit balance (combined endpoint)
app.get('/api/credits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
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

// Get Dodo Payments configuration status
app.get('/api/payments/status', (req, res) => {
  res.json({
    success: true,
    service: 'dodo-payments',
    status: 'active',
    configuration: {
      dodoApiKey: process.env.DODO_PAYMENTS_API_KEY ? 'configured' : 'missing',
      dodoWebhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'missing',
      firebase: 'connected',
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
        error: 'Dodo API key not configured'
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

// ==================== ENDPOINTS ====================

// Health check endpoint
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
      credit_management: process.env.FIREBASE_PROJECT_ID ? 'configured' : 'not_configured',
      dodo_payments: process.env.DODO_PAYMENTS_API_KEY ? 'configured' : 'not_configured',
      webhook: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'not_configured'
    },
    premium_features: {
      lyric_video_generator: {
        status: process.env.HF_TOKEN ? 'active' : 'disabled',
        focus: 'Premium feature promotion',
        target_audience: 'Musicians, video editors, motion designers'
      },
      doodle_art_generator: {
        status: process.env.REPLICATE_API_TOKEN ? 'active' : 'disabled',
        focus: 'Premium feature promotion',
        target_audience: 'Digital artists, AI art enthusiasts, Spotify creators'
      }
    },
    payment_system: {
      status: process.env.DODO_PAYMENTS_API_KEY ? 'active' : 'disabled',
      provider: 'Dodo Payments',
      webhook: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'not_configured',
      checkout: 'POST /api/create-checkout',
      webhook_endpoint: 'POST /api/lemon-webhook'
    },
    credit_system: {
      status: 'active',
      cover_art_credits: 'points field',
      lyric_video_credits: 'lyricVideoCredits field',
      transaction_history: 'credit_transactions collection',
      purchase_history: 'purchases collection',
      subscription_history: 'subscription_transactions collection'
    },
    ai_features: {
      lyric_video_generation: process.env.HF_TOKEN ? 'active' : 'disabled',
      doodle_to_art: process.env.REPLICATE_API_TOKEN ? 'active' : 'disabled',
      comment_generation: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      audio_analysis: process.env.HF_TOKEN ? 'active' : 'disabled',
      premium_content_focus: 'active'
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
      email: '/api/email/*',
      reddit_admin: '/api/reddit-admin/*',
      lyric_video: '/api/lyric-video/*',
      generate_video: '/api/generate-video/*',
      doodle_art: '/api/doodle-art/*',
      ai_art: '/api/ai-art/*',
      create_checkout: '/api/create-checkout',
      lemon_webhook: '/api/lemon-webhook',
      payments_status: '/api/payments/status',
      payments_test: '/api/payments/test',
      credit_management: {
        check_credits: 'POST /api/check-credits',
        deduct_credits: 'POST /api/deduct-credits',
        get_transactions: 'GET /api/transactions/:userId',
        get_balance: 'GET /api/credits/:userId',
        get_purchases: 'GET /api/purchases/:userId'
      }
    },
    payment_endpoints: {
      create_checkout: 'POST /api/create-checkout',
      get_products: 'GET /api/create-checkout/products',
      get_product: 'GET /api/create-checkout/products/:productId',
      test_dodo: 'GET /api/create-checkout/test-dodo',
      get_session: 'GET /api/create-checkout/session/:sessionId',
      webhook: 'POST /api/lemon-webhook',
      webhook_test: 'GET /api/lemon-webhook/test',
      webhook_simulate: 'POST /api/lemon-webhook/simulate',
      webhook_status: 'GET /api/lemon-webhook/status'
    },
    video_generation_endpoints: {
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
    doodle_art_endpoints: {
      test_connection: 'GET /api/doodle-art/test',
      generate_art: 'POST /api/doodle-art/generate'
    },
    reddit_premium_endpoints: {
      premium_analytics: 'GET /api/reddit-admin/premium-analytics',
      generate_premium_content: 'POST /api/reddit-admin/generate-premium-content',
      optimized_schedule: 'GET /api/reddit-admin/optimized-schedule',
      post_premium_feature: 'POST /api/reddit-admin/post-premium-feature',
      reset_daily: 'POST /api/reddit-admin/reset-daily',
      cron_status: 'GET /api/reddit-admin/cron-status',
      schedule_today: 'GET /api/reddit-admin/schedule/today',
      manual_post: 'POST /api/reddit-admin/manual-post',
      create_educational_post: 'POST /api/reddit-admin/create-educational-post',
      create_top50_post: 'POST /api/reddit-admin/create-top50-post',
      reset_counts: 'POST /api/reddit-admin/reset-counts',
      generate_comment: 'POST /api/reddit-admin/generate-comment',
      generate_reply: 'POST /api/reddit-admin/generate-reply',
      analyze_post: 'POST /api/reddit-admin/analyze-post',
      test_gemini: 'GET /api/reddit-admin/test-gemini',
      cron: 'POST /api/reddit-admin/cron'
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
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
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
      create_checkout: '/api/create-checkout',
      lemon_webhook: '/api/lemon-webhook',
      payments: '/api/payments/status',
      credit_management: {
        check_credits: 'POST /api/check-credits',
        deduct_credits: 'POST /api/deduct-credits',
        get_transactions: 'GET /api/transactions/:userId',
        get_balance: 'GET /api/credits/:userId',
        get_purchases: 'GET /api/purchases/:userId'
      }
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
      '/api/email/send-welcome-email',
      '/api/reddit-admin/admin',
      '/api/create-checkout',
      '/api/lemon-webhook',
      '/api/payments/status',
      '/api/check-credits (POST)',
      '/api/deduct-credits (POST)',
      '/api/transactions/:userId',
      '/api/credits/:userId',
      '/api/purchases/:userId'
    ]
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error);
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
    
    console.log(`\n💰 PAYMENT ENDPOINTS:`);
    console.log(`   POST /api/create-checkout - Create checkout session`);
    console.log(`   POST /api/lemon-webhook - Dodo webhook handler`);
    console.log(`   GET  /api/create-checkout/products - Get product catalog`);
    console.log(`   GET  /api/payments/status - Payment system status`);
    
    console.log(`\n💰 CREDIT MANAGEMENT ENDPOINTS:`);
    console.log(`   POST /api/check-credits - Check user credit balance`);
    console.log(`   POST /api/deduct-credits - Deduct credits for generation`);
    console.log(`   GET  /api/transactions/:userId - Get transaction history`);
    console.log(`   GET  /api/credits/:userId - Get complete credit balance`);
    console.log(`   GET  /api/purchases/:userId - Get purchase history`);
    
    console.log(`\n🎨 DOODLE-TO-ART ENDPOINTS:`);
    console.log(`   GET  /api/doodle-art/test - Test Replicate connection`);
    console.log(`   POST /api/doodle-art/generate - Generate art from sketch`);
    
    console.log(`\n🎬 VIDEO GENERATION ENDPOINTS:`);
    console.log(`   POST /api/generate-video - Regular video generation`);
    console.log(`   POST /api/generate-video/optimized - Optimized video generation`);
    
    console.log(`\n💎 REDDIT PREMIUM FEATURE ENDPOINTS:`);
    console.log(`   GET  /api/reddit-admin/premium-analytics - Premium lead tracking`);
    console.log(`   POST /api/reddit-admin/generate-premium-content - Generate premium content`);
    console.log(`   GET  /api/reddit-admin/optimized-schedule - Optimized posting schedule`);
    
    console.log(`\n📧 Email endpoints: http://localhost:${PORT}/api/email/*`);
    console.log(`🤖 Reddit Admin: http://localhost:${PORT}/api/reddit-admin/admin`);
    console.log(`📊 API Status: http://localhost:${PORT}/api/status`);
    
    console.log(`\n🔧 Configuration Status:`);
    console.log(`   🔐 DODO PAYMENTS: ${process.env.DODO_PAYMENTS_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`   🔐 DODO WEBHOOK: ${process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`   🔐 CRON_SECRET: ${process.env.CRON_SECRET ? 'Configured' : 'Not configured'}`);
    console.log(`   🤖 Gemini AI: ${process.env.GOOGLE_GEMINI_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`   🎨 Hugging Face AI: ${process.env.HF_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   🖌️  Replicate AI: ${process.env.REPLICATE_API_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   🔗 Reddit API: ${process.env.REDDIT_CLIENT_ID ? 'LIVE INTEGRATION' : 'SIMULATION MODE'}`);
    console.log(`   🎨 Doodle-to-Art: ${process.env.REPLICATE_API_TOKEN ? 'READY' : 'NEEDS REPLICATE API TOKEN'}`);
    console.log(`   💎 Premium Feature Focus: ACTIVE`);
    console.log(`   🔐 Firebase Admin: ${process.env.FIREBASE_PROJECT_ID ? 'INITIALIZED' : 'NOT CONFIGURED'}`);
    console.log(`   💰 Credit System: ${process.env.FIREBASE_PROJECT_ID ? 'READY' : 'NEEDS FIREBASE CONFIG'}`);
    console.log(`   💳 Payment System: ${process.env.DODO_PAYMENTS_API_KEY ? 'READY' : 'NEEDS DODO CONFIG'}`);
  });
}g