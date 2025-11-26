import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';
import trendsRoutes from './api/trends.js';
import redditAdminRoutes from './api/reddit-admin.js';
import emailRoutes from './api/send-welcome-email.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== TIMEZONE CONFIGURATION ====================

// Set your preferred timezone (e.g., 'America/New_York', 'Europe/London', 'UTC')
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';

// Helper function to get current time in app timezone
const getCurrentTimeInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { 
    timeZone: APP_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).slice(0, 5); // Returns "HH:MM"
};

// Helper function to get current day in app timezone
const getCurrentDayInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleDateString('en-US', { 
    timeZone: APP_TIMEZONE,
    weekday: 'long'
  }).toLowerCase();
};

// Trust proxy - important for HTTPS behind reverse proxy
app.set('trust proxy', 1);

// Security headers with Helmet
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

// CORS configuration for production
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'http://localhost:3000',
      'https://localhost:3000', 
      'http://localhost:5173',
      'https://localhost:5173',
      'https://soundswap-backend.vercel.app',
      'https://soundswap.onrender.com',
      'https://www.soundswap.onrender.com',
      'https://soundswap.live',
      'https://www.soundswap.live',
      'https://sound-swap-frontend.onrender.com'
    ];

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==================== ROUTES MOUNTING ====================

// Mount reddit admin routes at both /reddit-admin and /api/reddit-admin
app.use('/reddit-admin', redditAdminRoutes);
app.use('/api/reddit-admin', redditAdminRoutes);

// Mount email routes
app.use('/api/email', emailRoutes);

// Mount trends routes
app.use('/', trendsRoutes);

// ==================== ENDPOINTS ====================

// Health check endpoint
app.get('/health', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    secure: req.secure,
    version: '1.1.0', // Updated version
    services: {
      trends: 'operational',
      email: process.env.GMAIL_USER ? 'configured' : 'not_configured',
      database: 'mock_data',
      reddit_admin: 'operational',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'configured' : 'not_configured',
      reddit_automation: 'active',
      cron_scheduler: 'running',
      vercel_cron: process.env.CRON_SECRET ? 'configured' : 'not_configured',
      educational_posts: 'active',
      chart_notifications: 'active',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'configured' : 'not_configured' // NEW: Added Reddit API status
    }
  });
});

