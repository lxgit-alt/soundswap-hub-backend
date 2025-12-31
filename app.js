import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import helmet from 'helmet';
import redditAdminRoutes from './src/api/reddit-admin.js';
import emailRoutes from './src/api/send-welcome-email.js';
import lyricVideoRoutes from './src/api/generate-video.js';
import doodleArtRoutes from './api/doodle-art.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// CORS configuration - Add Vercel and local origins
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const allowedOrigins = [
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
      /\.vercel\.app$/
    ];

    if (allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) return allowed.test(origin);
      return allowed === origin;
    })) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Body parser with increased limit for image generation
app.use(express.json({ limit: '20mb' })); // Updated from 50mb to 20mb for sketches
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ==================== ROUTES MOUNTING ====================

app.use('/reddit-admin', redditAdminRoutes);
app.use('/api/reddit-admin', redditAdminRoutes);
app.use('/api/email', emailRoutes);
app.use('/', trendsRoutes);

// Lyric Video API
app.use('/api/lyric-video', lyricVideoRoutes);
app.use('/api/generate-video', lyricVideoRoutes);

// ADD THESE NEW ROUTES FOR DOODLE-TO-ART
app.use('/api/doodle-art', doodleArtRoutes);
app.use('/api/ai-art', doodleArtRoutes); // Alias for convenience

// ==================== ENDPOINTS ====================

// Health check endpoint - Updated with premium features info
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
    version: '2.0.0', // Updated version with premium features focus
    services: {
      trends: 'operational',
      email: process.env.GMAIL_USER ? 'configured' : 'not_configured',
      database: 'mock_data',
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
      rate_limit_management: 'active'
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

// Enhanced API status endpoint - Updated with premium features
app.get('/api/status', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.json({
    success: true,
    service: 'soundswap-backend',
    status: 'operational',
    version: '2.0.0', // Updated version with premium focus
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
      lyric_video: '/api/lyric-video/*',
      generate_video: '/api/generate-video/*',
      doodle_art: '/api/doodle-art/*',
      ai_art: '/api/ai-art/*' // Alias
    },
    video_generation_endpoints: {
      // Video Generation Endpoints
      generate_video: 'POST /api/generate-video - Regular video generation',
      generate_video_optimized: 'POST /api/generate-video/optimized - Optimized video generation',
      
      // Status Endpoints
      regular_job_status: 'GET /api/generate-video?action=status&jobId={jobId} - Regular job status',
      optimized_job_status: 'GET /api/generate-video/optimized/status?jobId={jobId} - Optimized job status',
      
      // Storage Management Endpoints
      storage_usage: 'GET /api/generate-video/storage-usage - Get storage statistics',
      manual_cleanup: 'POST /api/generate-video/manual-cleanup - Manual cleanup',
      cleanup_expired_videos: 'GET /api/generate-video/cleanup-expired-videos - Trigger scheduled cleanup',
      
      // Physics Animations Endpoint
      physics_animations: 'GET /api/generate-video/physics-animations - List physics animations',
      
      // Webhook/Callback Endpoint
      webhook_callback: 'POST /api/generate-video?action=webhook - Webhook callback'
    },
    doodle_art_endpoints: {
      test_connection: 'GET /api/doodle-art/test - Test Replicate API connection',
      generate_art: 'POST /api/doodle-art/generate - Generate art from sketch',
      parameters: {
        sketch: 'Base64 image data URL',
        prompt: 'Text description of desired art',
        conditioningScale: 'Number from 0.1 to 1.0 (Creativity vs Strictness)'
      }
    },
    reddit_premium_endpoints: {
      // NEW PREMIUM FEATURE ENDPOINTS
      premium_analytics: 'GET /api/reddit-admin/premium-analytics - Track premium lead generation',
      generate_premium_content: 'POST /api/reddit-admin/generate-premium-content - Generate premium-focused content',
      optimized_schedule: 'GET /api/reddit-admin/optimized-schedule - View posting schedule with premium focus',
      post_premium_feature: 'POST /api/reddit-admin/post-premium-feature - Manual premium feature posting',
      reset_daily: 'POST /api/reddit-admin/reset-daily - Manual daily reset',
      
      // Existing endpoints
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
      lyric_video_generation: process.env.HF_TOKEN ? 'active' : 'disabled',
      doodle_to_art: process.env.REPLICATE_API_TOKEN ? 'active' : 'disabled',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      reddit_automation: 'active',
      cron_scheduler: 'running',
      vercel_cron: process.env.CRON_SECRET ? 'active' : 'disabled',
      educational_posts: 'active',
      top50_promotion: 'active',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'live' : 'simulated',
      premium_feature_focus: 'active',
      lead_tracking: 'active',
      rate_limit_management: 'active'
    },
    premium_feature_targets: {
      total_subreddits: 12,
      new_premium_subreddits: [
        'videoediting',
        'AfterEffects',
        'MotionDesign',
        'digitalart',
        'StableDiffusion',
        'ArtistLounge',
        'MusicMarketing',
        'Spotify'
      ],
      total_audience: '5M+',
      daily_limit: '15 comments',
      premium_focus_rate: '80% of content'
    }
  });
});

