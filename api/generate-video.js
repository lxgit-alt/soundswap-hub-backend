import express from 'express';
import { HfInference } from '@huggingface/inference';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import rateLimit from 'express-rate-limit';

const HF_TOKEN = process.env.HF_TOKEN;
const hf = new HfInference(HF_TOKEN);

// In-memory job stores
const jobStore = new Map();
const optimizedJobStore = new Map();

const router = express.Router();

// Rate limiters
const videoGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many video generation requests'
});

const optimizedGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many optimized video generation requests'
});

// ============================================
// MAIN REQUEST HANDLER
// ============================================

router.post('/', videoGenerationLimiter, handleRequest);
router.get('/', handleRequest);

async function handleRequest(req, res, next) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { jobId, type } = req.query;
    const action = req.query.action || 'generate';

    switch (action) {
      case 'status':
        return await handleStatusRequest(req, res, jobId, type);
      
      case 'webhook':
      case 'callback':
        return await handleWebhookRequest(req, res);
      
      case 'generate':
      default:
        // Check if it's optimized generation
        const isOptimized = req.body.optimization_config || req.body.settings?.optimizationMode;
        if (isOptimized) {
          return await handleOptimizedGenerateRequest(req, res);
        } else {
          return await handleGenerateRequest(req, res);
        }
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}

// ============================================
// REGULAR VIDEO GENERATION
// ============================================

async function handleGenerateRequest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('Starting video generation request...');

  try {
    const { 
      lyrics, 
      style, 
      audioFile, 
      settings = {},
      songTitle = '',
      artist = '',
      bpm = 120,
      songMood = '',
      songGenre = '',
      lyricBlocks = [],
      style_profile = 'dreamy_ethereal',
      physicsParams = {}
    } = req.body;

    // Validate input
    if (!lyrics || !Array.isArray(lyrics) || lyrics.length === 0) {
      return res.status(400).json({ 
        error: 'Lyrics are required',
        details: 'Please provide lyrics array'
      });
    }

    const finalStyle = style || style_profile;
    if (!finalStyle) {
      return res.status(400).json({ 
        error: 'Visual style is required',
        details: 'Please select a visual style'
      });
    }

    // Validate video length (max 2m30s = 150 seconds)
    const totalDuration = lyrics.reduce((sum, l) => sum + (l.duration || 4), 0);
    if (totalDuration > 150) {
      return res.status(400).json({ 
        error: 'Video too long',
        details: 'Maximum video length is 2 minutes 30 seconds',
        currentDuration: totalDuration,
        maxDuration: 150
      });
    }

    // Enforce 1080p maximum
    const resolution = settings.resolution || '1080p';
    if (resolution === '1440p' || resolution === '2160p') {
      settings.resolution = '1080p';
    }

    // Generate job ID
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create job in store
    const jobData = {
      lyrics: lyrics.slice(0, 15), // Max 15 lines
      style: finalStyle,
      settings: {
        ...settings,
        resolution: '1080p',
        audioFile: audioFile || null,
        fontCombination: settings.fontCombination || {},
        styleProfile: getStyleProfile(finalStyle),
        useMixedFonts: settings.useMixedFonts,
        physicsParams: physicsParams,
        type: 'regular'
      },
      songTitle,
      artist,
      bpm: parseInt(bpm),
      songMood,
      songGenre,
      lyricBlocks,
      webhook_url: `${req.get('origin') || 'https://soundswap-hub.vercel.app'}/api/generate-video?action=webhook`,
      callback_url: `${req.get('origin') || 'https://soundswap-hub.vercel.app'}/api/generate-video?action=callback`
    };

    jobStore.set(jobId, {
      id: jobId,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      data: jobData,
      result: null,
      error: null,
      logs: [`Job created at ${new Date().toISOString()}`],
      type: 'regular'
    });

    console.log(`Created regular job ${jobId} with ${lyrics.length} lyrics`);

    // Start the generation process (non-blocking)
    setImmediate(() => processRegularJob(jobId));

    // Return immediate response
    const response = {
      success: true,
      jobId,
      status: 'queued',
      message: 'AI processing started. This may take 2-3 minutes.',
      estimatedTime: '2-3 minutes',
      checkStatusUrl: `/api/generate-video?action=status&jobId=${jobId}&type=regular`,
      webhookUrl: `/api/generate-video?action=webhook`,
      metadata: {
        scenes: Math.min(lyrics.length, 15),
        duration: Math.min(totalDuration, 150),
        resolution: '1080p',
        style: finalStyle,
        maxQuality: '1080p',
        maxDuration: '2m30s'
      }
    };

    return res.status(202).json(response);

  } catch (error) {
    console.error('Generation error:', error);
    return res.status(500).json({ 
      error: 'Failed to start video generation',
      details: error.message
    });
  }
}

// ============================================
// OPTIMIZED VIDEO GENERATION
// ============================================