// Enhanced API status endpoint
app.get('/api/status', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.json({
    success: true,
    service: 'soundswap-backend',
    status: 'operational',
    version: '1.2.0', // Updated version
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timestamp: new Date().toISOString(),
    endpoints: {
      trends: '/api/trends/*',
      email: '/api/email/*',
      health: '/health',
      status: '/api/status',
      reddit_admin: '/api/reddit-admin/*',
      cron: '/api/reddit-admin/cron (POST)'
    },
    features: {
      music_trends: 'active',
      content_ideas: 'active',
      welcome_emails: process.env.GMAIL_USER ? 'active' : 'disabled',
      password_reset: process.env.GMAIL_USER ? 'active' : 'disabled',
      song_review_notifications: process.env.GMAIL_USER ? 'active' : 'disabled',
      top10_chart_notifications: process.env.GMAIL_USER ? 'active' : 'disabled',
      analytics: 'in_development',
      reddit_integration: 'active',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      reddit_automation: 'active',
      cron_scheduler: 'running',
      vercel_cron: process.env.CRON_SECRET ? 'active' : 'disabled',
      educational_posts: 'active',
      top50_promotion: 'active',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'live' : 'simulated' // NEW: Added Reddit API feature
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
    version: '1.2.0', // Updated version
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      status: '/api/status',
      trends: '/api/trends/music',
      email: '/api/email/send-welcome-email',
      reddit_admin: '/api/reddit-admin/admin',
      gemini_ai: '/api/reddit-admin/generate-comment',
      automation: '/api/reddit-admin/cron-status',
      reddit_api_test: '/api/reddit-admin/test-reddit', // NEW: Added test-reddit endpoint
      cron: '/api/reddit-admin/cron (POST)'
    },
    ai_features: {
      comment_generation: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      dm_replies: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      post_analysis: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      automation_system: 'active',
      cron_scheduler: 'running',
      vercel_cron: process.env.CRON_SECRET ? 'active' : 'disabled',
      educational_posts: 'active',
      top50_promotion: 'active',
      chart_notifications: 'active',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'live' : 'simulated' // NEW: Added Reddit API status
    },
    reddit_automation: {
      comments: '52 posts/day across 6 subreddits',
      educational_posts: '2-3 posts/week per subreddit',
      top50_promotion: 'Weekly chart submissions',
      total_reach: '2.8M+ musicians',
      features: 'Always redirects to soundswap.live',
      api_mode: process.env.REDDIT_CLIENT_ID ? 'LIVE REDDIT API' : 'SIMULATION MODE' // NEW: Added API mode
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
      '/health',
      '/api/status',
      '/api/email/send-welcome-email',
      '/api/email/send-password-reset',
      '/api/email/send-song-reviewed',
      '/api/email/send-top10-chart',
      '/api/email/test',
      '/api/trends/music',
      '/api/trends/content-ideas',
      '/api/trends/health',
      '/api/trends/dev/music',
      '/api/trends/dev/test-integration',
      '/api/reddit-admin/admin',
      '/api/reddit-admin/generate-comment',
      '/api/reddit-admin/generate-reply',
      '/api/reddit-admin/analyze-post',
      '/api/reddit-admin/test-gemini',
      '/api/reddit-admin/test-reddit', // NEW: Added test-reddit endpoint
      '/api/reddit-admin/cron-status',
      '/api/reddit-admin/manual-post',
      '/api/reddit-admin/create-educational-post',
      '/api/reddit-admin/create-top50-post',
      '/api/reddit-admin/reset-counts',
      '/api/reddit-admin/targets',
      '/api/reddit-admin/schedule/today',
      '/api/reddit-admin/auth',
      '/api/reddit-admin/posts',
      '/api/reddit-admin/analytics',
      '/api/reddit-admin/cron (POST)'
    ]
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏰ Timezone: ${APP_TIMEZONE}`);
  console.log(`📅 Current time: ${currentTime} on ${currentDay}`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`📊 API Status: http://localhost:${PORT}/api/status`);
  console.log(`📧 Email endpoints: http://localhost:${PORT}/api/email/*`);
  console.log(`🤖 Reddit Admin: http://localhost:${PORT}/api/reddit-admin/admin`);
  console.log(`🔌 Reddit API Test: http://localhost:${PORT}/api/reddit-admin/test-reddit`); // NEW: Added test-reddit
  console.log(`⏰ Cron Status: http://localhost:${PORT}/api/reddit-admin/cron-status`);
  console.log(`📚 Educational Posts: http://localhost:${PORT}/api/reddit-admin/create-educational-post`);
  console.log(`🎵 Top 50 Promotion: http://localhost:${PORT}/api/reddit-admin/create-top50-post`);
  console.log(`🏆 Chart Notifications: http://localhost:${PORT}/api/email/send-top10-chart`);
  console.log(`🔐 Vercel Cron: http://localhost:${PORT}/api/reddit-admin/cron (POST)`);
  console.log(`🔧 CORS enabled for production domains`);
  console.log(`🔐 CRON_SECRET: ${process.env.CRON_SECRET ? 'Configured' : 'Not configured'}`);
  console.log(`🤖 Gemini AI: ${process.env.GOOGLE_GEMINI_API_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`🔗 Reddit API: ${process.env.REDDIT_CLIENT_ID ? 'LIVE INTEGRATION' : 'SIMULATION MODE'}`); // NEW: Added API mode status
  console.log(`📈 Reddit Automation: 52 comments/day + 2-3 educational posts/week`);
});