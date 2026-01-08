import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import admin from 'firebase-admin'; // Add Firebase Admin for credit management

// Import route modules - ONLY THE ONES THAT EXIST
import redditAdminRoutes from './api/reddit-admin.js';
import emailRoutes from './api/send-welcome-email.js';
import lyricVideoRoutes from './api/generate-video.js';
import doodleArtRoutes from './api/doodle-art.js'; // Note: Check if this is at root or src/api

dotenv.config();

const app = express();

// ==================== FIREBASE ADMIN INITIALIZATION ====================
// Only initialize if not already initialized and if we have the credentials
if (!admin.apps.length && process.env.FIREBASE_PRIVATE_KEY) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error.message);
  }
}

const db = admin.firestore?.() || null;

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

// CORS configuration - Combined from both files
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Body parsing middleware with increased limit for video and image generation
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ==================== ROUTES MOUNTING ====================

// Mount routes - using only routes that exist
app.use('/api/reddit-admin', redditAdminRoutes);
app.use('/api/email', emailRoutes);

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
    
    if (!db) {
      console.log('⚠️ Firestore not available for credit check');
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    
    // Get user from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.log(`🔍 Credit check: User ${userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    let credits = 0;
    
    if (type === 'coverArt') {
      credits = userData.points || 0;
    } else if (type === 'lyricVideo') {
      credits = userData.lyricVideoCredits || 0;
    }
    
    console.log(`💰 Credit check - User: ${userId}, Type: ${type}, Credits: ${credits}`);
    
    res.json({
      success: true,
      credits,
      type,
      userId
    });
  } catch (error) {
    console.error('❌ Error checking credits:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Deduct credits
app.post('/api/deduct-credits', async (req, res) => {
  try {
    const { userId, type, amount = 1, reason = 'generation' } = req.body;
    
    if (!userId || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!db) {
      console.log('⚠️ Firestore not available for credit deduction');
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log(`🔍 Credit deduction: User ${userId} not found`);
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
      console.log(`❌ Insufficient credits - User: ${userId}, Type: ${type}, Available: ${currentCredits}, Required: ${amount}`);
      return res.status(400).json({ 
        error: 'Insufficient credits',
        success: false,
        required: amount,
        available: currentCredits,
        type
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
      reason,
      remaining: newCredits,
      date: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`💰 Credit deduction - User: ${userId}, Type: ${type}, Deducted: ${amount}, Remaining: ${newCredits}, Reason: ${reason}`);
    
    res.json({
      success: true,
      type,
      deducted: amount,
      remaining: newCredits,
      transactionId: transactionRef.id
    });
  } catch (error) {
    console.error('❌ Error deducting credits:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction history
app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, type } = req.query;
    
    if (!db) {
      console.log('⚠️ Firestore not available for transaction history');
      return res.status(503).json({ error: 'Database service unavailable' });
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
        // Convert Firestore timestamps to ISO strings
        date: data.date?.toDate?.()?.toISOString() || data.date
      });
    });
    
    console.log(`📊 Transaction history fetched - User: ${userId}, Count: ${transactions.length}`);
    
    res.json({ 
      success: true,
      transactions,
      count: transactions.length 
    });
  } catch (error) {
    console.error('❌ Error fetching transactions:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get user credit summary
app.get('/api/credit-summary/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!db) {
      console.log('⚠️ Firestore not available for credit summary');
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.log(`🔍 Credit summary: User ${userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    
    // Get recent transactions
    const transactionsQuery = db.collection('credit_transactions')
      .where('userId', '==', userId)
      .orderBy('date', 'desc')
      .limit(10);
    
    const transactionsSnapshot = await transactionsQuery.get();
    const recentTransactions = [];
    
    transactionsSnapshot.forEach(doc => {
      const data = doc.data();
      recentTransactions.push({
        id: doc.id,
        type: data.creditType,
        amount: data.amount,
        reason: data.reason,
        date: data.date?.toDate?.()?.toISOString() || data.date
      });
    });
    
    const summary = {
      coverArtCredits: userData.points || 0,
      lyricVideoCredits: userData.lyricVideoCredits || 0,
      subscription: userData.subscription || 'free',
      totalCredits: (userData.points || 0) + (userData.lyricVideoCredits || 0),
      recentTransactions,
      lastUpdated: userData.updatedAt?.toDate?.()?.toISOString() || userData.updatedAt
    };
    
    console.log(`📈 Credit summary - User: ${userId}, Cover Art: ${summary.coverArtCredits}, Lyric Video: ${summary.lyricVideoCredits}`);
    
    res.json({
      success: true,
      ...summary
    });
  } catch (error) {
    console.error('❌ Error fetching credit summary:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Add credits (admin only - for testing or manual adjustments)
app.post('/api/add-credits', async (req, res) => {
  try {
    const { userId, type, amount, reason = 'manual_addition', adminKey } = req.body;
    
    // Simple admin key check (in production, use proper auth)
    const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev-key';
    if (adminKey !== ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!userId || !type || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Missing or invalid required fields' });
    }
    
    if (!db) {
      console.log('⚠️ Firestore not available for adding credits');
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log(`🔍 Add credits: User ${userId} not found`);
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
    
    // Add credits
    const newCredits = currentCredits + amount;
    
    await userRef.update({
      [fieldToUpdate]: newCredits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Record transaction
    const transactionRef = db.collection('credit_transactions').doc();
    await transactionRef.set({
      userId,
      type: 'addition',
      creditType: type,
      amount,
      reason,
      remaining: newCredits,
      date: admin.firestore.FieldValue.serverTimestamp(),
      adminAdded: true
    });
    
    console.log(`➕ Credits added - User: ${userId}, Type: ${type}, Added: ${amount}, Total: ${newCredits}, Reason: ${reason}`);
    
    res.json({
      success: true,
      type,
      added: amount,
      previous: currentCredits,
      newTotal: newCredits,
      transactionId: transactionRef.id
    });
  } catch (error) {
    console.error('❌ Error adding credits:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ENDPOINTS ====================

// Health check endpoint - Updated with credit management info
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
    version: '2.1.0', // Updated version with credit management
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
      credit_management: db ? 'active' : 'inactive',
      firestore: db ? 'connected' : 'not_configured'
    },
    credit_features: {
      check_credits: 'POST /api/check-credits',
      deduct_credits: 'POST /api/deduct-credits',
      transaction_history: 'GET /api/transactions/:userId',
      credit_summary: 'GET /api/credit-summary/:userId',
      admin_add_credits: 'POST /api/add-credits (admin only)'
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
    ai_features: {
      lyric_video_generation: process.env.HF_TOKEN ? 'active' : 'disabled',
      doodle_to_art: process.env.REPLICATE_API_TOKEN ? 'active' : 'disabled',
      comment_generation: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      audio_analysis: process.env.HF_TOKEN ? 'active' : 'disabled',
      premium_content_focus: 'active'
    },
    doodle_art_features: {
      api: 'Replicate ControlNet Scribble',
      model: 'jagilley/controlnet-scribble',
      conditioning_scale: '0.1 to 1.0 (Creativity slider)',
      image_resolution: '512px',
      cost_per_generation: '$0.01 - $0.02',
      generation_time: '5-8 seconds',
      nsfw_filter: 'enabled',
      text_rendering_warning: 'AI may not render text accurately'
    },
    reddit_automation_updates: {
      premium_focus: 'enabled',
      target_subreddits: '12 total (8 new premium-focused)',
      rate_limit_aware: 'active',
      lead_tracking: 'active',
      daily_reset: 'enabled'
    }
  });
});

// Simple health endpoint (alias)
app.get('/health', (req, res) => {
  res.redirect('/api/health');
});

// Enhanced API status endpoint - Updated with credit management
app.get('/api/status', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.json({
    success: true,
    service: 'soundswap-backend',
    status: 'operational',
    version: '2.1.0', // Updated version with credit management
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
      // Credit management endpoints
      check_credits: 'POST /api/check-credits',
      deduct_credits: 'POST /api/deduct-credits',
      transactions: 'GET /api/transactions/:userId',
      credit_summary: 'GET /api/credit-summary/:userId',
      add_credits: 'POST /api/add-credits (admin)'
    },
    // ... rest of your existing status endpoint ...
  });
});

// Root endpoint - Updated with credit management
app.get('/', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '2.1.0', // Updated version with credit management
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timestamp: new Date().toISOString(),
    endpoints: {
      // ... your existing endpoints ...
      // Credit management
      check_credits: 'POST /api/check-credits',
      deduct_credits: 'POST /api/deduct-credits',
      transactions: 'GET /api/transactions/:userId',
      credit_summary: 'GET /api/credit-summary/:userId'
    },
    // ... rest of your existing root endpoint ...
  });
});

// Handle 404 - Updated with credit management endpoints
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
    credit_management_endpoints: [
      'POST /api/check-credits - Check user credits',
      'POST /api/deduct-credits - Deduct credits for generation',
      'GET /api/transactions/:userId - Get transaction history',
      'GET /api/credit-summary/:userId - Get credit summary',
      'POST /api/add-credits - Add credits (admin only)'
    ],
    // ... rest of your existing 404 handler ...
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error.message);
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
    
    console.log(`\n💳 CREDIT MANAGEMENT ENDPOINTS:`);
    console.log(`   POST /api/check-credits - Check user credits`);
    console.log(`   POST /api/deduct-credits - Deduct credits for generation`);
    console.log(`   GET  /api/transactions/:userId - Get transaction history`);
    console.log(`   GET  /api/credit-summary/:userId - Get credit summary`);
    console.log(`   POST /api/add-credits - Add credits (admin only)`);
    
    console.log(`\n🎨 DOODLE-TO-ART ENDPOINTS:`);
    console.log(`   GET  /api/doodle-art/test - Test Replicate connection`);
    console.log(`   POST /api/doodle-art/generate - Generate art from sketch`);
    
    console.log(`\n🎬 VIDEO GENERATION ENDPOINTS:`);
    console.log(`   POST /api/generate-video - Regular video generation`);
    console.log(`   POST /api/generate-video/optimized - Optimized video generation`);
    
    console.log(`\n💎 REDDIT PREMIUM FEATURE ENDPOINTS:`);
    console.log(`   GET  /api/reddit-admin/premium-analytics - Premium lead tracking`);
    
    console.log(`\n📧 Email endpoints: http://localhost:${PORT}/api/email/*`);
    console.log(`🤖 Reddit Admin: http://localhost:${PORT}/api/reddit-admin/admin`);
    console.log(`📊 API Status: http://localhost:${PORT}/api/status`);
    
    console.log(`\n🔧 Configuration Status:`);
    console.log(`   🔐 CRON_SECRET: ${process.env.CRON_SECRET ? 'Configured' : 'Not configured'}`);
    console.log(`   🤖 Gemini AI: ${process.env.GOOGLE_GEMINI_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`   🎨 Hugging Face AI: ${process.env.HF_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   🖌️  Replicate AI: ${process.env.REPLICATE_API_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   🔥 Firebase Admin: ${db ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   💳 Credit Management: ${db ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`   🔗 Reddit API: ${process.env.REDDIT_CLIENT_ID ? 'LIVE INTEGRATION' : 'SIMULATION MODE'}`);
    console.log(`   🎨 Doodle-to-Art: ${process.env.REPLICATE_API_TOKEN ? 'READY' : 'NEEDS REPLICATE API TOKEN'}`);
    console.log(`   💎 Premium Feature Focus: ACTIVE`);
    console.log(`   🎯 Target Subreddits: 12 total (8 new premium-focused)`);
  });
}