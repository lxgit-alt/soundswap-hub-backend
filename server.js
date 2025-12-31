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
import lyricVideoRoutes from './api/generate-video.js';
import doodleArtRoutes from './api/doodle-art.js'; // CORRECTED PATH - from './api/doodle-art.js'
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// CORS configuration - Add Vercel and local origins for video generation
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3001',
    'https://soundswap.onrender.com',
    'https://sound-swap-frontend.onrender.com',
    'https://soundswap-backend.vercel.app',
    'https://soundswap.live',
    'https://www.soundswap.live',
    'https://soundswap-hub.vercel.app',
    'https://soundswap-hub-git-main-thamindas-projects.vercel.app',
    /\.vercel\.app$/ // Allow all Vercel subdomains
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Body parsing middleware with increased limit for video and image generation
app.use(express.json({ limit: '20mb' })); // Changed from 50mb to 20mb for sketches
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

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

// Lyric Video API - Consolidated endpoints
app.use('/api/lyric-video', lyricVideoRoutes);
app.use('/api/generate-video', lyricVideoRoutes); // Alias for compatibility

// ADD THESE NEW ROUTES FOR DOODLE-TO-ART
app.use('/api/doodle-art', doodleArtRoutes);
app.use('/api/ai-art', doodleArtRoutes); // Alias for convenience

// Health check endpoint with enhanced premium features info
app.get('/api/health', (req, res) => {
  const currentTime = new Date().toLocaleTimeString('en-US', { 
    timeZone: process.env.APP_TIMEZONE || 'America/New_York',
    hour12: false 
  }).slice(0, 5);
  
  const currentDay = new Date().toLocaleDateString('en-US', { 
    timeZone: process.env.APP_TIMEZONE || 'America/New_York',
    weekday: 'long'
  }).toLowerCase();

  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '2.0.0', // Updated version with premium features focus
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    timezone: process.env.APP_TIMEZONE || 'America/New_York',
    currentTime: currentTime,
    currentDay: currentDay,
    services: {
      spots: 'operational',
      pairings: 'operational',
      feedback: 'operational',
      achievements: 'operational',
      founder_activation: 'operational',
      email: process.env.GMAIL_USER ? 'configured' : 'not_configured',
      trends: 'operational',
      reddit_admin: 'operational',
      lyric_video: process.env.HF_TOKEN ? 'configured' : 'not_configured',
      doodle_art: process.env.REPLICATE_API_TOKEN ? 'configured' : 'not_configured',
      reddit_automation: 'active',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'configured' : 'not_configured',
      educational_posts: 'active',
      top50_promotion: 'active',
      chart_notifications: 'active',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'configured' : 'not_configured',
      premium_feature_focus: 'active',
      lead_tracking: 'active',
      rate_limit_management: 'active'
    },
    premium_features: {
      lyric_video_generator: {
        name: 'AI Lyric Video Generator',
        status: process.env.HF_TOKEN ? 'active' : 'disabled',
        premium_features: ['AI Autopilot', 'Physics animations', 'Premium effects', '4K export'],
        target_audience: 'Musicians, video editors, motion designers',
        price_range: '$15-$50 per video'
      },
      doodle_art_generator: {
        name: 'Doodle-to-Art AI Generator',
        status: process.env.REPLICATE_API_TOKEN ? 'active' : 'disabled',
        premium_features: ['AI Art Generation', 'Spotify Canvas', 'Premium motion', 'HD exports'],
        target_audience: 'Digital artists, AI enthusiasts, Spotify creators',
        price_range: '$10-$30 per animation'
      }
    },
    reddit_stats: {
      total_subreddits: 12,
      new_premium_subreddits: 8,
      total_audience: '5M+',
      daily_comments: 15,
      premium_focus_rate: '80%',
      features: 'Rate limit aware, lead tracking, daily reset',
      reddit_api: process.env.REDDIT_CLIENT_ID ? 'integrated' : 'simulated'
    },
    video_generation_features: {
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
      webhook_callback: 'POST /api/generate-video?action=webhook',
      
      // Technical details
      ai_video_generation: process.env.HF_TOKEN ? 'active' : 'disabled',
      visual_styles: ['anime', 'cinematic', 'abstract', 'retro', 'nature', 'minimal'],
      max_duration: '2m30s',
      max_resolution: '1080p',
      max_scenes: 15,
      beam_integration: process.env.BEAM_API_KEY ? 'active' : 'disabled',
      storage_management: 'active'
    },
    doodle_art_features: {
      endpoints: {
        test: 'GET /api/doodle-art/test',
        generate: 'POST /api/doodle-art/generate',
        aliases: ['/api/ai-art/test', '/api/ai-art/generate']
      },
      model: 'Replicate ControlNet Scribble',
      conditioning_scale: '0.1 (creative) to 1.0 (strict)',
      image_resolution: '512px',
      cost_per_generation: '$0.01 - $0.02',
      generation_time: '5-8 seconds',
      nsfw_filter: 'enabled',
      text_rendering_warning: 'AI may not render text accurately'
    },
    reddit_premium_endpoints: {
      // NEW PREMIUM FEATURE ENDPOINTS
      premium_analytics: 'GET /api/reddit-admin/premium-analytics',
      generate_premium_content: 'POST /api/reddit-admin/generate-premium-content',
      optimized_schedule: 'GET /api/reddit-admin/optimized-schedule',
      post_premium_feature: 'POST /api/reddit-admin/post-premium-feature',
      reset_daily: 'POST /api/reddit-admin/reset-daily'
    }
  });
});

