import express from 'express';
import cors from 'cors';
import spotsRoutes from './api/spots.js';
import pairingsRoutes from './api/pairings.js';
import feedbackRoutes from './api/feedback.js';
import achievementsRoutes from './api/achievements.js';
import founderActivationRoutes from './api/founder-activation.js';
import auditFoundersRoutes from './api/audit-founders.js';
import leaderboardRoutes from './api/leaderboard.js';
import emailRoutes from './api/send-welcome-email.js';
import trendsRoutes from './api/trends.js';
import redditAdminRoutes from './api/reddit-admin.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// CORS configuration
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://soundswap.onrender.com',
    'https://sound-swap-frontend.onrender.com',
    'https://soundswap-backend.vercel.app',
    'https://soundswap.live',
    'https://www.soundswap.live'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/spots', spotsRoutes);
app.use('/api/pairings', pairingsRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/achievements', achievementsRoutes);
app.use('/api/founder-activation', founderActivationRoutes);
app.use('/api/audit-founders', auditFoundersRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/reddit-admin', redditAdminRoutes);
app.use('/api/trends', trendsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '1.2.0', // Updated version
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      spots: 'operational',
      pairings: 'operational',
      feedback: 'operational',
      achievements: 'operational',
      founder_activation: 'operational',
      email: process.env.GMAIL_USER ? 'configured' : 'not_configured',
      trends: 'operational',
      reddit_admin: 'operational',
      reddit_automation: 'active',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'configured' : 'not_configured',
      educational_posts: 'active',
      top50_promotion: 'active',
      chart_notifications: 'active',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'configured' : 'not_configured' // NEW: Added Reddit API status
    },
    reddit_stats: {
      total_subreddits: 6,
      total_audience: '2.8M+',
      daily_comments: 52,
      weekly_educational_posts: '2-3 per subreddit',
      weekly_top50_posts: 'Weekly promotions',
      features: 'Always redirects to soundswap.live',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'integrated' : 'simulated' // NEW: Added Reddit API integration status
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '1.2.0', // Updated version
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      spots: '/api/spots',
      pairings: '/api/pairings',
      feedback: '/api/feedback',
      achievements: '/api/achievements',
      founder_activation: '/api/founder-activation',
      audit_founders: '/api/audit-founders',
      leaderboard: '/api/leaderboard',
      email: '/api/email/*',
      trends: '/api/trends/*',
      reddit_admin: '/api/reddit-admin/*'
    },
    email_services: {
      welcome: 'POST /api/email/send-welcome-email',
      password_reset: 'POST /api/email/send-password-reset',
      song_reviewed: 'POST /api/email/send-song-reviewed',
      top10_chart: 'POST /api/email/send-top10-chart',
      test: 'GET /api/email/test'
    },
    reddit_automation: {
      status: 'GET /api/reddit-admin/cron-status',
      manual_post: 'POST /api/reddit-admin/manual-post',
      educational_post: 'POST /api/reddit-admin/create-educational-post',
      top50_post: 'POST /api/reddit-admin/create-top50-post',
      reset_counts: 'POST /api/reddit-admin/reset-counts',
      targets: 'GET /api/reddit-admin/targets',
      schedule: 'GET /api/reddit-admin/schedule/today',
      generate_comment: 'POST /api/reddit-admin/generate-comment',
      generate_reply: 'POST /api/reddit-admin/generate-reply',
      analyze_post: 'POST /api/reddit-admin/analyze-post',
      test_gemini: 'GET /api/reddit-admin/test-gemini',
      test_reddit: 'GET /api/reddit-admin/test-reddit', // NEW: Added test-reddit endpoint
      cron: 'POST /api/reddit-admin/cron'
    },
    automation_stats: {
      daily_comments: 52,
      weekly_educational_posts: '12-18 total',
      audience_reach: '2.8M+ musicians',
      subreddits: 6,
      features: 'AI-powered, always redirects to soundswap.live',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'live' : 'simulated' // NEW: Added API mode
    }
  });
});

// Handle 404 errors
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    availableEndpoints: [
      '/api/health',
      '/api/spots',
      '/api/pairings',
      '/api/feedback',
      '/api/achievements',
      '/api/founder-activation',
      '/api/audit-founders',
      '/api/leaderboard',
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
      '/api/reddit-admin/cron-status',
      '/api/reddit-admin/manual-post',
      '/api/reddit-admin/create-educational-post',
      '/api/reddit-admin/create-top50-post',
      '/api/reddit-admin/reset-counts',
      '/api/reddit-admin/targets',
      '/api/reddit-admin/schedule/today',
      '/api/reddit-admin/generate-comment',
      '/api/reddit-admin/generate-reply',
      '/api/reddit-admin/analyze-post',
      '/api/reddit-admin/test-gemini',
      '/api/reddit-admin/test-reddit', // NEW: Added test-reddit endpoint
      '/api/reddit-admin/auth',
      '/api/reddit-admin/posts',
      '/api/reddit-admin/analytics',
      '/api/reddit-admin/cron'
    ]
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? {} : error.message
  });
});

// For Vercel serverless functions, export the app
export default app;

// For local development, start the server
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
    console.log(`📧 Email endpoints: http://localhost:${PORT}/api/email/*`);
    console.log(`📈 Trends API: http://localhost:${PORT}/api/trends/music`);
    console.log(`🔗 Reddit Admin: http://localhost:${PORT}/api/reddit-admin/admin`);
    console.log(`🤖 Reddit Automation: http://localhost:${PORT}/api/reddit-admin/cron-status`);
    console.log(`🔌 Reddit API Test: http://localhost:${PORT}/api/reddit-admin/test-reddit`); // NEW: Added test-reddit
    console.log(`📚 Educational Posts: http://localhost:${PORT}/api/reddit-admin/create-educational-post`);
    console.log(`🎵 Top 50 Promotion: http://localhost:${PORT}/api/reddit-admin/create-top50-post`);
    console.log(`🤖 Gemini AI: http://localhost:${PORT}/api/reddit-admin/test-gemini`);
    console.log(`⏰ Cron Endpoint: http://localhost:${PORT}/api/reddit-admin/cron`);
    console.log(`🏆 Chart Notifications: http://localhost:${PORT}/api/email/send-top10-chart`);
    console.log(`📊 Stats: 52 comments/day + 2-3 educational posts/week across 6 subreddits (2.8M+ audience)`);
    console.log(`🔐 Reddit API: ${process.env.REDDIT_CLIENT_ID ? 'LIVE INTEGRATION' : 'SIMULATION MODE'}`); // NEW: Added API mode status
  });
}