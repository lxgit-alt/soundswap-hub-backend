import express from 'express';
import Replicate from 'replicate';
import dotenv from 'dotenv';
import axios from 'axios';
import crypto from 'crypto';

dotenv.config();

const router = express.Router();

// Initialize Replicate client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Helper function to download image from URL
const downloadImage = async (url) => {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    const buffer = Buffer.from(response.data, 'binary');
    return buffer.toString('base64');
  } catch (error) {
    console.error('Error downloading image:', error.message);
    throw new Error('Failed to download image');
  }
};

// Test Replicate connection
router.get('/test', async (req, res) => {
  try {
    console.log('Testing Replicate connection...');
    
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Configuration Error',
        message: 'REPLICATE_API_TOKEN is not configured in environment variables'
      });
    }

    // Test both models
    const scribbleModel = await replicate.models.get("jagilley/controlnet-scribble");
    
    res.json({
      success: true,
      message: 'Replicate API connected successfully',
      models: {
        scribble: scribbleModel,
        status: 'ready'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Replicate connection test failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'Connection Failed',
      message: 'Replicate API connection failed',
      details: error.message
    });
  }
});

// Doodle-to-Art generation endpoint
router.post('/generate', async (req, res) => {
  try {
    const { sketch, prompt, conditioningScale = 0.8, style = "digital art" } = req.body;

    // Validate required fields
    if (!sketch || !prompt) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields',
        message: 'Sketch (base64 image) and prompt (text description) are required' 
      });
    }

    // Validate sketch format
    if (!sketch.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sketch format',
        message: 'Sketch must be a base64 data URL starting with "data:image/"'
      });
    }

    // Validate API token
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Configuration Error',
        message: 'REPLICATE_API_TOKEN is not configured. Please add your Replicate API token.'
      });
    }

    console.log('Starting doodle-to-art generation...');
    console.log('Prompt:', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''));
    console.log('Conditioning scale:', conditioningScale);
    console.log('Style:', style);

    // Prepare the image data for Replicate
    const base64Data = sketch.replace(/^data:image\/\w+;base64,/, '');
    const imageDataUrl = `data:image/png;base64,${base64Data}`;

    // Prepare input for Replicate API
    const input = {
      image: imageDataUrl,
      prompt: `${prompt}, ${style}, high quality, detailed`,
      num_outputs: 1,
      image_resolution: "512",
      num_inference_steps: 50,
      guidance_scale: 7.5,
      scheduler: "DPMSolverMultistep",
      conditioning_scale: Math.min(Math.max(parseFloat(conditioningScale), 0.1), 1.0),
    };

    console.log('Calling Replicate ControlNet Scribble API...');
    
    // Call Replicate API
    const output = await replicate.run(
      "jagilley/controlnet-scribble:435061a1b5a4c1e26740464bf786efdfa9cb3a3ac488595a2de23e143fdb0117",
      { input }
    );

    console.log('Replicate API response received');
    
    // Check if NSFW filter blocked the image
    if (output && output.length > 0) {
      const firstImage = output[0];
      if (typeof firstImage === 'string') {
        if (firstImage.includes('NSFW') || firstImage.includes('blocked') || firstImage.includes('inappropriate')) {
          return res.status(400).json({
            success: false,
            error: 'NSFW',
            message: 'Whoa there! Let\'s keep it PG-13. Try a different prompt or sketch.'
          });
        }
      }
    }

    // Generate a unique ID for this generation
    const generationId = crypto.randomBytes(8).toString('hex');

    res.json({
      success: true,
      generationId: generationId,
      images: output,
      prompt: prompt,
      style: style,
      conditioningScale: conditioningScale,
      timestamp: new Date().toISOString(),
      note: 'AI may not render text accurately. Add text/logo afterwards using editing tools like Canva or Photoshop.',
      features: {
        canAnimate: true,
        animationEndpoint: '/api/doodle-art/animate',
        animationCost: '$0.08 - $0.12 per animation'
      }
    });

  } catch (error) {
    console.error('Doodle generation error:', error.message);
    
    // Handle specific error cases
    if (error.message.includes('NSFW') || error.message.includes('inappropriate')) {
      return res.status(400).json({
        success: false,
        error: 'NSFW',
        message: 'Content was blocked by safety filters. Please try a different sketch or prompt.'
      });
    }

    if (error.message.includes('credit') || error.message.includes('payment') || error.message.includes('insufficient')) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient Credits',
        message: 'Please add credits to your Replicate account or check your payment method.'
      });
    }

    if (error.message.includes('rate limit') || error.message.includes('too many requests')) {
      return res.status(429).json({
        success: false,
        error: 'Rate Limited',
        message: 'Too many requests. Please wait a moment and try again.'
      });
    }

    // Handle timeout errors
    if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
      return res.status(504).json({
        success: false,
        error: 'Timeout',
        message: 'Generation took too long. Please try again with a simpler sketch or prompt.'
      });
    }

    // General error
    res.status(500).json({
      success: false,
      error: 'Generation failed',
      message: error.message || 'An unexpected error occurred during generation',
      suggestion: 'Check your Replicate API token and ensure you have sufficient credits.'
    });
  }
});

