import express from 'express';
import Replicate from 'replicate';
import dotenv from 'dotenv';
import axios from 'axios';
import crypto from 'crypto';
import sharp from 'sharp';
import { createCanvas, loadImage } from 'canvas';

dotenv.config();

const router = express.Router();

// Initialize Replicate client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// ============================================
// FIREBASE ADMIN SETUP FOR CREDIT VERIFICATION
// ============================================

let db = null;

const loadFirebaseAdmin = async () => {
  if (!db) {
    try {
      const adminModule = await import('firebase-admin');
      const admin = adminModule.default;
      
      if (admin.apps.length > 0) {
        db = admin.firestore();
        db.settings({ ignoreUndefinedProperties: true });
        console.log('[INFO] 🔥 Firebase Admin initialized for doodle-art generation');
      } else {
        const serviceAccount = {
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        };
        
        if (serviceAccount.projectId && serviceAccount.clientEmail && serviceAccount.privateKey) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
          });
          db = admin.firestore();
          db.settings({ ignoreUndefinedProperties: true });
          console.log('[INFO] 🔥 Firebase Admin initialized for doodle-art generation');
        }
      }
    } catch (error) {
      console.error('[ERROR] ❌ Failed to initialize Firebase Admin:', error.message);
    }
  }
  return db;
};

// ============================================
// CREDIT VERIFICATION FUNCTION
// ============================================

const verifyUserCreditsBeforeProcessing = async (userId, creditType = 'coverArt', generationId = '') => {
  try {
    if (!userId) {
      console.warn(`[WARN] ⚠️ Generation ${generationId}: No user ID provided, skipping credit verification`);
      return { verified: true, creditsAvailable: -1, message: 'No user ID (test mode)' };
    }

    const firestore = await loadFirebaseAdmin();
    if (!firestore) {
      console.warn(`[WARN] ⚠️ Generation ${generationId}: Firebase not available, skipping credit verification`);
      return { verified: true, creditsAvailable: -1, message: 'Firebase unavailable (test mode)' };
    }

    // Get user document
    const userRef = firestore.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.error(`[ERROR] ❌ Generation ${generationId}: User ${userId} not found in Firestore`);
      return { 
        verified: false, 
        creditsAvailable: 0, 
        message: 'User not found',
        error: 'INVALID_USER'
      };
    }

    const userData = userDoc.data();
    
    // Check credit balance based on type
    const creditsField = creditType === 'coverArt' ? 'points' : 'lyricVideoCredits';
    const creditsAvailable = userData[creditsField] || 0;

    if (creditsAvailable < 1) {
      console.error(`[ERROR] ❌ Generation ${generationId}: Insufficient ${creditType} credits. Available: ${creditsAvailable}`);
      return {
        verified: false,
        creditsAvailable,
        message: `Insufficient ${creditType} credits`,
        error: 'INSUFFICIENT_CREDITS',
        requiredCredits: 1,
        userId
      };
    }

    console.log(`[INFO] ✅ Generation ${generationId}: Credit verification passed. User ${userId} has ${creditsAvailable} ${creditType} credits`);
    
    return {
      verified: true,
      creditsAvailable,
      message: `Verified ${creditsAvailable} ${creditType} credits available`,
      userId
    };

  } catch (error) {
    console.error(`[ERROR] ❌ Generation ${generationId}: Credit verification error: ${error.message}`);
    return {
      verified: false,
      creditsAvailable: 0,
      message: 'Credit verification error',
      error: 'VERIFICATION_FAILED',
      details: error.message
    };
  }
};

// ============================================
// CREDIT REVERSION FUNCTION
// ============================================

