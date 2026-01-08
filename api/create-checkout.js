import { auth } from '../../../backend/firebaseAdmin.js';

// Check if Firebase Auth is available (for logging purposes only)
const isFirebaseAuthAvailable = () => {
  return !!auth;
};

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.log(`❌ Invalid method - ${req.method} for /api/create-checkout`);
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      expiresAt: result.expires_at
    });

  } catch (error) {
    console.error('❌ Checkout creation error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}

// ==================== CREDIT MANAGEMENT ENDPOINTS ====================
// These endpoints are for testing and manual operations

// Check if this is being run as a standalone server
const isStandalone = process.argv[1] && process.argv[1].includes('create-checkout.js');

if (isStandalone) {
  import('express').then(expressModule => {
    const express = expressModule.default;
    const app = express();
    
    app.use(express.json());
    
    // Add credit management endpoints for testing
    app.get('/api/health', (req, res) => {
      console.log('🏥 Health check requested');
      res.json({
        success: true,
        service: 'checkout-api',
        status: 'healthy',
        firebaseAuth: isFirebaseAuthAvailable() ? 'available' : 'unavailable',
        dodoApi: process.env.DODO_PAYMENTS_API_KEY ? 'configured' : 'not configured'
      });
    });
    
    app.post('/api/test-checkout', async (req, res) => {
      try {
        console.log('🧪 Test checkout requested');
        
        const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
        
        if (!DODO_API_KEY) {
          return res.status(500).json({
            success: false,
            error: 'Dodo API key not configured'
          });
        }
        
        // Test Dodo API connection
        const response = await fetch('https://api.dodopayments.com/v1/ping', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${DODO_API_KEY}`
          }
        });
        
        if (response.ok) {
          console.log('✅ Dodo API connection successful');
          res.json({
            success: true,
            message: 'Dodo API connection successful'
          });
        } else {
          const error = await response.json();
          console.error('❌ Dodo API connection failed:', error);
          res.status(response.status).json({
            success: false,
            error: error.message || 'Dodo API connection failed'
          });
        }
      } catch (error) {
        console.error('❌ Test checkout error:', error.message);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
    
    const PORT = process.env.PORT || 3003;
    app.listen(PORT, () => {
      console.log(`🧪 Checkout test server running on port ${PORT}`);
    });
  });
}