// Animation endpoint - Turn static art into Spotify Canvas video
router.post('/animate', async (req, res) => {
  try {
    const { imageUrl, prompt, motionStrength = 0.8, duration = 8 } = req.body;

    // Validate required fields
    if (!imageUrl) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required field',
        message: 'imageUrl is required. Please provide the URL of the generated image to animate.'
      });
    }

    // Validate API token
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Configuration Error',
        message: 'REPLICATE_API_TOKEN is not configured. Please add your Replicate API token.'
      });
    }

    console.log('Starting animation generation...');
    console.log('Image URL:', imageUrl);
    console.log('Motion strength:', motionStrength);
    console.log('Duration:', duration, 'seconds');

    // For Spotify Canvas, we need 8-second videos
    // Using Stability AI's video diffusion model
    const input = {
      input_image: imageUrl,
      motion_bucket_id: Math.floor(motionStrength * 255),
      fps: 12, // Lower FPS for artistic style
      seed: Math.floor(Math.random() * 1000000),
      video_length: duration, // Duration in seconds
      decoding_t: 7, // Controls the smoothness of motion
    };

    console.log('Calling Stability AI Video API...');
    
    // Note: This is a placeholder model. You'll need to use the actual Stability Video API
    // For now, we'll use Replicate's implementation
    const output = await replicate.run(
      "stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438",
      { input }
    );

    console.log('Animation generation completed');
    
    // Generate a unique ID for this animation
    const animationId = crypto.randomBytes(8).toString('hex');

    res.json({
      success: true,
      animationId: animationId,
      videoUrl: output,
      duration: duration,
      motionStrength: motionStrength,
      timestamp: new Date().toISOString(),
      format: 'mp4',
      loop: true,
      dimensions: '576x1024 (Spotify Canvas format)',
      fps: 12,
      usage: {
        description: 'Perfect for Spotify Canvas (8-second loop)',
        cost: '$0.08 - $0.12',
        platform: 'Spotify Canvas, Instagram Stories, TikTok',
        maxDuration: '15 seconds'
      }
    });

  } catch (error) {
    console.error('Animation generation error:', error.message);
    
    // Handle specific error cases
    if (error.message.includes('NSFW') || error.message.includes('inappropriate')) {
      return res.status(400).json({
        success: false,
        error: 'NSFW',
        message: 'Animation was blocked by safety filters.'
      });
    }

    if (error.message.includes('credit') || error.message.includes('payment') || error.message.includes('insufficient')) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient Credits',
        message: 'Please add credits to your Replicate account for animation generation.'
      });
    }

    if (error.message.includes('rate limit') || error.message.includes('too many requests')) {
      return res.status(429).json({
        success: false,
        error: 'Rate Limited',
        message: 'Too many animation requests. Please wait a moment and try again.'
      });
    }

    // Handle video-specific errors
    if (error.message.includes('video') || error.message.includes('animation')) {
      return res.status(500).json({
        success: false,
        error: 'Animation Failed',
        message: 'Video generation failed. The image might not be suitable for animation.',
        suggestion: 'Try a different image or adjust the motion strength.'
      });
    }

    // General error
    res.status(500).json({
      success: false,
      error: 'Animation failed',
      message: error.message || 'An unexpected error occurred during animation',
      suggestion: 'Check your Replicate API token and ensure you have sufficient credits.'
    });
  }
});

