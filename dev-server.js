import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'], // Vite default port
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import your API handlers with better error handling
const importHandler = async (path) => {
  try {
    console.log(`📦 Importing handler: ${path}`);
    const module = await import(path);
    if (!module.default) {
      throw new Error(`No default export found in ${path}`);
    }
    console.log(`✅ Successfully imported: ${path}`);
    return module.default;
  } catch (error) {
    console.error(`❌ Failed to import ${path}:`, error.message);
    return (req, res) => {
      console.error(`Handler error for ${path}:`, error.message);
      res.status(500).json({ 
        error: 'Handler not available', 
        details: error.message,
        path: path 
      });
    };
  }
};

// API routes - add all endpoints
app.use('/api/points', async (req, res) => {
  console.log(`🔗 Points route called: ${req.method} ${req.originalUrl}`);
  try {
    const handler = await importHandler('./api/points.js');
    return handler(req, res);
  } catch (error) {
    console.error('Points route error:', error);
    res.status(500).json({ error: 'Points API error', details: error.message });
  }
});

app.use('/api/user', async (req, res) => {
  console.log(`👤 User route called: ${req.method} ${req.originalUrl}`);
  try {
    const handler = await importHandler('./api/user.js');
    return handler(req, res);
  } catch (error) {
    console.error('User route error:', error);
    res.status(500).json({ error: 'User API error', details: error.message });
  }
});

app.use('/api/feedback', async (req, res) => {
  console.log(`💬 Feedback route called: ${req.method} ${req.originalUrl}`);
  try {
    const handler = await importHandler('./api/feedback.js');
    return handler(req, res);
  } catch (error) {
    console.error('Feedback route error:', error);
    res.status(500).json({ error: 'Feedback API error', details: error.message });
  }
});

app.use('/api/analytics', async (req, res) => {
  console.log(`📈 Analytics route called: ${req.method} ${req.originalUrl}`);
  try {
    const handler = await importHandler('./api/analytics.js');
    return handler(req, res);
  } catch (error) {
    console.error('Analytics route error:', error);
    res.status(500).json({ error: 'Analytics API error', details: error.message });
  }
});

// Add test route
app.use('/api/test', async (req, res) => {
  console.log(`🧪 Test route called: ${req.method} ${req.originalUrl}`);
  try {
    const handler = await importHandler('./api/test.js');
    return handler(req, res);
  } catch (error) {
    console.error('Test route error:', error);
    res.status(500).json({ error: 'Test API error', details: error.message });
  }
});

app.use('/api/pairings', async (req, res) => {
  console.log(`🔄 Pairings route called: ${req.method} ${req.originalUrl}`);
  try {
    const handler = await importHandler('./api/pairings.js');
    return handler(req, res);
  } catch (error) {
    console.error('Pairings route error:', error);
    res.status(500).json({ error: 'Pairings API error', details: error.message });
  }
});

app.use('/api/subscriptions', async (req, res) => {
  console.log(`💳 Subscriptions route called: ${req.method} ${req.originalUrl}`);
  try {
    const handler = await importHandler('./api/subscriptions.js');
    return handler(req, res);
  } catch (error) {
    console.error('Subscriptions route error:', error);
    res.status(500).json({ error: 'Subscriptions API error', details: error.message });
  }
});

// Add a catch-all route for debugging
app.use('/api/*', (req, res) => {
  console.log(`❓ Unknown API route: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'API route not found',
    method: req.method,
    path: req.originalUrl,
    availableRoutes: ['/api/points', '/api/user', '/api/feedback', '/api/analytics', '/api/test', '/health']
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Test endpoint to verify Firebase connection with better error handling
app.get('/test-firebase', async (req, res) => {
  try {
    console.log('Testing Firebase connection...');
    
    // Check if we have Firebase credentials
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_PRIVATE_KEY) {
      return res.status(500).json({ 
        firebase: 'error', 
        error: 'No Firebase credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_PRIVATE_KEY environment variable.',
        timestamp: new Date().toISOString()
      });
    }

    const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    
    if (!getApps().length) {
      console.log('Initializing Firebase Admin...');
      initializeApp({ credential: applicationDefault() });
    }
    
    const db = getFirestore();
    console.log('Testing Firestore access...');
    
    // Try to read from a collection with timeout
    const testPromise = db.collection('signups').limit(1).get();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Firebase operation timed out')), 3000);
    });
    
    const testCollection = await Promise.race([testPromise, timeoutPromise]);
    
    res.json({ 
      firebase: 'connected', 
      collections: 'accessible',
      collectionsFound: testCollection.size,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Firebase test error:', error);
    res.status(500).json({ 
      firebase: 'error', 
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔥 Firebase test: http://localhost:${PORT}/test-firebase`);
  console.log(`📡 API endpoints:`);
  console.log(`   - http://localhost:${PORT}/api/points`);
  console.log(`   - http://localhost:${PORT}/api/user`);
  console.log(`   - http://localhost:${PORT}/api/feedback`);
  console.log(`   - http://localhost:${PORT}/api/analytics`);
  console.log(`   - http://localhost:${PORT}/api/subscriptions`);
  console.log(`   - http://localhost:${PORT}/api/pairings`);
  console.log(`   - http://localhost:${PORT}/api/test`);
});
console.log(`   - http://localhost:${PORT}/api/analytics`);