// Root endpoint - Updated with premium features
app.get('/', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();

  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '2.0.0', // Updated version with premium focus
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
      lyric_video: '/api/lyric-video',
      generate_video: '/api/generate-video',
      doodle_art: '/api/doodle-art/generate',
      ai_art: '/api/ai-art/generate',
      gemini_ai: '/api/reddit-admin/generate-comment',
      automation: '/api/reddit-admin/cron-status',
      reddit_api_test: '/api/reddit-admin/test-reddit',
      cron: '/api/reddit-admin/cron (POST)',
      // NEW PREMIUM ENDPOINTS
      premium_analytics: '/api/reddit-admin/premium-analytics',
      generate_premium_content: '/api/reddit-admin/generate-premium-content',
      optimized_schedule: '/api/reddit-admin/optimized-schedule',
      post_premium_feature: '/api/reddit-admin/post-premium-feature',
      reset_daily: '/api/reddit-admin/reset-daily'
    },
    video_generation_api: {
      // Video Generation Endpoints
      generate_video: 'POST /api/generate-video',
      generate_video_optimized: 'POST /api/generate-video/optimized',
      
      // Status Endpoints
      regular_job_status: 'GET /api/generate-video?action=status&jobId={jobId}',
      optimized_job_status: 'GET /api/generate-video/optimized/status?jobId={jobId}',
      
      // Storage Management Endpoints
      storage_usage: 'GET /api/generate-video/storage-usage',
      manual_cleanup: 'POST /api/generate-video/manual-cleanup',
      cleanup_expired_videos: 'GET /api/generate-video/cleanup-expired-videos',
      
      // Physics Animations Endpoint
      physics_animations: 'GET /api/generate-video/physics-animations',
      
      // Webhook/Callback Endpoint
      webhook_callback: 'POST /api/generate-video?action=webhook'
    },
    doodle_to_art_api: {
      generate: 'POST /api/doodle-art/generate',
      test: 'GET /api/doodle-art/test',
      features: {
        model: 'ControlNet Scribble',
        creativity_slider: '0.1 (creative) to 1.0 (strict)',
        nsfw_filter: 'enabled',
        cost: '$0.01 - $0.02 per generation',
        speed: '5-8 seconds',
        text_warning: 'AI may not render text accurately'
      }
    },
    reddit_premium_endpoints: {
      premium_analytics: 'GET /api/reddit-admin/premium-analytics - Track premium lead generation',
      generate_premium_content: 'POST /api/reddit-admin/generate-premium-content - Generate premium-focused content',
      optimized_schedule: 'GET /api/reddit-admin/optimized-schedule - View optimized posting schedule',
      post_premium_feature: 'POST /api/reddit-admin/post-premium-feature - Manual premium feature post',
      reset_daily: 'POST /api/reddit-admin/reset-daily - Manual daily reset'
    },
    ai_features: {
      comment_generation: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      dm_replies: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      post_analysis: process.env.GOOGLE_GEMINI_API_KEY ? 'active' : 'disabled',
      audio_analysis: process.env.HF_TOKEN ? 'active' : 'disabled',
      lyric_enhancement: process.env.HF_TOKEN ? 'active' : 'disabled',
      image_generation: process.env.HF_TOKEN ? 'active' : 'disabled',
      doodle_to_art: process.env.REPLICATE_API_TOKEN ? 'active' : 'disabled',
      automation_system: 'active',
      cron_scheduler: 'running',
      vercel_cron: process.env.CRON_SECRET ? 'active' : 'disabled',
      educational_posts: 'active',
      top50_promotion: 'active',
      chart_notifications: 'active',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'live' : 'simulated',
      premium_feature_focus: 'active'
    },
    reddit_automation_updates: {
      total_subreddits: 12,
      new_premium_subreddits: 8,
      total_audience: '5M+',
      daily_comments: '15 posts/day (rate limit safe)',
      premium_focus: '80% of content focuses on premium features',
      features: 'Rate limit aware, lead tracking, daily reset',
      api_mode: process.env.REDDIT_CLIENT_ID ? 'LIVE REDDIT API' : 'SIMULATION MODE'
    }
  });
});