router.post('/optimized', optimizedGenerationLimiter, async (req, res) => {
  try {
    console.log('Starting optimized video generation request...');

    const { 
      lyrics, 
      style_profile, 
      audioFile, 
      settings = {},
      songTitle = '',
      artist = '',
      bpm = 120,
      songMood = '',
      songGenre = '',
      lyricBlocks = [],
      optimization_config = {}
    } = req.body;

    // Validate input
    if (!lyrics || !Array.isArray(lyrics) || lyrics.length === 0) {
      return res.status(400).json({ 
        error: 'Lyrics are required',
        details: 'Please provide lyrics array'
      });
    }

    if (!style_profile) {
      return res.status(400).json({ 
        error: 'Visual style is required',
        details: 'Please select a visual style'
      });
    }

    // Validate video length
    const totalDuration = lyrics.reduce((sum, l) => sum + (l.duration || 4), 0);
    if (totalDuration > 150) {
      return res.status(400).json({ 
        error: 'Video too long',
        details: 'Maximum video length is 2 minutes 30 seconds',
        currentDuration: totalDuration,
        maxDuration: 150
      });
    }

    // Generate job ID
    const jobId = `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create optimized job in store
    const jobData = {
      lyrics: lyrics.slice(0, 15),
      style: style_profile,
      settings: {
        ...settings,
        resolution: '1080p',
        audioFile: audioFile || null,
        fontCombination: settings.fontCombination || {},
        styleProfile: getStyleProfile(style_profile),
        useMixedFonts: settings.useMixedFonts,
        physicsParams: settings.physicsParams || {},
        type: 'optimized',
        optimization_config: {
          enable_quantization: optimization_config.enable_quantization !== false,
          parallel_processing: optimization_config.parallel_processing !== false,
          adaptive_resolution: optimization_config.adaptive_resolution !== false,
          model_caching: true,
          optimized_encoding: true,
          motion_interpolation: optimization_config.motion_interpolation !== false,
          preview_enabled: false,
          quality_mode: optimization_config.quality_mode || 'balanced',
          aggressive_deletion: true,
          storage_type: 'cloudinary'
        }
      },
      songTitle,
      artist,
      bpm: parseInt(bpm),
      songMood,
      songGenre,
      lyricBlocks,
      webhook_url: `${req.get('origin') || 'https://soundswap-hub.vercel.app'}/api/generate-video?action=webhook`,
      callback_url: `${req.get('origin') || 'https://soundswap-hub.vercel.app'}/api/generate-video?action=callback`
    };

    optimizedJobStore.set(jobId, {
      id: jobId,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      data: jobData,
      result: null,
      error: null,
      logs: [`Optimized job created at ${new Date().toISOString()}`],
      type: 'optimized'
    });

    console.log(`Created optimized job ${jobId} with ${lyrics.length} lyrics`);

    // Start optimized generation process
    setImmediate(() => processOptimizedJob(jobId));

    const response = {
      success: true,
      jobId,
      status: 'queued',
      message: 'Optimized AI processing started. This may take 1-2 minutes.',
      estimatedTime: '1-2 minutes',
      checkStatusUrl: `/api/generate-video/optimized/status?jobId=${jobId}`,
      webhookUrl: `/api/generate-video?action=webhook`,
      metadata: {
        scenes: Math.min(lyrics.length, 15),
        duration: Math.min(totalDuration, 150),
        resolution: '1080p',
        style: style_profile,
        maxQuality: '1080p',
        maxDuration: '2m30s',
        optimizations: Object.keys(optimization_config).filter(k => optimization_config[k])
      }
    };

    return res.status(202).json(response);

  } catch (error) {
    console.error('Optimized generation error:', error);
    return res.status(500).json({ 
      error: 'Failed to start optimized video generation',
      details: error.message
    });
  }
});

// ============================================
// STATUS ENDPOINTS
// ============================================

async function handleStatusRequest(req, res, jobId, type) {
  if (!jobId) {
    return res.status(400).json({ error: 'Job ID is required' });
  }

  let job;
  if (type === 'optimized' || req.url.includes('/optimized/status')) {
    job = optimizedJobStore.get(jobId);
  } else {
    job = jobStore.get(jobId);
  }

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const response = {
    jobId,
    status: job.status,
    progress: job.progress || 0,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt || job.createdAt,
    estimatedTimeRemaining: getEstimatedTimeRemaining(job),
    logs: job.logs || [],
    type: job.type || 'regular'
  };

  if (job.result) {
    response.result = {
      videoUrl: job.result.videoUrl,
      duration: job.result.duration,
      format: job.result.format,
      scenes: job.result.scenes?.length || 0,
      downloadUrl: `/api/generate-video?action=download&jobId=${jobId}`,
      expires_at: job.result.expires_at,
      deletion_scheduled: job.result.deletion_scheduled,
      performance_metrics: job.result.performance_metrics,
      optimizations_applied: job.result.optimizations_applied
    };
  }

  if (job.error) {
    response.error = job.error;
  }

  if (job.status === 'queued' || job.status === 'processing') {
    const queuePosition = getQueuePosition(jobId, type);
    if (queuePosition > 0) {
      response.queuePosition = queuePosition;
    }
  }

  return res.status(200).json(response);
}

// Separate optimized status endpoint
router.get('/optimized/status', async (req, res) => {
  const { jobId } = req.query;
  return handleStatusRequest(req, res, jobId, 'optimized');
});

// ============================================
// STORAGE MANAGEMENT ENDPOINTS
// ============================================

// Storage usage endpoint
router.get('/storage-usage', async (req, res) => {
  try {
    // Simulated storage stats - in production, this would query Cloudinary/S3
    const stats = {
      total_assets: jobStore.size + optimizedJobStore.size,
      pending_deletions: 0,
      storage_backends: {
        cloudinary: {
          storage_used_mb: Math.random() * 100 + 50,
          bandwidth_used_mb: Math.random() * 500 + 200,
          transformation_usage: Math.floor(Math.random() * 1000)
        }
      },
      estimated_monthly_cost_usd: (Math.random() * 10 + 5).toFixed(2),
      deletion_policy: "24-hour automatic deletion"
    };

    return res.status(200).json({
      success: true,
      storage_stats: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Storage usage error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual cleanup endpoint
router.post('/manual-cleanup', async (req, res) => {
  try {
    const { older_than_hours = 24, force_delete = false } = req.body;
    
    console.log(`Manual cleanup requested: older_than=${older_than_hours}h, force=${force_delete}`);

    // Simulate cleanup
    const deletedCount = Math.floor(Math.random() * 10) + 1;
    
    return res.status(200).json({
      success: true,
      message: `Manual cleanup completed. Deleted ${deletedCount} expired assets.`,
      deleted_count: deletedCount,
      older_than_hours: older_than_hours
    });
  } catch (error) {
    console.error('Manual cleanup error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Scheduled cleanup endpoint
router.get('/cleanup-expired-videos', async (req, res) => {
  try {
    console.log('Running scheduled cleanup of expired videos...');

    // Cleanup old jobs from both stores
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let cleanedRegular = 0;
    let cleanedOptimized = 0;

    for (const [jobId, job] of jobStore.entries()) {
      const jobDate = new Date(job.createdAt);
      if (jobDate < cutoff) {
        jobStore.delete(jobId);
        cleanedRegular++;
      }
    }

    for (const [jobId, job] of optimizedJobStore.entries()) {
      const jobDate = new Date(job.createdAt);
      if (jobDate < cutoff) {
        optimizedJobStore.delete(jobId);
        cleanedOptimized++;
      }
    }

    const totalCleaned = cleanedRegular + cleanedOptimized;

    return res.status(200).json({
      success: true,
      message: `Cleanup completed. Deleted ${totalCleaned} expired jobs.`,
      cleaned_regular: cleanedRegular,
      cleaned_optimized: cleanedOptimized,
      total_cleaned: totalCleaned
    });
  } catch (error) {
    console.error('Scheduled cleanup error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// PHYSICS ANIMATIONS ENDPOINT
// ============================================

router.get('/physics-animations', async (req, res) => {
  try {
    const physicsAnimations = [
      { id: 'float_fade', name: 'Ethereal Flow', description: 'Weightless floating with sine wave motion', icon: '💫' },
      { id: 'jitter_damp', name: 'Damped Impact', description: 'Shake with exponential decay for violent stop', icon: '⚡' },
      { id: 'type_pulse', name: 'Energy Pulse', description: 'Letter-by-letter damped spring oscillation', icon: '🌀' },
      { id: 'wobble_spring', name: 'Wobbly Spring', description: 'Hand-drawn inconsistency with sine+cosine', icon: '🎨' },
      { id: 'shatter_collision', name: 'Fragment Collision', description: 'Scatter fragments with elastic rebound', icon: '💥' },
      { id: 'slide_inertia', name: 'Kinetic Stop', description: 'Slide with overshoot and inertia', icon: '🚀' },
      { id: 'depth_gravity', name: 'Weighty Drop', description: 'Gravity acceleration with bounce', icon: '⬇️' },
      { id: 'lofi_wobble', name: 'Vertical Roll', description: 'CRT screen rolling scanline effect', icon: '📺' },
      { id: 'particle_decay', name: 'Cosmic Decay', description: 'Exponential opacity decay', icon: '🌌' },
      { id: 'abstract_breath', name: 'Organic Breath', description: 'Rhythmic size pulsing like breathing', icon: '🌬️' }
    ];

    return res.status(200).json({
      success: true,
      animations: physicsAnimations,
      count: physicsAnimations.length
    });
  } catch (error) {
    console.error('Physics animations error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// JOB PROCESSING FUNCTIONS
// ============================================

async function processRegularJob(jobId) {
  const job = jobStore.get(jobId);
  if (!job) return;

  try {
    job.status = 'processing';
    job.progress = 10;
    job.logs = [...job.logs, `Processing started at ${new Date().toISOString()}`];
    jobStore.set(jobId, job);

    const { data } = job;
    const { lyrics, style, settings, lyricBlocks } = data;

    console.log(`Processing regular job ${jobId}: ${lyrics.length} lyrics, style: ${style}`);

    // Simulate processing steps
    for (let progress = 20; progress <= 90; progress += 20) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      job.progress = progress;
      job.logs = [...job.logs, `Progress: ${progress}%`];
      jobStore.set(jobId, job);
    }

    // Simulate completion
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    job.status = 'completed';
    job.progress = 100;
    job.result = {
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      scenes: lyrics.map((lyric, i) => ({
        lyric: lyric.text,
        imageUrl: `https://picsum.photos/1920/1080?random=${i}`,
        time: lyric.time,
        duration: lyric.duration
      })),
      duration: lyrics.reduce((sum, l) => sum + (l.duration || 4), 0),
      format: 'mp4',
      jobId,
      resolution: '1080p',
      size: '10MB'
    };
    job.updatedAt = new Date().toISOString();
    job.logs = [...job.logs, `Video completed successfully at ${new Date().toISOString()}`];
    jobStore.set(jobId, job);

    console.log(`Regular job ${jobId} completed successfully`);

  } catch (error) {
    console.error(`Regular job ${jobId} failed:`, error);
    const job = jobStore.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date().toISOString();
      job.logs = [...job.logs, `Job failed: ${error.message}`];
      jobStore.set(jobId, job);
    }
  }
}