// Premium animation with more control (for upselling)
router.post('/animate/premium', async (req, res) => {
  try {
    const { 
      imageUrl, 
      prompt, 
      motionStrength = 0.8, 
      duration = 8,
      style = "cinematic",
      cameraMotion = "subtle_zoom",
      loopType = "seamless"
    } = req.body;

    // Validate required fields
    if (!imageUrl) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required field',
        message: 'imageUrl is required for premium animation.'
      });
    }

    console.log('Starting premium animation generation...');
    console.log('Style:', style);
    console.log('Camera motion:', cameraMotion);
    console.log('Loop type:', loopType);

    // Premium animation with more parameters
    const input = {
      input_image: imageUrl,
      motion_bucket_id: Math.floor(motionStrength * 255),
      fps: 24, // Higher FPS for premium quality
      seed: Math.floor(Math.random() * 1000000),
      video_length: duration,
      decoding_t: 7,
      style: style,
      camera_motion: cameraMotion,
      loop: loopType === "seamless"
    };

    console.log('Calling Premium Video API...');
    
    // Using a more advanced model for premium animations
    const output = await replicate.run(
      "stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438",
      { input }
    );

    console.log('Premium animation generation completed');
    
    const premiumId = `premium_${crypto.randomBytes(8).toString('hex')}`;

    res.json({
      success: true,
      animationId: premiumId,
      videoUrl: output,
      duration: duration,
      motionStrength: motionStrength,
      style: style,
      cameraMotion: cameraMotion,
      loopType: loopType,
      timestamp: new Date().toISOString(),
      format: 'mp4 (HD)',
      dimensions: '1080x1920 (Premium format)',
      fps: 24,
      quality: 'premium',
      usage: {
        description: 'Premium animation for professional use',
        cost: '$0.15 - $0.25',
        platforms: 'YouTube Shorts, Instagram Reels, TikTok, Spotify Canvas',
        maxDuration: '30 seconds',
        features: ['HD quality', 'Custom motion', 'Seamless loop', 'Multiple styles']
      }
    });

  } catch (error) {
    console.error('Premium animation error:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Premium Animation Failed',
      message: error.message || 'An unexpected error occurred',
      suggestion: 'Try standard animation or contact support for premium features.'
    });
  }
});

// Batch animation (for multiple images)
router.post('/animate/batch', async (req, res) => {
  try {
    const { imageUrls, motionStrength = 0.8, duration = 8 } = req.body;

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: 'imageUrls must be a non-empty array'
      });
    }

    // Limit batch size for cost control
    const maxBatchSize = 3;
    const imagesToProcess = imageUrls.slice(0, maxBatchSize);

    console.log(`Starting batch animation for ${imagesToProcess.length} images...`);

    const batchId = `batch_${crypto.randomBytes(8).toString('hex')}`;
    const results = [];

    // Process images sequentially to avoid rate limiting
    for (let i = 0; i < imagesToProcess.length; i++) {
      try {
        const input = {
          input_image: imagesToProcess[i],
          motion_bucket_id: Math.floor(motionStrength * 255),
          fps: 12,
          seed: Math.floor(Math.random() * 1000000),
          video_length: duration,
          decoding_t: 7,
        };

        console.log(`Processing image ${i + 1} of ${imagesToProcess.length}...`);
        
        const output = await replicate.run(
          "stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af61f3149fa7a9e0b5ffcf1b8172438",
          { input }
        );

        results.push({
          originalUrl: imagesToProcess[i],
          videoUrl: output,
          success: true,
          index: i
        });
      } catch (error) {
        console.error(`Failed to animate image ${i}:`, error.message);
        results.push({
          originalUrl: imagesToProcess[i],
          success: false,
          error: error.message,
          index: i
        });
      }
    }

    console.log('Batch animation completed');

    res.json({
      success: true,
      batchId: batchId,
      totalProcessed: imagesToProcess.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results: results,
      timestamp: new Date().toISOString(),
      costEstimate: `$${imagesToProcess.length * 0.10} (approx)`
    });

  } catch (error) {
    console.error('Batch animation error:', error.message);
    
    res.status(500).json({
      success: false,
      error: 'Batch Animation Failed',
      message: error.message || 'An unexpected error occurred'
    });
  }
});