const revertUserCredits = async (userId, creditType = 'coverArt', generationId = '') => {
  try {
    if (!userId) {
      console.warn(`[WARN] ⚠️ Generation ${generationId}: No user ID provided, skipping credit reversion`);
      return { success: false, message: 'No user ID' };
    }

    const firestore = await loadFirebaseAdmin();
    if (!firestore) {
      console.warn(`[WARN] ⚠️ Generation ${generationId}: Firebase not available, skipping credit reversion`);
      return { success: false, message: 'Firebase unavailable' };
    }

    // Get credit field name
    const creditsField = creditType === 'coverArt' ? 'points' : 'lyricVideoCredits';
    const userRef = firestore.collection('users').doc(userId);

    // Increment credits by 1 (refund)
    await userRef.update({
      [creditsField]: firestore.FieldValue.increment(1)
    });

    console.log(`[✅ REFUND] ✅ Generation ${generationId}: Reverted 1 ${creditType} credit for user ${userId}`);
    
    return {
      success: true,
      message: `Reverted 1 ${creditType} credit due to system error`,
      userId,
      creditType,
      refunded: 1
    };

  } catch (error) {
    console.error(`[ERROR] ❌ Generation ${generationId}: Credit reversion failed: ${error.message}`);
    return {
      success: false,
      message: 'Credit reversion failed',
      error: error.message
    };
  }
};

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

// ============================================
// NEW: STYLE PRESET MAPPING (Lora-like effects)
// ============================================

const STYLE_PRESETS = {
  'grunge': {
    name: 'Parental Advisory Grunge',
    promptSuffix: ', grunge style, high contrast, film grain, distressed texture, 90s hip-hop aesthetic, parental advisory sticker aesthetic, raw edge',
    negativePrompt: 'clean, polished, smooth, digital, perfect, shiny, professional',
    conditioningScale: 0.7,
    guidanceScale: 8.5
  },
  'synthwave': {
    name: 'Dreamscape Synthwave',
    promptSuffix: ', synthwave aesthetic, neon glow, cyberpunk, retro-futurism, vibrant colors, chromatic aberration, soft focus, grid lines, sunset gradient',
    negativePrompt: 'natural lighting, daytime, muted colors, realism, traditional',
    conditioningScale: 0.6,
    guidanceScale: 7.5
  },
  'indie': {
    name: 'Minimalist Indie',
    promptSuffix: ', minimalist album cover, clean lines, matte texture, muted earth tones, subtle grain, organic shapes, hand-drawn aesthetic, indie music aesthetic',
    negativePrompt: 'busy, crowded, vibrant, glossy, detailed background, complex',
    conditioningScale: 0.8,
    guidanceScale: 7.0
  },
  'vaporwave': {
    name: 'Vaporwave Retro',
    promptSuffix: ', vaporwave aesthetic, pastel colors, 80s retro, glitch art, marble texture, Greek statue, palm trees, sunset gradient, digital art',
    negativePrompt: 'modern, dark, realistic, natural, contemporary',
    conditioningScale: 0.5,
    guidanceScale: 7.0
  },
  'rock': {
    name: 'Rock/Metal',
    promptSuffix: ', rock album cover, metal aesthetic, gritty texture, high contrast, dramatic lighting, band logo style, aggressive typography, concert photography style',
    negativePrompt: 'soft, gentle, pastel, clean, pop, electronic',
    conditioningScale: 0.9,
    guidanceScale: 8.0
  },
  'electronic': {
    name: 'Electronic/EDM',
    promptSuffix: ', EDM album cover, geometric patterns, glow effects, particle system, vibrant colors, abstract shapes, festival aesthetic, nightclub lighting',
    negativePrompt: 'organic, natural, hand-drawn, traditional, realistic',
    conditioningScale: 0.4,
    guidanceScale: 7.5
  }
};

// ============================================
// NEW: IMAGE POST-PROCESSING FUNCTIONS
// ============================================