// Root endpoint with consolidated premium features API info
app.get('/', (req, res) => {
  const currentTime = new Date().toLocaleTimeString('en-US', { 
    timeZone: process.env.APP_TIMEZONE || 'America/New_York',
    hour12: false 
  }).slice(0, 5);
  
  const currentDay = new Date().toLocaleDateString('en-US', { 
    timeZone: process.env.APP_TIMEZONE || 'America/New_York',
    weekday: 'long'
  }).toLowerCase();

  res.json({
    success: true,
    message: 'SoundSwap API - Backend service is running',
    version: '2.0.0', // Updated version with premium focus
    timestamp: new Date().toISOString(),
    timezone: process.env.APP_TIMEZONE || 'America/New_York',
    currentTime: currentTime,
    currentDay: currentDay,
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
      lyric_video: '/api/lyric-video/*',
      generate_video: '/api/generate-video/*',
      doodle_art: '/api/doodle-art/*',
      ai_art: '/api/ai-art/*'
    },
    video_generation_api: {
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
    doodle_to_art_api: {
      endpoints: {
        test_connection: 'GET /api/doodle-art/test - Test Replicate API connection',
        generate_art: 'POST /api/doodle-art/generate - Generate art from sketch',
        aliases: ['/api/ai-art/test', '/api/ai-art/generate']
      },
      parameters: {
        sketch: 'Base64 image data URL (required)',
        prompt: 'Text description of desired art (required)',
        conditioningScale: 'Number from 0.1 to 1.0 (optional, default: 0.8)'
      },
      features: {
        creativity_slider: 'Control how closely the AI follows your sketch',
        nsfw_protection: 'Built-in content filter',
        fast_generation: '5-8 seconds per image',
        cost_effective: '$0.01 - $0.02 per generation'
      },
      tips: {
        text_rendering: 'AI may not render text accurately. Add text/logo afterwards.',
        sketch_quality: 'Clear, black-on-white sketches work best.',
        prompt_details: 'Detailed prompts yield better results.'
      }
    },
    reddit_premium_endpoints: {
      // NEW PREMIUM FEATURE ENDPOINTS
      premium_analytics: 'GET /api/reddit-admin/premium-analytics - Track premium lead generation',
      generate_premium_content: 'POST /api/reddit-admin/generate-premium-content - Generate premium-focused content',
      optimized_schedule: 'GET /api/reddit-admin/optimized-schedule - View optimized posting schedule',
      post_premium_feature: 'POST /api/reddit-admin/post-premium-feature - Manual premium feature posting',
      reset_daily: 'POST /api/reddit-admin/reset-daily - Manual daily reset',
      
      // Existing endpoints
      cron_status: 'GET /api/reddit-admin/cron-status',
      manual_post: 'POST /api/reddit-admin/manual-post',
      educational_post: 'POST /api/reddit-admin/create-educational-post',
      top50_post: 'POST /api/reddit-admin/create-top50-post',
      reset_counts: 'POST /api/reddit-admin/reset-counts',
      generate_comment: 'POST /api/reddit-admin/generate-comment',
      generate_reply: 'POST /api/reddit-admin/generate-reply',
      analyze_post: 'POST /api/reddit-admin/analyze-post',
      test_gemini: 'GET /api/reddit-admin/test-gemini',
      test_reddit: 'GET /api/reddit-admin/test-reddit',
      cron: 'POST /api/reddit-admin/cron'
    },
    premium_features_info: {
      lyric_video_generator: 'AI-powered lyric videos with premium animations',
      doodle_art_generator: 'Sketch-to-art with Spotify Canvas animation',
      target_subreddits: [
        'videoediting', 'AfterEffects', 'MotionDesign',
        'digitalart', 'StableDiffusion', 'ArtistLounge',
        'MusicMarketing', 'Spotify'
      ],
      total_reach: '5M+ across 12 subreddits',
      premium_focus_rate: '80% of Reddit content focuses on premium features'
    },
    automation_updates: {
      rate_limit_safe: '15 posts/day maximum',
      lead_tracking: 'All premium mentions saved as leads',
      daily_reset: 'Automatic daily count reset',
      premium_content: '80% of generated content focuses on premium features',
      audience_targeting: '8 new premium-focused subreddits added'
    }
  });
});

