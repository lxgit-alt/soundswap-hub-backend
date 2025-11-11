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
import redditAutomationRoutes from './api/reddit-automation.js';
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
app.use('/api/reddit-automation', redditAutomationRoutes);
app.use('/api/trends', trendsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '1.0.0',
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
      reddit_automation: process.env.GOOGLE_GEMINI_API_KEY ? 'ready' : 'needs_gemini_key',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'configured' : 'not_configured'
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '1.0.0',
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
      reddit_admin: '/api/reddit-admin/*',
      reddit_automation: '/api/reddit-automation/*'
    },
    email_services: {
      welcome: 'POST /api/email/send-welcome-email',
      password_reset: 'POST /api/email/send-password-reset',
      song_reviewed: 'POST /api/email/send-song-reviewed',
      test: 'GET /api/email/test'
    },
    reddit_automation_services: {
      start: 'POST /api/reddit-automation/start',
      stop: 'POST /api/reddit-automation/stop',
      status: 'GET /api/reddit-automation/status',
      trigger: 'POST /api/reddit-automation/trigger-now',
      test: 'GET /api/reddit-automation/test-reddit'
    },
    ai_features: {
      comment_generation: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      dm_replies: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      post_analysis: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      automation: process.env.GOOGLE_GEMINI_API_KEY ? 'ready' : 'needs_api_key'
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
      '/api/email/test',
      '/api/trends/music',
      '/api/trends/content-ideas',
      '/api/reddit-admin/admin',
      '/api/reddit-admin/generate-comment',
      '/api/reddit-admin/generate-reply',
      '/api/reddit-admin/analyze-post',
      '/api/reddit-admin/targets',
      '/api/reddit-admin/schedule/today',
      '/api/reddit-automation/start',
      '/api/reddit-automation/stop',
      '/api/reddit-automation/status',
      '/api/reddit-automation/trigger-now',
      '/api/reddit-automation/test-reddit'
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
    console.log(`🤖 Reddit Automation: http://localhost:${PORT}/api/reddit-automation/status`);
    console.log(`🎯 Total targets: 6 subreddits, 2.83M audience`);
  });
}