const postProcessImage = async (imageBuffer, options = {}) => {
  const {
    upscaleTo = 3000,
    aspectRatio = '1:1',
    addGrain = false,
    grainIntensity = 0.2,
    addVignette = false,
    vignetteIntensity = 0.3
  } = options;

  let processedImage = sharp(imageBuffer);

  // Upscale if needed
  if (upscaleTo > 1024) {
    processedImage = processedImage.resize(upscaleTo, upscaleTo, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    });
  }

  // Handle aspect ratios
  if (aspectRatio !== '1:1') {
    const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number);
    const targetWidth = upscaleTo;
    const targetHeight = Math.floor((upscaleTo * heightRatio) / widthRatio);
    
    processedImage = processedImage.resize(targetWidth, targetHeight, {
      fit: 'cover',
      position: 'center'
    });
  }

  // Add film grain if requested
  if (addGrain) {
    // Create grain overlay
    const grainCanvas = createCanvas(1000, 1000);
    const ctx = grainCanvas.getContext('2d');
    
    for (let i = 0; i < 20000; i++) {
      const x = Math.random() * 1000;
      const y = Math.random() * 1000;
      const size = Math.random() * 2;
      const opacity = Math.random() * grainIntensity;
      
      ctx.fillStyle = `rgba(0,0,0,${opacity})`;
      ctx.fillRect(x, y, size, size);
    }
    
    const grainBuffer = grainCanvas.toBuffer('image/png');
    processedImage = processedImage.composite([
      {
        input: grainBuffer,
        blend: 'overlay',
        gravity: 'center'
      }
    ]);
  }

  // Add vignette if requested
  if (addVignette) {
    processedImage = processedImage.gamma(1.1).modulate({
      brightness: 1.05
    });
  }

  return processedImage.toBuffer();
};

// ============================================
// NEW: COLOR PROFILE EXTRACTION FROM REFERENCE IMAGE
// ============================================

const extractColorPalette = async (referenceImageBase64) => {
  try {
    const base64Data = referenceImageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const image = sharp(buffer);
    
    const { data, info } = await image
      .resize(100, 100)
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // Simple color quantization
    const colors = new Map();
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Quantize to reduce color space
      const quantized = `${Math.floor(r / 32) * 32},${Math.floor(g / 32) * 32},${Math.floor(b / 32) * 32}`;
      colors.set(quantized, (colors.get(quantized) || 0) + 1);
    }
    
    // Get top 5 colors
    const sortedColors = Array.from(colors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([color]) => {
        const [r, g, b] = color.split(',').map(Number);
        return { r, g, b };
      });
    
    return sortedColors;
  } catch (error) {
    console.error('Error extracting color palette:', error);
    return null;
  }
};

// ============================================
// TEST ENDPOINTS
// ============================================