// Handle 404 errors - Updated with premium feature endpoints
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    video_generation_endpoints: [
      // Video Generation Endpoints
      'POST /api/generate-video - Regular video generation',
      'POST /api/generate-video/optimized - Optimized video generation',
      
      // Status Endpoints
      'GET /api/generate-video?action=status&jobId={jobId} - Regular job status',
      'GET /api/generate-video/optimized/status?jobId={jobId} - Optimized job status',
      
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
      'POST /api/doodle-art/generate - Generate art from sketch (requires: sketch, prompt)',
      'GET /api/ai-art/test - Alias for connection test',
      'POST /api/ai-art/generate - Alias for generation'
    ],
    reddit_premium_endpoints: [
      // NEW PREMIUM FEATURE ENDPOINTS
      'GET /api/reddit-admin/premium-analytics - Track premium lead generation',
      'POST /api/reddit-admin/generate-premium-content - Generate premium-focused content',
      'GET /api/reddit-admin/optimized-schedule - View optimized posting schedule',
      'POST /api/reddit-admin/post-premium-feature - Manual premium feature posting',
      'POST /api/reddit-admin/reset-daily - Manual daily reset'
    ],
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
      '/api/reddit-admin/reset-daily',
      '/api/reddit-admin/targets',
      '/api/reddit-admin/schedule/today',
      '/api/reddit-admin/optimized-schedule',
      '/api/reddit-admin/premium-analytics',
      '/api/reddit-admin/generate-premium-content',
      '/api/reddit-admin/post-premium-feature',
      '/api/reddit-admin/generate-comment',
      '/api/reddit-admin/generate-reply',
      '/api/reddit-admin/analyze-post',
      '/api/reddit-admin/test-gemini',
      '/api/reddit-admin/test-reddit',
      '/api/reddit-admin/auth',
      '/api/reddit-admin/posts',
      '/api/reddit-admin/analytics',
      '/api/reddit-admin/cron',
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
    const currentTime = new Date().toLocaleTimeString('en-US', { 
      timeZone: process.env.APP_TIMEZONE || 'America/New_York',
      hour12: false 
    }).slice(0, 5);
    
    const currentDay = new Date().toLocaleDateString('en-US', { 
      timeZone: process.env.APP_TIMEZONE || 'America/New_York',
      weekday: 'long'
    }).toLowerCase();

    console.log(`🚀 Backend running on http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`⏰ Timezone: ${process.env.APP_TIMEZONE || 'America/New_York'}`);
    console.log(`📅 Current time: ${currentTime} on ${currentDay}`);
    console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
    console.log(`🎵 Lyric Video API: http://localhost:${PORT}/api/lyric-video`);
    console.log(`🎵 Generate Video Alias: http://localhost:${PORT}/api/generate-video`);
    
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
    console.log(`   GET  /api/generate-video/storage-usage - Storage statistics`);
    console.log(`   POST /api/generate-video/manual-cleanup - Manual cleanup`);
    console.log(`   GET  /api/generate-video/cleanup-expired-videos - Trigger scheduled cleanup`);
    console.log(`   GET  /api/generate-video/physics-animations - List physics animations`);
    console.log(`   POST /api/generate-video?action=webhook - Webhook callback`);
    
    console.log(`\n💎 REDDIT PREMIUM FEATURE ENDPOINTS:`);
    console.log(`   GET  /api/reddit-admin/premium-analytics - Premium lead tracking`);
    console.log(`   POST /api/reddit-admin/generate-premium-content - Generate premium content`);
    console.log(`   GET  /api/reddit-admin/optimized-schedule - Optimized posting schedule`);
    console.log(`   POST /api/reddit-admin/post-premium-feature - Manual premium post`);
    console.log(`   POST /api/reddit-admin/reset-daily - Manual daily reset`);
    
    console.log(`\n📧 Email endpoints: http://localhost:${PORT}/api/email/*`);
    console.log(`📈 Trends API: http://localhost:${PORT}/api/trends/music`);
    console.log(`🔗 Reddit Admin: http://localhost:${PORT}/api/reddit-admin/admin`);
    console.log(`🤖 Reddit Automation: http://localhost:${PORT}/api/reddit-admin/cron-status`);
    console.log(`🔌 Reddit API Test: http://localhost:${PORT}/api/reddit-admin/test-reddit`);
    console.log(`📚 Educational Posts: http://localhost:${PORT}/api/reddit-admin/create-educational-post`);
    console.log(`🎵 Top 50 Promotion: http://localhost:${PORT}/api/reddit-admin/create-top50-post`);
    console.log(`🤖 Gemini AI: http://localhost:${PORT}/api/reddit-admin/test-gemini`);
    console.log(`⏰ Cron Endpoint: http://localhost:${PORT}/api/reddit-admin/cron`);
    console.log(`🏆 Chart Notifications: http://localhost:${PORT}/api/email/send-top10-chart`);
    console.log(`📊 Stats: 15 posts/day across 12 subreddits (5M+ audience, 80% premium focus)`);
    
    console.log(`\n🔧 Configuration Status:`);
    console.log(`   🔐 Reddit API: ${process.env.REDDIT_CLIENT_ID ? 'LIVE INTEGRATION' : 'SIMULATION MODE'}`);
    console.log(`   🎨 Hugging Face AI: ${process.env.HF_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   🖌️  Replicate AI: ${process.env.REPLICATE_API_TOKEN ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   ⚡ Beam Integration: ${process.env.BEAM_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   🤖 Gemini AI: ${process.env.GOOGLE_GEMINI_API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`   🔐 CRON_SECRET: ${process.env.CRON_SECRET ? 'Configured' : 'Not configured'}`);
    console.log(`   🎨 Doodle-to-Art: ${process.env.REPLICATE_API_TOKEN ? 'READY ✅' : 'NEEDS REPLICATE API TOKEN ❌'}`);
    console.log(`   💎 Premium Feature Focus: ACTIVE ✅`);
    console.log(`   🎯 New Premium Subreddits: 8 added`);
    console.log(`   💡 Tip: 80% of Reddit content now focuses on premium features`);
  });
}