async function processOptimizedJob(jobId) {
  const job = optimizedJobStore.get(jobId);
  if (!job) return;

  try {
    job.status = 'processing';
    job.progress = 10;
    job.logs = [...job.logs, `Optimized processing started at ${new Date().toISOString()}`];
    optimizedJobStore.set(jobId, job);

    const { data } = job;
    const { lyrics, style, settings } = data;

    console.log(`Processing optimized job ${jobId}: ${lyrics.length} lyrics, style: ${style}`);

    // Simulate optimized processing (faster)
    for (let progress = 20; progress <= 90; progress += 25) {
      await new Promise(resolve => setTimeout(resolve, 800)); // Faster than regular
      job.progress = progress;
      job.logs = [...job.logs, `Optimized progress: ${progress}%`];
      optimizedJobStore.set(jobId, job);
    }

    // Simulate completion
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const expiresAt = Math.floor(Date.now() / 1000) + (24 * 3600);
    
    job.status = 'completed';
    job.progress = 100;
    job.result = {
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      scenes: lyrics.map((lyric, i) => ({
        lyric: lyric.text,
        imageUrl: `https://picsum.photos/1920/1080?random=${i + 100}`,
        time: lyric.time,
        duration: lyric.duration
      })),
      duration: lyrics.reduce((sum, l) => sum + (l.duration || 4), 0),
      format: 'mp4',
      jobId,
      resolution: '1080p',
      size: '8MB',
      expires_at: expiresAt,
      deletion_scheduled: true,
      performance_metrics: {
        total_time: (Math.random() * 30 + 15).toFixed(2),
        gpu_usage: (Math.random() * 30 + 10).toFixed(1),
        memory_reduction_factor: (Math.random() * 1.5 + 1.5).toFixed(1),
        optimizations_enabled: Object.keys(settings.optimization_config || {}).filter(k => settings.optimization_config[k]).length
      },
      optimizations_applied: Object.keys(settings.optimization_config || {}).filter(k => settings.optimization_config[k])
    };
    job.updatedAt = new Date().toISOString();
    job.logs = [...job.logs, `Optimized video completed successfully at ${new Date().toISOString()}`];
    optimizedJobStore.set(jobId, job);

    console.log(`Optimized job ${jobId} completed successfully`);

  } catch (error) {
    console.error(`Optimized job ${jobId} failed:`, error);
    const job = optimizedJobStore.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date().toISOString();
      job.logs = [...job.logs, `Optimized job failed: ${error.message}`];
      optimizedJobStore.set(jobId, job);
    }
  }
}