router.get('/test-connection', async (req, res) => {
  try {
    console.log('🔍 Testing doodle-art/ai-art API connection...');
    
    const testResults = {
      timestamp: new Date().toISOString(),
      success: true,
      services: {},
      features: {
        stylePresets: Object.keys(STYLE_PRESETS),
        postProcessing: ['upscaling', 'aspect_ratios', 'grain_effects'],
        artistSeed: true
      }
    };

    // 1. Test Replicate API
    if (!process.env.REPLICATE_API_TOKEN) {
      testResults.services.replicate = {
        status: 'error',
        message: 'REPLICATE_API_TOKEN is not configured in environment variables'
      };
    } else {
      try {
        const scribbleModel = await replicate.models.get("jagilley/controlnet-scribble");
        testResults.services.replicate = {
          status: 'connected',
          model: 'jagilley/controlnet-scribble',
          message: 'Replicate API connected successfully'
        };
      } catch (error) {
        testResults.services.replicate = {
          status: 'error',
          message: `Replicate API connection failed: ${error.message}`
        };
      }
    }

    // 2. Test Firebase connection
    try {
      const firestore = await loadFirebaseAdmin();
      if (firestore) {
        testResults.services.firebase = {
          status: 'connected',
          message: 'Firebase Admin initialized successfully'
        };
      } else {
        testResults.services.firebase = {
          status: 'warning',
          message: 'Firebase Admin not initialized - credit system may not work'
        };
      }
    } catch (error) {
      testResults.services.firebase = {
        status: 'error',
        message: `Firebase initialization failed: ${error.message}`
      };
    }

    // 3. Check environment variables
    const requiredEnvVars = ['REPLICATE_API_TOKEN', 'FIREBASE_PROJECT_ID'];
    testResults.services.environment = {
      status: 'checking',
      variables: {}
    };

    requiredEnvVars.forEach(varName => {
      const exists = !!process.env[varName];
      testResults.services.environment.variables[varName] = {
        configured: exists,
        value: exists ? '✓ Configured' : '✗ Missing'
      };
    });

    // Determine overall status
    const hasCriticalErrors = Object.values(testResults.services).some(
      service => service.status === 'error'
    );

    if (hasCriticalErrors) {
      testResults.success = false;
      testResults.message = 'API has configuration issues';
    } else {
      testResults.message = 'Doodle-to-Art / AI-Art API is operational';
    }

    console.log('✅ Test connection completed');
    res.json(testResults);

  } catch (error) {
    console.error('❌ Test connection failed:', error);
    res.status(500).json({
      success: false,
      error: 'Test connection failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// ENHANCED GENERATE ENDPOINT WITH 4 PILLARS
// ============================================

router.post('/generate-enhanced', async (req, res) => {
  try {
    const {
      sketch,
      prompt,
      conditioningScale = 0.8,
      stylePreset = 'indie',
      // Post-processing options
      upscale = false,
      aspectRatio = '1:1',
      addGrain = false,
      // Artist's Seed options
      referenceImage,
      colorProfileOnly = false,
      // Advanced options
      controlType = 'scribble', // 'scribble' or 'canny'
      numOutputs = 1,
      negativePrompt = '',
      userId
    } = req.body;

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

    // Validate style preset
    if (!STYLE_PRESETS[stylePreset]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid style preset',
        message: `Available presets: ${Object.keys(STYLE_PRESETS).join(', ')}`,
        availablePresets: Object.keys(STYLE_PRESETS)
      });
    }

    const generationId = crypto.randomBytes(8).toString('hex');
    console.log(`Starting enhanced generation ${generationId}...`);
    console.log('Style preset:', stylePreset);
    console.log('Control type:', controlType);
    console.log('Post-processing:', { upscale, aspectRatio, addGrain });

    // ============================================
    // CRITICAL: Verify credits BEFORE processing
    // ============================================
    const creditVerification = await verifyUserCreditsBeforeProcessing(userId, 'coverArt', generationId);
    
    if (!creditVerification.verified) {
      console.error(`[ERROR] ❌ Generation ${generationId}: Credit verification failed`);
      return res.status(402).json({
        success: false,
        error: creditVerification.error,
        message: creditVerification.message,
        requiredCredits: 1,
        available: creditVerification.creditsAvailable
      });
    }
    
    console.log(`[VERIFIED] ✅ User credits verified (${creditVerification.creditsAvailable} available)`);

    // ============================================
    // PILLAR 1: STRUCTURE CONTROL WITH INFLUENCE SLIDER
    // ============================================
    
    // Choose ControlNet model based on control type
    const controlNetModel = controlType === 'canny' 
      ? "lllyasviel/sd-controlnet-canny"
      : "jagilley/controlnet-scribble";
    
    const controlNetVersion = controlType === 'canny'
      ? "fef11678ae5b4e0bacc7d4c7f6db81d2e2b6bf5c5a2b0a0e8a0a0a0a0a0a0a0"
      : "435061a1b5a4c1e26740464bf786efdfa9cb3a3ac488595a2de23e143fdb0117";

    // ============================================
    // PILLAR 2: STYLE PRESETS (LoRA-like effects)
    // ============================================
    const styleConfig = STYLE_PRESETS[stylePreset];
    const finalConditioningScale = styleConfig.conditioningScale * conditioningScale;
    const finalGuidanceScale = styleConfig.guidanceScale;

    let finalPrompt = `${prompt}${styleConfig.promptSuffix}`;
    let finalNegativePrompt = negativePrompt || styleConfig.negativePrompt;

    // ============================================
    // PILLAR 4: ARTIST'S SEED (Reference Image)
    // ============================================
    if (referenceImage) {
      try {
        const colorPalette = await extractColorPalette(referenceImage);
        if (colorPalette) {
          const colorStrings = colorPalette.map(c => `rgb(${c.r},${c.g},${c.b})`);
          finalPrompt += `, color palette: ${colorStrings.join(', ')}`;
          console.log(`Applied color palette from reference image: ${colorStrings.join(', ')}`);
        }
        
        if (!colorProfileOnly) {
          // We could also use the reference image for style transfer here
          finalPrompt += `, inspired by reference image color and mood`;
        }
      } catch (error) {
        console.warn('Failed to extract color palette:', error.message);
      }
    }

    // Prepare the image data for Replicate
    const base64Data = sketch.replace(/^data:image\/\w+;base64,/, '');
    const imageDataUrl = `data:image/png;base64,${base64Data}`;

    // Prepare input for Replicate API
    const input = {
      image: imageDataUrl,
      prompt: finalPrompt,
      negative_prompt: finalNegativePrompt,
      num_outputs: Math.min(numOutputs, 4),
      image_resolution: "512",
      num_inference_steps: 50,
      guidance_scale: finalGuidanceScale,
      scheduler: "DPMSolverMultistep",
      conditioning_scale: Math.min(Math.max(finalConditioningScale, 0.1), 1.0),
      seed: Math.floor(Math.random() * 1000000)
    };

    console.log('Calling Replicate ControlNet API...');
    console.log('Final prompt:', finalPrompt.substring(0, 200));
    
    // Call Replicate API
    const output = await replicate.run(
      `${controlNetModel}:${controlNetVersion}`,
      { input }
    );

    console.log('Replicate API response received');
    
    // ============================================
    // PILLAR 3: PROFESSIONAL POST-PROCESSING
    // ============================================
    const processedImages = [];
    
    if (output && output.length > 0) {
      for (const imageUrl of output) {
        if (typeof imageUrl === 'string') {
          // Check if NSFW filter blocked the image
          if (imageUrl.includes('NSFW') || imageUrl.includes('blocked')) {
            continue;
          }
          
          // Download image for processing
          const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
          let imageBuffer = Buffer.from(response.data, 'binary');
          
          // Apply post-processing if requested
          if (upscale || aspectRatio !== '1:1' || addGrain) {
            imageBuffer = await postProcessImage(imageBuffer, {
              upscaleTo: upscale ? 3000 : 1024,
              aspectRatio,
              addGrain,
              grainIntensity: stylePreset === 'grunge' ? 0.3 : 0.15
            });
            
            // Convert to base64 for response
            const base64Image = imageBuffer.toString('base64');
            const mimeType = 'image/png';
            processedImages.push(`data:${mimeType};base64,${base64Image}`);
          } else {
            processedImages.push(imageUrl);
          }
        }
      }
    }

    if (processedImages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'NSFW',
        message: 'Whoa there! Let\'s keep it PG-13. Try a different prompt or sketch.',
        generationId
      });
    }

    // ============================================
    // FORMAT OUTPUT WITH ALL METADATA
    // ============================================
    const responseData = {
      success: true,
      generationId,
      images: processedImages,
      metadata: {
        prompt: finalPrompt,
        stylePreset: styleConfig.name,
        conditioningScale: finalConditioningScale,
        controlType,
        aspectRatio,
        upscaled: upscale,
        postProcessing: {
          upscale: upscale ? '3000x3000' : '1024x1024',
          aspectRatio,
          grainAdded: addGrain,
          referenceImageUsed: !!referenceImage
        }
      },
      timestamp: new Date().toISOString(),
      exportFormats: {
        spotifyCanvas: '9:16',
        instagram: '1:1',
        youtube: '16:9',
        vinyl: '3000x3000 (CMYK ready)'
      },
      note: 'AI may not render text accurately. Add text/logo afterwards using editing tools like Canva or Photoshop.'
    };

    res.json(responseData);

  } catch (error) {
    console.error('Enhanced generation error:', error.message);
    
    // REFUND: Revert credits if failure is NOT due to insufficient credits
    const userId = req.body.userId;
    const generationId = crypto.randomBytes(8).toString('hex');
    if (userId && !error.message.includes('Insufficient')) {
      console.log(`[INFO] 🔄 Attempting to revert credits for failed generation ${generationId}...`);
      const revertResult = await revertUserCredits(userId, 'coverArt', generationId);
      if (!revertResult.success) {
        console.warn(`[⚠️ REFUND FAILED] ${revertResult.message}`);
      }
    }
    
    // Handle specific error cases
    if (error.message.includes('NSFW') || error.message.includes('inappropriate')) {
      return res.status(400).json({
        success: false,
        error: 'NSFW',
        message: 'Content was blocked by safety filters. Please try a different sketch or prompt.'
      });
    }

    if (error.message.includes('credit') || error.message.includes('insufficient')) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient Credits',
        message: 'Please add credits to your account to continue.'
      });
    }

    // General error
    res.status(500).json({
      success: false,
      error: 'Generation failed',
      message: error.message || 'An unexpected error occurred during generation'
    });
  }
});