// Handle 404 - Updated with premium feature endpoints
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
    video_generation_endpoints: [
      // Video Generation Endpoints
      'POST /api/generate-video - Regular video generation',
      'POST /api/generate-video/optimized - Optimized video generation',
      
      // Status Endpoints
      'GET /api/generate-video?action=status&jobId=... - Regular job status',
      'GET /api/generate-video/optimized/status?jobId=... - Optimized job status',
      
      // Storage Management Endpoints
      'GET /api/generate-video/storage-usage - Get storage statistics',
      'POST /api/generate-video/manual-cleanup - Manual cleanup',
      'GET /api/generate-video/cleanup-expired-videos - Trigger scheduled cleanup',
      
      // Physics Animations Endpoint
      'GET /api/generate-video/physics-animations - List physics animations',
      
      // Webhook/Callback Endpoint
      'POST /api/generate-video?action=webhook - Webhook callback'
    ],
    doodle_art_endpoints: [
      'GET /api/doodle-art/test - Test Replicate API connection',
      'POST /api/doodle-art/generate - Generate art from sketch',
      'GET /api/ai-art/test - Alias for connection test',
      'POST /api/ai-art/generate - Alias for generation'
    ],
    reddit_premium_endpoints: [
      // NEW PREMIUM FEATURE ENDPOINTS
      'GET /api/reddit-admin/premium-analytics - Track premium lead generation',
      'POST /api/reddit-admin/generate-premium-content - Generate premium-focused content',
      'GET /api/reddit-admin/optimized-schedule - View optimized posting schedule',
      'POST /api/reddit-admin/post-premium-feature - Manual premium feature post',
      'POST /api/reddit-admin/reset-daily - Manual daily reset'
    ],
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
      '/api/reddit-admin/test-reddit',
      '/api/reddit-admin/cron-status',
      '/api/reddit-admin/manual-post',
      '/api/reddit-admin/create-educational-post',
      '/api/reddit-admin/create-top50-post',
      '/api/reddit-admin/reset-counts',
      '/api/reddit-admin/reset-daily',
      '/api/reddit-admin/targets',
      '/api/reddit-admin/schedule/today',
      '/api/reddit-admin/optimized-schedule',
      '/api/reddit-admin/premium-analytics',
      '/api/reddit-admin/generate-premium-content',
      '/api/reddit-admin/post-premium-feature',
      '/api/reddit-admin/auth',
      '/api/reddit-admin/posts',
      '/api/reddit-admin/analytics',
      '/api/reddit-admin/cron (POST)',
      '/api/lyric-video',
      '/api/generate-video',
      '/api/doodle-art/test',
      '/api/doodle-art/generate',
      '/api/ai-art/test',
      '/api/ai-art/generate'
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
  
  console.log(`\n🎨 DOODLE-TO-ART ENDPOINTS:`);
  console.log(`   GET  /api/doodle-art/test - Test Replicate connection`);
  console.log(`   POST /api/doodle-art/generate - Generate art from sketch`);
  console.log(`   GET  /api/ai-art/test - Alias for connection test`);
  console.log(`   POST /api/ai-art/generate - Alias for generation`);
  
  console.log(`\n🎬 VIDEO GENERATION ENDPOINTS:`);
  console.log(`   POST /api/generate-video - Regular video generation`);
  console.log(`   POST /api/generate-video/optimized - Optimized video generation`);
  console.log(`   GET  /api/generate-video?action=status&jobId=... - Regular job status`);
  console.log(`   GET  /api/generate-video/optimized/status?jobId=... - Optimized job status`);
  
  console.log(`\n💎 REDDIT PREMIUM FEATURE ENDPOINTS:`);
  console.log(`   GET  /api/reddit-admin/premium-analytics - Premium lead tracking`);
  console.log(`   POST /api/reddit-admin/generate-premium-content - Generate premium content`);
  console.log(`   GET  /api/reddit-admin/optimized-schedule - Optimized posting schedule`);
  console.log(`   POST /api/reddit-admin/post-premium-feature - Manual premium post`);
  console.log(`   POST /api/reddit-admin/reset-daily - Manual daily reset`);
  
  console.log(`\n📧 Email endpoints: http://localhost:${PORT}/api/email/*`);
  console.log(`🤖 Reddit Admin: http://localhost:${PORT}/api/reddit-admin/admin`);
  console.log(`📊 API Status: http://localhost:${PORT}/api/status`);
  
  console.log(`\n🔧 Configuration Status:`);
  console.log(`   🔐 CRON_SECRET: ${process.env.CRON_SECRET ? 'Configured' : 'Not configured'}`);
  console.log(`   🤖 Gemini AI: ${process.env.GOOGLE_GEMINI_API_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`   🎨 Hugging Face AI: ${process.env.HF_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log(`   🖌️  Replicate AI: ${process.env.REPLICATE_API_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log(`   ⚡ Beam Integration: ${process.env.BEAM_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log(`   🔗 Reddit API: ${process.env.REDDIT_CLIENT_ID ? 'LIVE INTEGRATION' : 'SIMULATION MODE'}`);
  console.log(`   🎨 Doodle-to-Art: ${process.env.REPLICATE_API_TOKEN ? 'READY' : 'NEEDS REPLICATE API TOKEN'}`);
  console.log(`   💎 Premium Feature Focus: ACTIVE`);
  console.log(`   🎯 Target Subreddits: 12 total (8 new premium-focused)`);
});