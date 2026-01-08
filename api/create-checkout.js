// create-checkout.js - Dodo Payments Checkout API
import express from 'express';
import { auth } from '../firebaseAdmin.js';

const router = express.Router();

// Check if Firebase Auth is available (for logging purposes only)
const isFirebaseAuthAvailable = () => {
  return !!auth;
};

// ==================== DODO PAYMENTS CHECKOUT ====================

// Create checkout session
router.post('/', async (req, res) => {
  try {
    console.log('🔄 Creating checkout session');
    
    // Get the authorization token from headers
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ No authorization header provided');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - No token provided' 
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    // Verify Firebase ID token
    let decodedToken;
    try {
      if (!isFirebaseAuthAvailable()) {
        console.warn('⚠️ Firebase Auth not available, skipping token verification for testing');
        // For testing, accept a mock token
        decodedToken = { uid: 'test-user', email: req.body.email || 'test@example.com' };
      } else {
        decodedToken = await auth.verifyIdToken(idToken);
      }
    } catch (error) {
      console.error('❌ Token verification error:', error.message);
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - Invalid token' 
      });
    }

    const { uid, email: tokenEmail } = decodedToken;
    const { variantId, type, successUrl, cancelUrl } = req.body;
    
    // Use name from request body or from token if not provided
    const { name, email: bodyEmail } = req.body;
    
    if (!variantId) {
      console.log('❌ Missing variantId in request');
      return res.status(400).json({ 
        success: false,
        error: 'Missing product ID (variantId)' 
      });
    }

    // Security check: Ensure the authenticated user matches the requested user
    const { userId } = req.body;
    if (userId && userId !== uid) {
      console.log(`❌ User ID mismatch - Token: ${uid}, Request: ${userId}`);
      return res.status(403).json({ 
        success: false,
        error: 'Forbidden - User ID mismatch' 
      });
    }

    // Use email from token (more secure) or fall back to body email
    const customerEmail = tokenEmail || bodyEmail;
    
    if (!customerEmail) {
      console.log('❌ No email provided');
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }

    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    
    if (!DODO_API_KEY) {
      console.error('❌ Dodo API key not configured');
      return res.status(500).json({ 
        success: false,
        error: 'Server configuration error' 
      });
    }
    
    console.log(`🛒 Creating checkout - User: ${uid}, Product: ${variantId}, Type: ${type}`);
    
    // Create Checkout Session via Dodo API
    const response = await fetch('https://api.dodopayments.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        product_cart: [
          {
            product_id: variantId,
            quantity: 1
          }
        ],
        customer: {
          email: customerEmail,
          name: name || '' // Optional name
        },
        metadata: {
          user_id: uid, // Use the verified Firebase UID
          type: type,
          firebase_uid: uid // Store for reference
        },
        return_url: successUrl || `${process.env.NEXT_PUBLIC_APP_URL}/studio?payment=success`,
        cancel_url: cancelUrl || `${process.env.NEXT_PUBLIC_APP_URL}/studio?payment=cancelled`,
        payment_link: true
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Dodo API Error:', result);
      return res.status(response.status).json({
        success: false,
        error: result.message || 'Failed to create checkout',
        details: result
      });
    }

    console.log(`✅ Checkout created - Session ID: ${result.id}, URL: ${result.checkout_url}`);
    
    res.status(200).json({
      success: true,
      checkoutUrl: result.checkout_url,
      sessionId: result.id,
      expiresAt: result.expires_at,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Checkout creation error:', error.message);
    console.error(error.stack);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: 'Internal server error'
    });
  }
});

// ==================== PRODUCT CATALOG FUNCTIONS ====================

const PRODUCT_CATALOG = {
  // One-time purchases (credits)
  'prod_starter': {
    id: 'prod_starter',
    name: 'Starter Pack',
    description: '10 Cover Art Credits',
    credits: 10,
    price: 990, // $9.90 in cents
    type: 'one_time',
    creditType: 'coverArt'
  },
  'prod_creator': {
    id: 'prod_creator',
    name: 'Creator Pack',
    description: '25 Cover Art Credits',
    credits: 25,
    price: 2490, // $24.90 in cents
    type: 'one_time',
    creditType: 'coverArt'
  },
  'prod_pro': {
    id: 'prod_pro',
    name: 'Professional Pack',
    description: '100 Cover Art Credits',
    credits: 100,
    price: 8990, // $89.90 in cents
    type: 'one_time',
    creditType: 'coverArt'
  },
  'video_30s': {
    id: 'video_30s',
    name: 'Single 30s Lyric Video',
    description: '1 Lyric Video Credit (30 seconds)',
    credits: 1,
    price: 1490, // $14.90 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  'video_3pack_30s': {
    id: 'video_3pack_30s',
    name: '3-Pack 30s Lyric Videos',
    description: '3 Lyric Video Credits (30 seconds each)',
    credits: 3,
    price: 3990, // $39.90 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  'video_full': {
    id: 'video_full',
    name: 'Single Full Lyric Video',
    description: '2 Lyric Video Credits (Full song)',
    credits: 2,
    price: 2490, // $24.90 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  'video_3pack_full': {
    id: 'video_3pack_full',
    name: '3-Pack Full Lyric Videos',
    description: '6 Lyric Video Credits (Full song each)',
    credits: 6,
    price: 6990, // $69.90 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  'video_10pack_full': {
    id: 'video_10pack_full',
    name: '10-Pack Full Lyric Videos',
    description: '20 Lyric Video Credits (Full song each)',
    credits: 20,
    price: 19900, // $199.00 in cents
    type: 'one_time',
    creditType: 'lyricVideo'
  },
  
  // Subscriptions
  'sub_basic_monthly': {
    id: 'sub_basic_monthly',
    name: 'Basic Monthly',
    description: '10 Cover Art Credits / Month',
    credits: 10,
    price: 990, // $9.90/month in cents
    type: 'subscription',
    creditType: 'coverArt',
    interval: 'monthly'
  },
  'sub_creator_monthly': {
    id: 'sub_creator_monthly',
    name: 'Creator Monthly',
    description: '25 Cover Art Credits / Month',
    credits: 25,
    price: 2490, // $24.90/month in cents
    type: 'subscription',
    creditType: 'coverArt',
    interval: 'monthly'
  },
  'sub_pro_monthly': {
    id: 'sub_pro_monthly',
    name: 'Professional Monthly',
    description: '100 Cover Art Credits / Month',
    credits: 100,
    price: 8990, // $89.90/month in cents
    type: 'subscription',
    creditType: 'coverArt',
    interval: 'monthly'
  }
};