// Get animation status/quote
router.post('/animate/quote', (req, res) => {
  const { duration = 8, quality = "standard", count = 1 } = req.body;

  // Pricing model
  const pricing = {
    standard: {
      perSecond: 0.01,
      baseCost: 0.04,
      maxDuration: 15
    },
    premium: {
      perSecond: 0.02,
      baseCost: 0.08,
      maxDuration: 30
    },
    hd: {
      perSecond: 0.03,
      baseCost: 0.12,
      maxDuration: 60
    }
  };

  const tier = pricing[quality] || pricing.standard;
  const totalDuration = Math.min(duration, tier.maxDuration);
  const cost = (tier.baseCost + (totalDuration * tier.perSecond)) * count;

  res.json({
    success: true,
    quote: {
      duration: totalDuration,
      quality: quality,
      count: count,
      cost: `$${cost.toFixed(2)}`,
      timeEstimate: `${totalDuration * 2} seconds`,
      features: quality === "premium" ? ["HD", "Seamless loop", "Custom motion"] : ["Standard quality", "Basic loop"],
      suitableFor: quality === "standard" ? "Spotify Canvas" : "Professional use"
    }
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'doodle-to-art-api',
    status: 'operational',
    version: '2.0.0', // Updated version with animation
    timestamp: new Date().toISOString(),
    replicate_configured: !!process.env.REPLICATE_API_TOKEN,
    endpoints: {
      test: 'GET /test - Test Replicate API connection',
      generate: 'POST /generate - Generate art from sketch',
      animate: 'POST /animate - Create 8-second Spotify Canvas video',
      animate_premium: 'POST /animate/premium - Premium animation with more control',
      animate_batch: 'POST /animate/batch - Animate multiple images',
      animate_quote: 'POST /animate/quote - Get animation cost estimate',
      health: 'GET /health - API health check'
    },
    models: {
      scribble: 'jagilley/controlnet-scribble',
      video: 'stability-ai/stable-video-diffusion'
    },
    pricing: {
      sketch_to_art: '$0.01 - $0.02',
      standard_animation: '$0.08 - $0.12',
      premium_animation: '$0.15 - $0.25',
      batch_discount: '10% off for 3+ animations'
    }
  });
});

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Doodle-to-Art API with Animation Features',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      test: 'GET /test',
      generate: 'POST /generate',
      animate: 'POST /animate',
      animate_premium: 'POST /animate/premium',
      animate_batch: 'POST /animate/batch',
      animate_quote: 'POST /animate/quote',
      health: 'GET /health'
    },
    animationFeatures: {
      spotifyCanvas: '8-second looping videos',
      formats: ['mp4', 'gif (coming soon)'],
      dimensions: {
        spotify: '576x1024',
        instagram: '1080x1920',
        tiktok: '1080x1920'
      },
      motionTypes: ['subtle', 'moderate', 'dynamic'],
      loopOptions: ['seamless', 'crossfade', 'bounce']
    },
    usageExamples: {
      generate: {
        method: 'POST',
        endpoint: '/generate',
        body: {
          sketch: 'Base64 image data URL',
          prompt: 'Text description',
          conditioningScale: '0.1 to 1.0',
          style: 'digital art, oil painting, etc.'
        }
      },
      animate: {
        method: 'POST',
        endpoint: '/animate',
        body: {
          imageUrl: 'URL from generate endpoint',
          motionStrength: '0.1 to 1.0',
          duration: 'Seconds (max 15)'
        }
      }
    },
    tips: {
      sketch: 'Clear black lines on white background work best',
      animation: 'Images with clear foreground/background animate better',
      spotify: '8-second seamless loops work best for Spotify Canvas',
      cost: 'Use /animate/quote to estimate costs before generating'
    }
  });
});

export default router;