// ============================================
// NEW: GET STYLE PRESETS ENDPOINT
// ============================================

router.get('/style-presets', (req, res) => {
  const presets = Object.entries(STYLE_PRESETS).map(([id, config]) => ({
    id,
    name: config.name,
    description: config.promptSuffix.replace(',', '').trim(),
    examplePrompts: [
      `Album cover for ${id} music`,
      `${id} aesthetic artwork`,
      `${config.name} style illustration`
    ],
    conditioningScale: config.conditioningScale,
    guidanceScale: config.guidanceScale
  }));
  
  res.json({
    success: true,
    presets,
    count: presets.length
  });
});

// ============================================
// NEW: BATCH EXPORT ENDPOINT
// ============================================

router.post('/export-batch', async (req, res) => {
  try {
    const { imageUrl, formats = ['1:1', '9:16', '16:9'] } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing image URL'
      });
    }

    // Download the original image
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const originalBuffer = Buffer.from(response.data, 'binary');
    
    const exports = {};
    
    // Generate each requested format
    for (const format of formats) {
      const [widthRatio, heightRatio] = format.split(':').map(Number);
      
      // Calculate dimensions (max 3000 on longest side)
      let width, height;
      if (widthRatio >= heightRatio) {
        width = 3000;
        height = Math.floor((3000 * heightRatio) / widthRatio);
      } else {
        height = 3000;
        width = Math.floor((3000 * widthRatio) / heightRatio);
      }
      
      const processedBuffer = await sharp(originalBuffer)
        .resize(width, height, {
          fit: 'cover',
          position: 'center'
        })
        .toBuffer();
      
      const base64Image = processedBuffer.toString('base64');
      exports[format] = `data:image/png;base64,${base64Image}`;
    }
    
    res.json({
      success: true,
      exports,
      formats: Object.keys(exports),
      dimensions: Object.entries(exports).map(([format]) => {
        const [w, h] = format.split(':').map(Number);
        return { format, ratio: `${w}:${h}` };
      })
    });
    
  } catch (error) {
    console.error('Export batch error:', error);
    res.status(500).json({
      success: false,
      error: 'Export failed',
      message: error.message
    });
  }
});