// ==================== ADDITIONAL ENDPOINTS ====================

// Get available products
router.get('/products', (req, res) => {
  try {
    console.log('📦 Fetching product catalog');
    
    // Filter products by type if specified
    const { type, creditType } = req.query;
    let products = Object.values(PRODUCT_CATALOG);
    
    if (type) {
      products = products.filter(p => p.type === type);
    }
    
    if (creditType) {
      products = products.filter(p => p.creditType === creditType);
    }
    
    res.json({
      success: true,
      products: products,
      count: products.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error fetching products:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get specific product
router.get('/products/:productId', (req, res) => {
  try {
    const { productId } = req.params;
    console.log(`📦 Fetching product: ${productId}`);
    
    const product = PRODUCT_CATALOG[productId];
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: `Product not found: ${productId}`
      });
    }
    
    res.json({
      success: true,
      product: product,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error fetching product:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Checkout API is working',
    environment: process.env.NODE_ENV || 'development',
    firebaseAuth: isFirebaseAuthAvailable() ? 'available' : 'unavailable',
    dodoApi: process.env.DODO_PAYMENTS_API_KEY ? 'configured' : 'not configured',
    timestamp: new Date().toISOString()
  });
});

// Test Dodo API connection
router.get('/test-dodo', async (req, res) => {
  try {
    console.log('🧪 Testing Dodo API connection');
    
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    
    if (!DODO_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Dodo API key not configured'
      });
    }
    
    // Try to get account info or ping endpoint
    const response = await fetch('https://api.dodopayments.com/v1/account', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Dodo API connection successful');
      res.json({
        success: true,
        message: 'Dodo API connection successful',
        account: {
          id: result.id,
          name: result.name,
          email: result.email,
          mode: result.mode // 'test' or 'live'
        }
      });
    } else {
      const error = await response.json();
      console.error('❌ Dodo API connection failed:', error);
      res.status(response.status).json({
        success: false,
        error: error.message || 'Dodo API connection failed',
        details: error
      });
    }
  } catch (error) {
    console.error('❌ Test Dodo API error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get checkout session status
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log(`📋 Checking session status: ${sessionId}`);
    
    const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
    
    if (!DODO_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Dodo API key not configured'
      });
    }
    
    const response = await fetch(`https://api.dodopayments.com/v1/checkouts/${sessionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DODO_API_KEY}`
      }
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('❌ Dodo API Error:', result);
      return res.status(response.status).json({
        success: false,
        error: result.message || 'Failed to get session',
        details: result
      });
    }
    
    res.json({
      success: true,
      session: result,
      status: result.status,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting session:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Webhook test endpoint (for manual testing)
router.post('/test-webhook', async (req, res) => {
  try {
    const { eventType, data } = req.body;
    
    if (!eventType) {
      return res.status(400).json({
        success: false,
        message: 'eventType is required'
      });
    }
    
    console.log(`🔄 Simulating webhook event: ${eventType}`);
    
    // This would normally send to your webhook endpoint
    // For testing, just return success
    res.json({
      success: true,
      message: `Simulated ${eventType} event`,
      eventType,
      data,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in webhook test:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

console.log('🚀 Dodo Payments Checkout API Initialized');
console.log(`✅ Firebase Auth: ${isFirebaseAuthAvailable() ? 'Available' : 'Not Available'}`);
console.log(`✅ Dodo API Key: ${process.env.DODO_PAYMENTS_API_KEY ? 'Configured' : 'Not Configured'}`);
console.log(`📊 Products Available: ${Object.keys(PRODUCT_CATALOG).length}`);
console.log(`🎯 Endpoint: /api/create-checkout`);

export default router;