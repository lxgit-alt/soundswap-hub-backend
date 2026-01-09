// server.js - Main Express server (FIXED)
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';

// Load environment variables FIRST
dotenv.config();

const app = express();

// ==================== MODULE LOADING ISOLATION ====================
// Flag to track if payments processing is active
global.__payments_running = false;
global.__automation_running = false;

// ==================== LAZY MODULE LOADERS ====================
// These functions will be used to lazily load modules
const lazyModules = {
  firebase: null,
  firestore: null,
  payments: {
    checkout: null,
    webhook: null
  },
  reddit: null,
  email: null,
  doodleArt: null,
  lyricVideo: null
};

// Lazy load Firebase Admin
const lazyLoadFirebase = async () => {
  if (!lazyModules.firebase) {
    console.log('[LAZY-LOAD] 🔥 Loading Firebase Admin...');
    const adminModule = await import('firebase-admin');
    lazyModules.firebase = adminModule.default;
    
    // Initialize Firebase if not already initialized
    if (lazyModules.firebase.apps.length === 0) {
      const serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      };
      
      if (serviceAccount.projectId && serviceAccount.clientEmail && serviceAccount.privateKey) {
        lazyModules.firebase.initializeApp({
          credential: lazyModules.firebase.credential.cert(serviceAccount),
          databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        console.log('[LAZY-LOAD] 🔥 Firebase Admin initialized');
      } else {
        console.warn('[WARN] ⚠️ Firebase credentials incomplete');
      }
    }
  }
  return lazyModules.firebase;
};

// Lazy load Firestore
const lazyLoadFirestore = async () => {
  if (!lazyModules.firestore) {
    const admin = await lazyLoadFirebase();
    lazyModules.firestore = admin.firestore();
  }
  return lazyModules.firestore;
};

// ==================== MIDDLEWARE ====================
app.set('trust proxy', 1);

// Security headers - minimal for payments
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration optimized for payments
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['https://soundswap.live'])
    : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'webhook-id', 'webhook-timestamp', 'webhook-signature']
}));

// Body parsing - raw body preserved for webhooks
app.use(bodyParser.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// ==================== ROUTE LOADING MIDDLEWARE ====================
app.use((req, res, next) => {
  const path = req.path;
  
  // Set flags for isolation
  if (path.includes('/api/create-checkout') || path.includes('/api/lemon-webhook')) {
    global.__payments_running = true;
    global.__automation_running = false;
  }
  
  if (path.includes('/api/reddit-admin/cron') || path.includes('/api/cron-reddit')) {
    global.__automation_running = true;
    global.__payments_running = false;
  }
  
  next();
});

// ==================== FAST ENDPOINTS (NO EXTERNAL DEPS) ====================
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    payments_active: global.__payments_running,
    automation_active: global.__automation_running
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    service: 'soundswap-backend',
    status: 'operational',
    version: '2.2.0',
    lazy_loading: 'ENABLED',
    timestamp: new Date().toISOString(),
    module_status: {
      firebase: lazyModules.firebase ? 'loaded' : 'not loaded',
      firestore: lazyModules.firestore ? 'loaded' : 'not loaded',
      payments: {
        checkout: lazyModules.payments.checkout ? 'loaded' : 'not loaded',
        webhook: lazyModules.payments.webhook ? 'loaded' : 'not loaded'
      }
    }
  });
});