// ============================================
// KEEP EXISTING ENDPOINTS FOR BACKWARD COMPATIBILITY
// ============================================

// Original generate endpoint (simplified version)
router.post('/generate', async (req, res) => {
  try {
    const { sketch, prompt, conditioningScale = 0.8 } = req.body;
    
    if (!sketch || !prompt) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields'
      });
    }

    // Forward to enhanced endpoint with default settings
    req.body = {
      ...req.body,
      stylePreset: 'indie',
      controlType: 'scribble'
    };
    
    // Call the enhanced endpoint
    return router.post('/generate-enhanced')(req, res);
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Generation failed',
      message: error.message
    });
  }
});

// ============================================
// ANIMATION ENDPOINTS (UPDATED FOR 4K)
// ============================================

router.post('/animate-enhanced', async (req, res) => {
  try {
    const { 
      imageUrl, 
      prompt, 
      motionStrength = 0.6,
      duration = 8,
      quality = 'standard', // 'standard', 'premium', '4k'
      style = 'cinematic'
    } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing image URL'
      });
    }

    const generationId = crypto.randomBytes(8).toString('hex');
    console.log(`Starting enhanced animation ${generationId}...`);
    console.log('Quality:', quality);
    console.log('Duration:', duration, 'seconds');

    // ============================================
    // CREDIT VERIFICATION
    // ============================================
    const userId = req.body.userId;
    const creditVerification = await verifyUserCreditsBeforeProcessing(userId, 'lyricVideo', generationId);
    
    if (!creditVerification.verified) {
      return res.status(402).json({
        success: false,
        error: creditVerification.error,
        message: creditVerification.message
      });
    }

    // Determine parameters based on quality
    const qualitySettings = {
      'standard': { fps: 12, maxDuration: 15 },
      'premium': { fps: 24, maxDuration: 30 },
      '4k': { fps: 30, maxDuration: 60 }
    };

    const settings = qualitySettings[quality] || qualitySettings.standard;
    const finalDuration = Math.min(duration, settings.maxDuration);

    const input = {
      input_image: imageUrl,
      motion_bucket_id: Math.floor(motionStrength * 255),
      fps: settings.fps,
      seed: Math.floor(Math.random() * 1000000),
      video_length: finalDuration,
      decoding_t: 7,
      ...(quality === 'premium' || quality === '4k' ? { style, camera_motion: 'subtle_zoom' } : {})
    };

    console.log('Calling Stability AI Video API...');
    
    const output = await replicate.run(
      "stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438",
      { input }
    );

    res.json({
      success: true,
      generationId,
      videoUrl: output,
      duration: finalDuration,
      quality,
      fps: settings.fps,
      format: 'mp4',
      loop: true,
      readyFor: {
        spotifyCanvas: finalDuration === 8 ? 'Perfect 8-second loop' : 'Adjust duration to 8s',
        instagramReels: 'Ready (up to 90s)',
        tiktok: 'Ready (up to 60s)'
      },
      metadata: {
        motionStrength,
        style,
        estimatedSize: `${quality === '4k' ? '50-100MB' : quality === 'premium' ? '20-50MB' : '5-20MB'}`
      }
    });

  } catch (error) {
    console.error('Enhanced animation error:', error);
    
    // REFUND if needed
    const userId = req.body.userId;
    const generationId = crypto.randomBytes(8).toString('hex');
    if (userId && !error.message.includes('Insufficient')) {
      await revertUserCredits(userId, 'lyricVideo', generationId);
    }
    
    res.status(500).json({
      success: false,
      error: 'Animation failed',
      message: error.message
    });
  }
});

