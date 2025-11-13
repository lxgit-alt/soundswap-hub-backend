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

// Mount email routes - UPDATED PATH
app.use('/api/send-welcome-email', emailRoutes);

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
    version: '1.0.0',
    services: {
      trends: 'operational',
      email: process.env.GMAIL_USER ? 'configured' : 'not_configured',
      database: 'mock_data',
      reddit_admin: 'operational',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'configured' : 'not_configured',
      reddit_automation: 'active',
      cron_scheduler: 'running'
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
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timestamp: new Date().toISOString(),
    endpoints: {
      trends: '/api/trends/*',
      email: '/api/send-welcome-email/*', // UPDATED
      health: '/health',
      status: '/api/status',
      reddit_admin: '/api/reddit-admin/*'
    },
    features: {
      music_trends: 'active',
      content_ideas: 'active',
      welcome_emails: process.env.GMAIL_USER ? 'active' : 'disabled',
      password_reset: process.env.GMAIL_USER ? 'active' : 'disabled',
      song_review_notifications: process.env.GMAIL_USER ? 'active' : 'disabled',
      analytics: 'in_development',
      reddit_integration: 'active',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      reddit_automation: 'active',
      cron_scheduler: 'running'
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
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      status: '/api/status',
      trends: '/api/trends/music',
      email: '/api/send-welcome-email/send-welcome-email', // UPDATED
      reddit_admin: '/api/reddit-admin/admin',
      gemini_ai: '/api/reddit-admin/generate-comment',
      automation: '/api/reddit-admin/cron-status'
    },
    ai_features: {
      comment_generation: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      dm_replies: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      post_analysis: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      automation_system: 'active',
      cron_scheduler: 'running'
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
      '/api/send-welcome-email/send-welcome-email', // UPDATED
      '/api/send-welcome-email/send-password-reset', // UPDATED
      '/api/send-welcome-email/send-song-reviewed', // UPDATED
      '/api/send-welcome-email/test', // UPDATED
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
      '/api/reddit-admin/cron-status',
      '/api/reddit-admin/manual-post',
      '/api/reddit-admin/reset-counts',
      '/api/reddit-admin/targets',
      '/api/reddit-admin/schedule/today',
      '/api/reddit-admin/auth',
      '/api/reddit-admin/posts',
      '/api/reddit-admin/analytics'
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
  console.log(`📧 Email endpoints: http://localhost:${PORT}/api/send-welcome-email/*`); // UPDATED
  console.log(`🎵 Song review notifications: http://localhost:${PORT}/api/send-welcome-email/send-song-reviewed`); // UPDATED
  console.log(`🤖 Gemini AI endpoints: http://localhost:${PORT}/api/reddit-admin/generate-comment`);
  console.log(`🤖 Automation system: http://localhost:${PORT}/api/reddit-admin/cron-status`);
  console.log(`⏰ Cron scheduler: http://localhost:${PORT}/api/reddit-admin/cron-status`);
  console.log(`📈 Trends API: http://localhost:${PORT}/api/trends/music`);
  console.log(`🧪 Dev Trends: http://localhost:${PORT}/api/trends/dev/music`);
  console.log(`🔗 Reddit Admin: http://localhost:${PORT}/api/reddit-admin/admin`);
  console.log(`🔧 CORS enabled for production domains`);
});