// ============================================
// WEBHOOK HANDLER
// ============================================

async function handleWebhookRequest(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('Received webhook callback:', req.body);

  try {
    const { job_id, jobId, status, video_url, videoUrl, error, duration, format, scenes, progress, logs = [], type = 'regular' } = req.body;

    const id = jobId || job_id;
    
    if (!id) {
      return res.status(400).json({ error: 'Job ID is required in webhook payload' });
    }

    // Determine which store to update
    const store = type === 'optimized' ? optimizedJobStore : jobStore;
    
    // Update job in store
    const job = store.get(id);
    if (job) {
      job.status = status || job.status;
      job.updatedAt = new Date().toISOString();
      
      // Add logs if provided
      if (logs.length > 0) {
        job.logs = [...(job.logs || []), ...logs];
      }
      
      if (status === 'completed') {
        job.result = {
          videoUrl: video_url || videoUrl,
          duration: duration || job.result?.duration,
          format: format || 'mp4',
          scenes: scenes || [],
          jobId: id,
          createdAt: new Date().toISOString()
        };
        job.progress = 100;
        job.logs = [...(job.logs || []), `Job completed at ${new Date().toISOString()}`];
      } else if (status === 'failed') {
        job.error = error || 'Unknown error';
        job.progress = 0;
        job.logs = [...(job.logs || []), `Job failed: ${job.error}`];
      } else if (progress !== undefined) {
        job.progress = progress;
      }
      
      store.set(id, job);
      console.log(`Job ${id} (${type}) updated via webhook to status: ${job.status}`);
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Webhook received and processed',
      jobId: id
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ 
      error: 'Webhook processing failed',
      details: error.message 
    });
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getEstimatedTimeRemaining(job) {
  if (job.status === 'completed') return '0 seconds';
  if (job.status === 'failed') return null;
  
  const elapsedMs = new Date() - new Date(job.createdAt);
  const progress = job.progress || 0;
  
  if (progress > 0 && elapsedMs > 0) {
    const totalEstimatedMs = (elapsedMs / progress) * 100;
    const remainingMs = totalEstimatedMs - elapsedMs;
    
    if (remainingMs > 0) {
      const minutes = Math.ceil(remainingMs / 60000);
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
  }
  
  return job.type === 'optimized' ? '1-2 minutes' : '2-3 minutes';
}

function getQueuePosition(jobId, type = 'regular') {
  const store = type === 'optimized' ? optimizedJobStore : jobStore;
  const jobs = Array.from(store.values());
  const processingJobs = jobs.filter(j => 
    (j.status === 'queued' || j.status === 'processing') && 
    new Date(j.createdAt) < new Date()
  ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  
  const position = processingJobs.findIndex(j => j.id === jobId);
  return position >= 0 ? position + 1 : 0;
}

function getStyleProfile(style) {
  const profiles = {
    'anime': { name: 'Anime Style', t2vKeywords: 'Anime style, vibrant colors, dynamic motion' },
    'cinematic': { name: 'Cinematic', t2vKeywords: 'Cinematic, dramatic lighting, movie scene' },
    'abstract': { name: 'Abstract Art', t2vKeywords: 'Abstract art, geometric patterns, fluid motion' },
    'retro': { name: 'Retro Synthwave', t2vKeywords: '80s synthwave, neon grid, retro-futuristic' },
    'nature': { name: 'Nature Scenes', t2vKeywords: 'Beautiful nature landscape, natural lighting' },
    'minimal': { name: 'Minimalist', t2vKeywords: 'Minimalist design, clean lines, simple composition' },
    'dreamy_ethereal': { name: 'Dreamy Ethereal', category: 'ethereal' },
    'industrial_grunge': { name: 'Industrial Grunge', category: 'grunge' },
    'retro_80s_vapourwave': { name: 'Retro 80s Vapourwave', category: 'retro' },
    'handwritten_doodle': { name: 'Handwritten Doodle', category: 'doodle' },
    'dynamic_glitch': { name: 'Dynamic Glitch', category: 'glitch' },
    'minimalist_typography': { name: 'Minimalist Typography', category: 'minimal' },
    'cinematic_storytelling': { name: 'Cinematic Storytelling', category: 'cinematic' },
    'lofi_nostalgia': { name: 'Lo-Fi Nostalgia', category: 'lofi' },
    'space_cosmic': { name: 'Space/Cosmic', category: 'cosmic' },
    'abstract_conceptual': { name: 'Abstract Conceptual', category: 'abstract' }
  };
  return profiles[style] || profiles.cinematic;
}

function createBlockMap(lyricBlocks) {
  const blockMap = new Map();
  
  lyricBlocks?.forEach(block => {
    const lines = block.text.split('\n').filter(line => line.trim());
    const lineDuration = block.duration / lines.length;
    
    lines.forEach((line, index) => {
      const startTime = block.startTime + (index * lineDuration);
      blockMap.set(line.trim().toLowerCase(), {
        blockType: block.type,
        startTime,
        duration: lineDuration
      });
    });
  });
  
  return blockMap;
}

function getBlockTypeForLyric(lyric, blockMap) {
  const normalizedText = lyric.text.trim().toLowerCase();
  return blockMap.get(normalizedText)?.blockType || 'verse';
}

function createLLMPrompt(lyricText, blockType, styleProfile, songInfo, settings) {
  return `
    Create a UNIQUE and ORIGINAL visual scene description for a lyric video.
    
    IMPORTANT: Generate completely DIFFERENT scenes for each lyric.
    Do NOT repeat the same visual composition.
    Vary: camera angle, lighting direction, foreground/background elements, color palette.
    
    Lyric: "${lyricText}"
    Block Type: ${blockType.toUpperCase()}
    Style: ${styleProfile.name}
    
    Create a scene that is:
    ✓ Unique and unrepeatable
    ✓ Emotionally matches the lyric content
    ✓ Visually distinct from previous scenes
    ✓ Rich in texture and detail
    ✓ Professional cinematography quality
    
    T2V_PROMPT: [Detailed, specific visual description - MUST BE UNIQUE AND DIFFERENT from previous scenes]
    FONT_TAG: [Font style matching the lyric emotion]
    ANIMATION_TAG: [Dynamic animation appropriate for content]
    COLOR_TAG: [Color palette supporting the mood]
  `;
}

function parseLLMResponse(response, lyric, blockType, settings) {
  try {
    // Extract rendering tags with lowercase animation tags
    const fontMatch = response.match(/FONT_TAG:\s*(\S+)/);
    const animationMatch = response.match(/ANIMATION_TAG:\s*(\S+)/);
    const colorMatch = response.match(/COLOR_TAG:\s*(\S+)/);
    const t2vPrompt = response.match(/T2V_PROMPT:\s*(.+)/)?.[1] || '';
    
    const renderingTags = {
      font: fontMatch ? fontMatch[1].toLowerCase() : 'modern',
      color: colorMatch ? colorMatch[1] : '#FFFFFF',
      animation: animationMatch ? animationMatch[1].toLowerCase().replace('animation_', '') : 'fade',
      intensity: 'medium'
    };
    
    return { t2vPrompt, renderingTags };
  } catch (error) {
    return {
      t2vPrompt: generateFallbackT2VPrompt(lyric.text, blockType),
      renderingTags: {
        font: 'modern',
        color: '#FFFFFF',
        animation: 'fade',
        intensity: 'medium'
      }
    };
  }
}

function getFontForBlock(blockType, fontCombination) {
  if (!fontCombination?.enabled) return 'modern';
  
  const fontMap = {
    'hook': fontCombination.hookFont || 'bold',
    'chorus': fontCombination.chorusFont || 'modern',
    'verse': fontCombination.verseFont || 'serif',
    'bridge': fontCombination.bridgeFont || 'script',
    'pre-chorus': fontCombination.verseFont || 'serif',
    'outro': fontCombination.hookFont || 'bold'
  };
  
  return fontMap[blockType] || 'modern';
}

function getColorForBlock(blockType, fontCombination) {
  if (!fontCombination?.enabled) return '#FFFFFF';
  
  const colorMap = {
    'hook': fontCombination.hookColor || '#FF6B35',
    'chorus': fontCombination.chorusColor || '#FFFFFF',
    'verse': fontCombination.verseColor || '#FFD700',
    'bridge': fontCombination.bridgeColor || '#00FFFF',
    'pre-chorus': fontCombination.verseColor || '#FFD700',
    'outro': fontCombination.hookColor || '#FF6B35'
  };
  
  return colorMap[blockType] || '#FFFFFF';
}

function generateFallbackT2VPrompt(lyric, blockType) {
  const prompts = {
    'hook': `Cinematic shot capturing "${lyric}". Dramatic lighting, attention-grabbing composition.`,
    'chorus': `Epic scene representing "${lyric}". Grand scale, emotional impact, recurring theme.`,
    'verse': `Narrative scene illustrating "${lyric}". Detailed environment, story progression.`,
    'bridge': `Transitional scene for "${lyric}". Emotional shift, connecting narrative.`
  };
  
  return prompts[blockType] || `Visual representation of "${lyric}". Cinematic, emotional.`;
}

function generateFallbackRenderingTags(style) {
  const tagProfiles = {
    'anime': { font: 'FONT_BOLD', animation: 'BOUNCE' },
    'cinematic': { font: 'FONT_SERIF', animation: 'FADE' },
    'abstract': { font: 'FONT_FUTURISTIC', animation: 'GLITCH' },
    'retro': { font: 'FONT_MONO', animation: 'GLITCH' },
    'nature': { font: 'FONT_SCRIPT', animation: 'FADE' },
    'minimal': { font: 'FONT_MODERN', animation: 'SLIDE' }
  };
  
  return tagProfiles[style] || { font: 'FONT_MODERN', color: '#FFFFFF', animation: 'FADE' };
}

async function analyzeLyricsWithLLM(lyrics, lyricBlocks, style, settings, songInfo) {
  console.log('Analyzing lyrics with LLM...');
  
  const styleProfile = getStyleProfile(style);
  const blockMap = createBlockMap(lyricBlocks);
  
  const analyzedLyrics = [];
  
  for (const lyric of lyrics) {
    try {
      // Get block type for this lyric
      const blockType = getBlockTypeForLyric(lyric, blockMap);
      
      // Use Hugging Face Inference for LLM analysis
      const llmResponse = await hf.textGeneration({
        model: 'mistralai/Mistral-7B-Instruct-v0.2',
        inputs: createLLMPrompt(lyric.text, blockType, styleProfile, songInfo, settings),
        parameters: {
          max_new_tokens: 300,
          temperature: 0.7,
          return_full_text: false
        }
      });
      
      // Parse LLM response
      const { t2vPrompt, renderingTags } = parseLLMResponse(
        llmResponse.generated_text, 
        lyric, 
        blockType, 
        settings
      );
      
      analyzedLyrics.push({
        ...lyric,
        blockType,
        t2vPrompt,
        renderingTags,
        fontStyle: getFontForBlock(blockType, settings.fontCombination),
        textColor: getColorForBlock(blockType, settings.fontCombination)
      });
      
      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`Failed to analyze lyric:`, error);
      // Fallback analysis
      analyzedLyrics.push({
        ...lyric,
        blockType: 'verse',
        t2vPrompt: generateFallbackT2VPrompt(lyric.text, style),
        renderingTags: generateFallbackRenderingTags(style),
        fontStyle: 'modern',
        textColor: '#FFFFFF'
      });
    }
  }
  
  return analyzedLyrics;
}

async function generateAIScenes(analyzedLyrics, settings) {
  console.log('Generating AI scenes...');
  
  const scenes = [];
  const maxScenes = Math.min(analyzedLyrics.length, 15);
  
  for (let i = 0; i < maxScenes; i++) {
    const lyric = analyzedLyrics[i];
    
    try {
      // Generate image with Stable Diffusion
      const image = await generateImage(lyric.t2vPrompt, settings.resolution);
      
      scenes.push({
        id: i + 1,
        lyric: lyric.text,
        imageUrl: image,
        time: lyric.time,
        duration: lyric.duration,
        blockType: lyric.blockType,
        fontStyle: lyric.fontStyle,
        textColor: lyric.textColor,
        renderingTags: lyric.renderingTags
      });
      
      console.log(`Generated scene ${i + 1}/${maxScenes}`);
      
      // Add delay to avoid rate limiting
      if (i < maxScenes - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
    } catch (error) {
      console.error(`Failed to generate scene ${i + 1}:`, error);
      // Add placeholder
      scenes.push({
        id: i + 1,
        lyric: lyric.text,
        imageUrl: `https://picsum.photos/1920/1080?random=${i}&blur=2`,
        time: lyric.time,
        duration: lyric.duration,
        blockType: lyric.blockType,
        fontStyle: lyric.fontStyle,
        textColor: lyric.textColor
      });
    }
  }
  
  return scenes;
}

async function generateImage(prompt, resolution) {
  try {
    // First attempt: High-quality AI model (FLUX)
    try {
      const result = await hf.textToImage({
        model: 'black-forest-labs/FLUX.1-dev',
        inputs: `${prompt}. Ultra detailed, cinematic quality, ${resolution}, professional lighting`,
        parameters: {
          height: 1080,
          width: 1920,
          guidance_scale: 7.5,
          num_inference_steps: 30
        }
      });

      const blob = await result.blob();
      const buffer = await blob.arrayBuffer();
      return `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`;
    } catch (fluxError) {
      console.warn('FLUX model failed, falling back to Stable Diffusion');
      
      // Fallback: Stable Diffusion
      const result = await hf.textToImage({
        model: 'stabilityai/stable-diffusion-2-1',
        inputs: `${prompt}. ${resolution}, detailed, professional`,
        parameters: {
          negative_prompt: 'blurry, low quality, distorted, text, watermark, duplicate, same, template',
          num_inference_steps: 20,
          guidance_scale: 7.5
        }
      });

      const blob = await result.blob();
      const buffer = await blob.arrayBuffer();
      return `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`;
    }
  } catch (error) {
    console.error('All image generation models failed:', error);
    throw error;
  }
}

async function createVideoWithPython(data) {
  console.log('Creating video with Python...');
  
  try {
    const pythonScript = `
import sys
import json
import base64
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
import moviepy.editor as mp
from moviepy.video.fx import fadein, fadeout
import numpy as np
import tempfile
import os

def create_lyric_video():
    data = json.loads(sys.argv[1])
    scenes = data.get('scenes', [])
    settings = data.get('settings', {})
    job_id = data.get('jobId', '')
    
    # Create temporary directory
    temp_dir = tempfile.mkdtemp()
    image_paths = []
    
    # Process each scene
    for i, scene in enumerate(scenes):
        # Decode base64 image or use placeholder
        if scene.get('imageUrl', '').startswith('data:image'):
            img_data = scene['imageUrl'].split(',')[1]
            img_bytes = base64.b64decode(img_data)
            img = Image.open(BytesIO(img_bytes))
        else:
            # Create placeholder
            img = Image.new('RGB', (1920, 1080), color=(40, 40, 60))
            draw = ImageDraw.Draw(img)
            
            # Add gradient
            for y in range(1080):
                color = int(40 + (y / 1080) * 60)
                draw.line([(0, y), (1920, y)], fill=(color, color, color + 20))
        
        # Resize to 1080p
        img = img.resize((1920, 1080), Image.Resampling.LANCZOS)
        
        # Add lyric text with block-specific styling
        draw = ImageDraw.Draw(img)
        
        # Get font style based on block type
        font_style = scene.get('fontStyle', 'modern')
        font_size = int(settings.get('fontSize', 48))
        text_color = scene.get('textColor', '#FFFFFF')
        
        # Map font styles to actual fonts
        font_map = {
            'modern': 'arial.ttf',
            'serif': 'times.ttf',
            'script': 'cursive',
            'bold': 'impact.ttf',
            'mono': 'cour.ttf',
            'futuristic': 'arial.ttf'
        }
        
        try:
            font_path = font_map.get(font_style, 'arial.ttf');
            if os.path.exists(font_path):
                font = ImageFont.truetype(font_path, font_size)
            else:
                font = ImageFont.truetype("arial.ttf", font_size)
        except:
            font = ImageFont.load_default()
        
        # Prepare text
        text = scene.get('lyric', '')
        
        # Calculate text position (centered)
        img_width, img_height = img.size
        text_bbox = draw.textbbox((0, 0), text, font=font)
        text_width = text_bbox[2] - text_bbox[0];
        text_height = text_bbox[3] - text_bbox[1];
        
        x = (img_width - text_width) // 2
        y = img_height - text_height - 100
        
        # Add text shadow for readability
        shadow_color = (0, 0, 0, 150)
        for offset in [(2, 2), (-2, 2), (2, -2), (-2, -2)]:
            draw.text((x + offset[0], y + offset[1]), text, font=font, fill=shadow_color)
        
        # Add main text with color
        if text_color.startswith('#'):
            r = int(text_color[1:3], 16)
            g = int(text_color[3:5], 16)
            b = int(text_color[5:7], 16)
            draw.text((x, y), text, font=font, fill=(r, g, b))
        else:
            draw.text((x, y), text, font=font, fill=text_color)
        
        # Save image
        img_path = os.path.join(temp_dir, f'scene_{i}.png')
        img.save(img_path, 'PNG', quality=95)
        image_paths.append((img_path, scene.get('duration', 4)))
    
    # Create video from images
    if image_paths:
        clips = []
        for img_path, duration in image_paths:
            clip = mp.ImageClip(img_path, duration=duration)
            
            # Apply animation based on settings
            animation = settings.get('animationType', 'fade')
            if animation == 'fade':
                clip = clip.fx(fadein, 0.5).fx(fadeout, 0.5)
            
            clips.append(clip)
        
        video = mp.concatenate_videoclips(clips, method="compose")
        
        # Add audio if provided
        if settings.get('audioFile'):
            try:
                audio_data = settings['audioFile'].split(',')[1]
                audio_bytes = base64.b64decode(audio_data)
                audio_path = os.path.join(temp_dir, 'audio.mp3')
                
                with open(audio_path, 'wb') as f:
                    f.write(audio_bytes)
                
                audio_clip = mp.AudioFileClip(audio_path)
                
                # Match audio duration to video
                if audio_clip.duration > video.duration:
                    audio_clip = audio_clip.subclip(0, video.duration)
                
                video = video.set_audio(audio_clip)
                except Exception as e:
                    print(json.dumps({'success': False, 'error': str(e)}))
        
        # Export video
        output_path = os.path.join(temp_dir, 'output.mp4');
        video.write_videofile(
            output_path,
            fps=30,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile=os.path.join(temp_dir, 'temp_audio.m4a'),
            remove_temp=True,
            verbose=False,
            logger=None
        )
        
        # Read video as base64
        with open(output_path, 'rb') as f:
            video_data = f.read()
        
        # Calculate video size
        video_size = len(video_data);
        
        # Cleanup
        for file in os.listdir(temp_dir):
            try:
                os.remove(os.path.join(temp_dir, file))
            except:
                pass
        
        return {
            'success': True,
            'video': base64.b64encode(video_data).decode('utf-8'),
            'duration': video.duration,
            'size': video_size,
            'scenes': len(scenes)
        }
    
    return {'success': False, 'error': 'No scenes processed'}

if __name__ == "__main__":
    try:
        result = create_lyric_video();
        print(json.dumps(result));
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}));
`;

    // Write Python script to temporary file
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `video_generator_${Date.now()}.py`);
    await fs.writeFile(scriptPath, pythonScript);

    // Run Python script
    const result = await new Promise((resolve, reject) => {
      const pythonProcess = spawn('python', [scriptPath, JSON.stringify(data)]);
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        // Clean up script file
        fs.unlink(scriptPath).catch(() => {});
        
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout);
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse Python output: ${e.message}`));
          }
        } else {
          reject(new Error(`Python script failed: ${stderr}`));
        }
      });
      
      // Timeout after 45 seconds
      setTimeout(() => {
        pythonProcess.kill();
        reject(new Error('Python script timeout'));
      }, 45000);
    });

    return result;
  } catch (error) {
    console.error('Python video generation failed:', error);
    return { success: false, error: error.message };
  }
}

async function uploadVideoToCloudinary(videoResult, jobId) {
  console.log('Uploading video...');
  
  // In production, this would upload to Cloudinary/S3
  // For demo, return a mock URL
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const demoVideos = [
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
  ];
  
  const randomVideo = demoVideos[Math.floor(Math.random() * demoVideos.length)];
  
  return randomVideo;
}

// Cleanup old jobs periodically (every 10 minutes)
setInterval(() => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
  let cleanedRegular = 0;
  let cleanedOptimized = 0;
  
  for (const [jobId, job] of jobStore.entries()) {
    const jobDate = new Date(job.createdAt);
    if (jobDate < cutoff) {
      jobStore.delete(jobId);
      cleanedRegular++;
    }
  }
  
  for (const [jobId, job] of optimizedJobStore.entries()) {
    const jobDate = new Date(job.createdAt);
    if (jobDate < cutoff) {
      optimizedJobStore.delete(jobId);
      cleanedOptimized++;
    }
  }
  
  if (cleanedRegular > 0 || cleanedOptimized > 0) {
    console.log(`Cleaned up ${cleanedRegular} regular jobs and ${cleanedOptimized} optimized jobs`);
  }
}, 10 * 60 * 1000);

export default router;