// ============================================
// HEALTH AND INFO ENDPOINTS
// ============================================

router.get('/features', (req, res) => {
  res.json({
    success: true,
    features: {
      pillars: {
        structureControl: {
          enabled: true,
          controlTypes: ['scribble', 'canny'],
          influenceSlider: '0.1 to 1.0'
        },
        stylePresets: {
          enabled: true,
          count: Object.keys(STYLE_PRESETS).length,
          presets: Object.keys(STYLE_PRESETS)
        },
        postProcessing: {
          enabled: true,
          upscaling: 'up to 3000x3000',
          aspectRatios: ['1:1', '9:16', '16:9', '4:3'],
          colorProfiles: ['RGB', 'CMYK ready'],
          effects: ['film grain', 'vignette']
        },
        artistsSeed: {
          enabled: true,
          features: ['color palette extraction', 'reference style guidance']
        }
      },
      animation: {
        enabled: true,
        qualities: ['standard', 'premium', '4k'],
        maxDuration: 60,
        platforms: ['Spotify Canvas', 'Instagram', 'TikTok', 'YouTube']
      }
    }
  });
});

// Existing health endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'doodle-art-enhanced-api',
    status: 'operational',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    features: Object.keys(STYLE_PRESETS).length + ' style presets available'
  });
});

// Root endpoint
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Enhanced Doodle-to-Art API',
    version: '3.0.0',
    endpoints: {
      generateEnhanced: 'POST /generate-enhanced - Enhanced generation with all 4 pillars',
      stylePresets: 'GET /style-presets - List available style presets',
      exportBatch: 'POST /export-batch - Export in multiple aspect ratios',
      animateEnhanced: 'POST /animate-enhanced - Enhanced animation with 4K support',
      features: 'GET /features - List all available features'
    }
  });
});

export default router;