// ==================== PAYMENTS ENDPOINTS (LAZY LOADED) ====================
app.post('/api/create-checkout', async (req, res, next) => {
  try {
    if (!lazyModules.payments.checkout) {
      console.log('[LAZY-LOAD] 🛒 Loading checkout module...');
      const checkoutModule = await import('./routes/create-checkout.js');
      lazyModules.payments.checkout = checkoutModule.default;
    }
    
    // Set payments flag
    global.__payments_running = true;
    
    // Handle raw body for webhook-like requests
    if (req.rawBody) {
      req.body = JSON.parse(req.rawBody.toString());
    }
    
    return lazyModules.payments.checkout(req, res, next);
  } catch (error) {
    console.error('[ERROR] ❌ Failed to load checkout module:', error);
    res.status(503).json({
      success: false,
      error: 'Payments service temporarily unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/lemon-webhook', bodyParser.raw({ type: '*/*', limit: '10mb' }), async (req, res, next) => {
  try {
    if (!lazyModules.payments.webhook) {
      console.log('[LAZY-LOAD] 🔄 Loading webhook module...');
      const webhookModule = await import('./routes/lemon-webhook.js');
      lazyModules.payments.webhook = webhookModule.default;
    }
    
    // Set payments flag
    global.__payments_running = true;
    
    return lazyModules.payments.webhook(req, res, next);
  } catch (error) {
    console.error('[ERROR] ❌ Failed to load webhook module:', error);
    res.status(503).json({
      success: false,
      error: 'Webhook service temporarily unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== CREDIT MANAGEMENT ENDPOINTS (LAZY LOAD FIREBASE) ====================

app.post('/api/check-credits', async (req, res) => {
  try {
    const { userId, type } = req.body;
    
    if (!userId || !type) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        timestamp: new Date().toISOString()
      });
    }
    
    const db = await lazyLoadFirestore();
    
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString()
      });
    }
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: 'User not found',
        timestamp: new Date().toISOString()
      });
    }
    
    const userData = userDoc.data();
    let credits = 0;
    
    if (type === 'coverArt') {
      credits = userData.points || 0;
    } else if (type === 'lyricVideo') {
      credits = userData.lyricVideoCredits || 0;
    }
    
    res.json({
      success: true,
      credits,
      type,
      userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error checking credits:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/deduct-credits', async (req, res) => {
  try {
    const { userId, type, amount, reason } = req.body;
    
    if (!userId || !type || !amount) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        timestamp: new Date().toISOString()
      });
    }
    
    const admin = await lazyLoadFirebase();
    const db = await lazyLoadFirestore();
    
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Database not available',
        timestamp: new Date().toISOString()
      });
    }
    
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        error: 'User not found',
        timestamp: new Date().toISOString()
      });
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
      return res.status(400).json({ 
        error: 'Invalid credit type',
        timestamp: new Date().toISOString()
      });
    }
    
    if (currentCredits < amount) {
      return res.status(400).json({ 
        success: false,
        error: 'Insufficient credits',
        required: amount,
        available: currentCredits,
        timestamp: new Date().toISOString()
      });
    }
    
    const newCredits = currentCredits - amount;
    
    await userRef.update({
      [fieldToUpdate]: newCredits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const transactionRef = db.collection('credit_transactions').doc();
    await transactionRef.set({
      userId,
      type: 'deduction',
      creditType: type,
      amount: -amount,
      reason: reason || 'generation',
      remaining: newCredits,
      date: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: Date.now()
    });
    
    res.json({
      success: true,
      type,
      deducted: amount,
      remaining: newCredits,
      transactionId: transactionRef.id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error deducting credits:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== OTHER ENDPOINTS ====================
// Get checkout products (FAST - no Firebase)
app.get('/api/create-checkout/products', async (req, res) => {
  try {
    // Lazy load just the checkout module for products endpoint
    if (!lazyModules.payments.checkout) {
      const checkoutModule = await import('./routes/create-checkout.js');
      lazyModules.payments.checkout = checkoutModule.default;
    }
    
    // Create mock request for products endpoint
    const mockReq = {
      method: 'GET',
      path: '/products',
      query: req.query,
      headers: req.headers
    };
    
    const mockRes = {
      json: (data) => res.json(data),
      status: (code) => ({
        json: (data) => res.status(code).json(data)
      })
    };
    
    const mockNext = (err) => {
      if (err) {
        res.status(500).json({
          success: false,
          error: err.message,
          timestamp: new Date().toISOString()
        });
      }
    };
    
    // Route to products endpoint
    return lazyModules.payments.checkout(mockReq, mockRes, mockNext);
  } catch (error) {
    console.error('[ERROR] ❌ Failed to get products:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get products',
      timestamp: new Date().toISOString()
    });
  }
});

// Test payments endpoint
app.get('/api/payments/test', (req, res) => {
  res.json({
    success: true,
    message: 'Payments API is accessible',
    lazy_loading: 'ENABLED',
    checkout_module: lazyModules.payments.checkout ? 'loaded' : 'not loaded',
    webhook_module: lazyModules.payments.webhook ? 'loaded' : 'not loaded',
    timestamp: new Date().toISOString()
  });
});

// Clean up flags after request
app.use((req, res, next) => {
  // Reset flags after response
  res.on('finish', () => {
    global.__payments_running = false;
    global.__automation_running = false;
  });
  next();
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      '/api/health',
      '/api/status',
      '/api/create-checkout (POST)',
      '/api/create-checkout/products (GET)',
      '/api/lemon-webhook (POST)',
      '/api/check-credits (POST)',
      '/api/deduct-credits (POST)',
      '/api/payments/test (GET)'
    ]
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error.message);
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// For Vercel serverless functions
export default app;

// Local development
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
    console.log(`💰 Payments endpoint: POST http://localhost:${PORT}/api/create-checkout`);
    console.log(`🔄 Webhook endpoint: POST http://localhost:${PORT}/api/lemon-webhook`);
    console.log(`📦 Products: GET http://localhost:${PORT}/api/create-checkout/products`);
  });
}