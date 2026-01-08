import { db } from '../firebaseAdmin.js';
import { 
  doc, updateDoc, increment, collection, 
  query, where, getDocs, serverTimestamp, setDoc 
} from 'firebase/firestore';
import crypto from 'crypto';

// Check if Firebase is available (for logging purposes only)
const isFirebaseAvailable = () => {
  return !!db;
};

// Store raw body for signature verification
let rawBody = '';

export const config = {
  api: {
    bodyParser: false, // Disable Next.js body parsing to get raw body
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Payment webhook received');
    
    // 1. Get the raw request body for signature verification
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    rawBody = Buffer.concat(chunks).toString('utf8');
    
    // Parse the JSON for event handling
    const event = JSON.parse(rawBody);
    
    // 2. Verify Dodo Payments Webhook Signature
    // Dodo usually sends signature in 'dodo-signature' or 'x-dodo-signature' header
    const signature = req.headers['dodo-signature'] || 
                     req.headers['x-dodo-signature'] || 
                     req.headers['webhook-signature'];
    
    const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    
    if (!secret) {
      console.error('❌ DODO_PAYMENTS_WEBHOOK_KEY not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    console.log('🔑 Signature verification details:');
    console.log('   - Signature header:', Object.keys(req.headers).filter(k => k.toLowerCase().includes('signature')));
    console.log('   - Raw body length:', rawBody.length);
    console.log('   - Event type:', event.type);
    
    // IMPORTANT: Dodo might use a different signing method
    // Some payment providers use: HMAC SHA256 of raw body with secret
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(rawBody).digest('hex');
    
    console.log(`🔑 Computed digest: ${digest.substring(0, 32)}...`);
    console.log(`🔑 Received signature: ${signature ? signature.substring(0, 32) + '...' : 'MISSING'}`);
    
    if (!signature) {
      console.error('❌ No signature provided in headers');
      console.error('❌ All headers:', req.headers);
      return res.status(401).json({ error: 'No signature provided' });
    }
    
    // Try different signature comparison methods
    
    // Method 1: Direct comparison (most common)
    if (digest === signature) {
      console.log('✅ Signature verified (direct match)');
    } 
    // Method 2: Check if signature includes timestamp (common format: t=timestamp,v1=signature)
    else if (signature.includes('t=') && signature.includes('v1=')) {
      console.log('⚠️ Signature appears to be in timestamped format');
      
      // Parse timestamped signature format: t=timestamp,v1=signature
      const parts = signature.split(',');
      let receivedDigest = '';
      
      for (const part of parts) {
        if (part.startsWith('v1=')) {
          receivedDigest = part.substring(3);
          break;
        }
      }
      
      if (receivedDigest && digest === receivedDigest) {
        console.log('✅ Signature verified (timestamped format)');
      } else {
        console.error('❌ Invalid signature (timestamped format mismatch)');
        console.error(`   Expected: ${digest.substring(0, 32)}...`);
        console.error(`   Received: ${receivedDigest.substring(0, 32)}...`);
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
    // Method 3: Check if it's base64 encoded
    else if (signature.length !== 64) { // SHA256 hex digest should be 64 chars
      try {
        // Try comparing with base64
        const digestBase64 = Buffer.from(digest, 'hex').toString('base64');
        if (digestBase64 === signature) {
          console.log('✅ Signature verified (base64 match)');
        } else {
          console.error('❌ Invalid signature (all methods failed)');
          return res.status(401).json({ error: 'Invalid signature' });
        }
      } catch (err) {
        console.error('❌ Invalid signature format');
        return res.status(401).json({ error: 'Invalid signature format' });
      }
    } else {
      console.error('❌ Invalid signature (direct comparison failed)');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const eventType = event.type; // e.g., 'payment.succeeded'
    const businessId = event.business_id;
    const timestamp = event.timestamp;
    
    console.log(`🔄 Dodo webhook event: ${eventType}`);
    console.log(`   Business ID: ${businessId}`);
    console.log(`   Timestamp: ${timestamp}`);

    // 3. Handle specific Dodo event types
    switch (eventType) {
      case 'payment.succeeded':
        await handlePaymentSucceeded(event.data);
        break;
      
      case 'subscription.created':
      case 'subscription.renewed':
        await handleSubscriptionEvent(event.data);
        break;
      
      case 'payment.failed':
        console.log('❌ Payment failed:', event.data.payment_id);
        await handlePaymentFailed(event.data);
        break;
        
      case 'subscription.cancelled':
        console.log('📅 Subscription cancelled:', event.data.subscription_id);
        await handleSubscriptionCancelled(event.data);
        break;
      
      case 'subscription.expired':
        console.log('📅 Subscription expired:', event.data.subscription_id);
        await handleSubscriptionExpired(event.data);
        break;
      
      // Add more Dodo-specific event types as needed
      case 'refund.created':
        console.log('💸 Refund created:', event.data.payment_id);
        await handleRefundCreated(event.data);
        break;
      
      default:
        console.log(`ℹ️ Unhandled webhook event: ${eventType}`);
    }

    res.status(200).json({ 
      success: true, 
      received: true,
      eventType,
      businessId,
      timestamp 
    });
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: error.message,
      success: false 
    });
  }
}

async function handlePaymentSucceeded(data) {
  const paymentId = data.payment_id;
  const invoiceId = data.invoice_id;
  const checkoutSessionId = data.checkout_session_id;
  const customerEmail = data.customer?.email;
  const customerName = data.customer?.name;
  const customerId = data.customer?.customer_id;
  const userId = data.metadata?.user_id || data.customer?.metadata?.user_id;
  
  console.log(`💰 Payment succeeded:`);
  console.log(`   - Payment ID: ${paymentId}`);
  console.log(`   - Invoice ID: ${invoiceId}`);
  console.log(`   - Customer: ${customerName} (${customerEmail})`);
  console.log(`   - Customer ID: ${customerId}`);
  console.log(`   - User ID from metadata: ${userId || 'not provided'}`);
  console.log(`   - Amount: $${(data.total_amount / 100).toFixed(2)} ${data.currency}`);
  console.log(`   - Status: ${data.status}`);
  
  const items = data.product_cart || [];
  let totalCredits = 0;
  let coverArtCredits = 0;
  let lyricVideoCredits = 0;

  for (const item of items) {
    const productId = item.product_id;
    const quantity = item.quantity || 1;
    const credits = getCreditsForVariant(productId);
    
    // Log product details for debugging
    console.log(`📦 Product: ${productId}, Quantity: ${quantity}, Credits: ${credits * quantity}`);
    
    // Determine credit type based on product ID
    if (productId.includes('cover') || productId.includes('art') || 
        productId.includes('prod_') || productId.startsWith('pdt_cover')) {
      coverArtCredits += credits * quantity;
    } else if (productId.includes('video') || productId.includes('lyric')) {
      lyricVideoCredits += credits * quantity;
    } else {
      // Default to cover art credits if we can't determine
      coverArtCredits += credits * quantity;
    }
    
    totalCredits += credits * quantity;
  }

  console.log(`💰 Total credits breakdown:`);
  console.log(`   - Cover Art: ${coverArtCredits}`);
  console.log(`   - Lyric Video: ${lyricVideoCredits}`);
  console.log(`   - Total: ${totalCredits}`);

  if (customerEmail && totalCredits > 0) {
    await addCreditsToUser(
      customerEmail, 
      coverArtCredits, 
      lyricVideoCredits, 
      paymentId, 
      userId,
      invoiceId,
      checkoutSessionId,
      customerId
    );
  } else {
    console.warn(`⚠️ No email or zero credits - Email: ${customerEmail}, Credits: ${totalCredits}`);
  }
}

async function handleSubscriptionEvent(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  const status = data.status;
  const productId = data.product_id;
  const userId = data.metadata?.user_id || data.customer?.metadata?.user_id;
  
  console.log(`📅 Subscription event:`);
  console.log(`   - Subscription ID: ${subscriptionId}`);
  console.log(`   - Status: ${status}`);
  console.log(`   - Product: ${productId}`);
  console.log(`   - Customer: ${customerEmail}`);

  if (status === 'active') {
    const monthlyCredits = getCreditsForVariant(productId);
    let coverArtCredits = 0;
    let lyricVideoCredits = 0;
    
    if (productId.includes('cover') || productId.includes('art') || 
        productId.includes('prod_') || productId.startsWith('pdt_cover')) {
      coverArtCredits = monthlyCredits;
    } else if (productId.includes('video') || productId.includes('lyric')) {
      lyricVideoCredits = monthlyCredits;
    } else {
      coverArtCredits = monthlyCredits;
    }
    
    if (customerEmail && monthlyCredits > 0) {
      await updateUserSubscription(
        customerEmail, 
        productId, 
        coverArtCredits, 
        lyricVideoCredits, 
        subscriptionId, 
        userId
      );
    }
  }
}

async function handlePaymentFailed(data) {
  const paymentId = data.payment_id;
  const customerEmail = data.customer?.email;
  const errorMessage = data.error_message;
  const errorCode = data.error_code;
  
  console.log(`❌ Payment failed:`);
  console.log(`   - Payment ID: ${paymentId}`);
  console.log(`   - Customer: ${customerEmail}`);
  console.log(`   - Error: ${errorCode} - ${errorMessage}`);
  
  // Log failed payment to Firestore
  try {
    if (isFirebaseAvailable()) {
      const failedPaymentRef = doc(collection(db, 'failed_payments'));
      await setDoc(failedPaymentRef, {
        paymentId,
        email: customerEmail,
        errorCode,
        errorMessage,
        amount: data.total_amount,
        currency: data.currency,
        date: serverTimestamp(),
        data: data // Store the full data for debugging
      });
      console.log(`📝 Logged failed payment for ${paymentId}`);
    }
  } catch (error) {
    console.error('❌ Error logging failed payment:', error.message);
  }
}

async function handleSubscriptionCancelled(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  const userId = data.metadata?.user_id || data.customer?.metadata?.user_id;
  
  console.log(`📅 Subscription cancelled: ${subscriptionId} for ${customerEmail}`);
  
  try {
    if (!isFirebaseAvailable()) {
      console.error('❌ Firebase not available for updating subscription');
      return;
    }

    let userDocId = userId;

    if (!userDocId && customerEmail) {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', customerEmail.toLowerCase()));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        userDocId = querySnapshot.docs[0].id;
      }
    }
    
    if (userDocId) {
      const userRef = doc(db, 'users', userDocId);
      await updateDoc(userRef, {
        subscriptionStatus: 'cancelled',
        updatedAt: serverTimestamp(),
        subscriptionCancelledAt: serverTimestamp()
      });
      console.log(`✅ Updated subscription status to cancelled for user ${userDocId}`);
    } else {
      console.warn(`⚠️ User not found for cancelled subscription: ${customerEmail}`);
    }
  } catch (error) {
    console.error('❌ Error handling subscription cancellation:', error.message);
  }
}

async function handleSubscriptionExpired(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  const userId = data.metadata?.user_id || data.customer?.metadata?.user_id;
  
  console.log(`📅 Subscription expired: ${subscriptionId} for ${customerEmail}`);
  
  try {
    if (!isFirebaseAvailable()) {
      console.error('❌ Firebase not available for updating subscription');
      return;
    }

    let userDocId = userId;

    if (!userDocId && customerEmail) {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', customerEmail.toLowerCase()));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        userDocId = querySnapshot.docs[0].id;
      }
    }
    
    if (userDocId) {
      const userRef = doc(db, 'users', userDocId);
      await updateDoc(userRef, {
        subscriptionStatus: 'expired',
        updatedAt: serverTimestamp()
      });
      console.log(`✅ Updated subscription status to expired for user ${userDocId}`);
    } else {
      console.warn(`⚠️ User not found for expired subscription: ${customerEmail}`);
    }
  } catch (error) {
    console.error('❌ Error handling subscription expiration:', error.message);
  }
}

async function handleRefundCreated(data) {
  const paymentId = data.payment_id;
  const refundAmount = data.refund_amount;
  const customerEmail = data.customer?.email;
  
  console.log(`💸 Refund created: ${refundAmount} for payment ${paymentId}, customer ${customerEmail}`);
  
  // You might want to deduct credits when a refund is issued
  // This is a placeholder - implement based on your business logic
}

function getCreditsForVariant(productId) {
  // Map Dodo Product IDs to credit amounts
  // Based on your example: product_id is "pdt_e9mUw084cWnu0tz"
  // You need to map your actual product IDs from Dodo dashboard
  
  const creditMap = {
    // Example from your webhook - adjust based on your actual products
    'pdt_e9mUw084cWnu0tz': 10, // Example product
    
    // Cover Art Packs (example - replace with your actual product IDs)
    'pdt_cover_starter': 10,
    'pdt_cover_creator': 25,
    'pdt_cover_pro': 100,
    
    // Lyric Video Packs (example - replace with your actual product IDs)
    'pdt_video_30s': 1,
    'pdt_video_3pack_30s': 3,
    'pdt_video_full': 2,
    'pdt_video_3pack_full': 6,
    'pdt_video_10pack_full': 20,
    
    // Subscription Plans (example)
    'pdt_sub_basic_monthly': 10,
    'pdt_sub_creator_monthly': 25,
    'pdt_sub_pro_monthly': 100,
    
    // Add more product IDs from your Dodo dashboard
  };
  
  const credits = creditMap[productId] || 0;
  
  if (credits === 0) {
    console.warn(`⚠️ Unknown product ID: ${productId} - defaulting to 0 credits`);
    // Log this to identify missing product mappings
    try {
      if (isFirebaseAvailable()) {
        const unknownProductRef = doc(collection(db, 'unknown_products'));
        setDoc(unknownProductRef, {
          productId,
          date: serverTimestamp(),
          note: 'Unknown product in webhook'
        });
      }
    } catch (err) {
      // Silent fail - just for logging
    }
  }
  
  return credits;
}

async function addCreditsToUser(email, coverArtCredits, lyricVideoCredits, paymentId, userIdFromMeta, invoiceId, checkoutSessionId, customerId) {
  try {
    if (!isFirebaseAvailable()) {
      console.error('❌ Firebase not available for adding credits');
      return;
    }

    let userDocId = userIdFromMeta;

    // Fallback: Find user by email if userId wasn't in metadata
    if (!userDocId) {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', email.toLowerCase()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        console.warn(`⚠️ User not found for email: ${email}`);
        
        // Optionally create a new user record
        // This depends on your business logic
        return;
      }
      userDocId = querySnapshot.docs[0].id;
    }
    
    const userRef = doc(db, 'users', userDocId);
    
    // Prepare update data
    const updateData = {
      updatedAt: serverTimestamp(),
      lastTransaction: {
        paymentId,
        invoiceId,
        checkoutSessionId,
        customerId,
        creditsAdded: coverArtCredits + lyricVideoCredits,
        date: serverTimestamp(),
        type: 'purchase'
      }
    };
    
    // Add cover art credits if any
    if (coverArtCredits > 0) {
      updateData.points = increment(coverArtCredits);
    }
    
    // Add lyric video credits if any
    if (lyricVideoCredits > 0) {
      updateData.lyricVideoCredits = increment(lyricVideoCredits);
    }
    
    await updateDoc(userRef, updateData);
    
    // Record transaction for cover art
    if (coverArtCredits > 0) {
      const transactionRef = doc(collection(db, 'credit_transactions'));
      await setDoc(transactionRef, {
        userId: userDocId,
        paymentId,
        invoiceId,
        type: 'purchase',
        creditType: 'coverArt',
        amount: coverArtCredits,
        status: 'completed',
        date: serverTimestamp(),
        email
      });
    }
    
    // Record transaction for lyric video
    if (lyricVideoCredits > 0) {
      const transactionRef = doc(collection(db, 'credit_transactions'));
      await setDoc(transactionRef, {
        userId: userDocId,
        paymentId,
        invoiceId,
        type: 'purchase',
        creditType: 'lyricVideo',
        amount: lyricVideoCredits,
        status: 'completed',
        date: serverTimestamp(),
        email
      });
    }
    
    console.log(`✅ Added credits to user ${userDocId} (${email}):`);
    console.log(`   - Cover Art: ${coverArtCredits}`);
    console.log(`   - Lyric Video: ${lyricVideoCredits}`);
    console.log(`   - Payment ID: ${paymentId}`);
  } catch (error) {
    console.error('❌ Error adding credits:', error.message);
    console.error('❌ Error stack:', error.stack);
  }
}

async function updateUserSubscription(email, productId, coverArtCredits, lyricVideoCredits, subscriptionId, userIdFromMeta) {
  try {
    if (!isFirebaseAvailable()) {
      console.error('❌ Firebase not available for updating subscription');
      return;
    }

    let userDocId = userIdFromMeta;

    if (!userDocId) {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', email.toLowerCase()));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        console.warn(`⚠️ User not found for subscription: ${email}`);
        return;
      }
      userDocId = querySnapshot.docs[0].id;
    }
    
    const userRef = doc(db, 'users', userDocId);
    const updateData = {
      subscriptionVariant: productId,
      subscriptionId,
      subscriptionStatus: 'active',
      subscriptionStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    // Add credit fields only if they have values
    if (coverArtCredits > 0) {
      updateData.monthlyCoverArtCredits = coverArtCredits;
      // Also add initial credits
      updateData.points = increment(coverArtCredits);
    }
    if (lyricVideoCredits > 0) {
      updateData.monthlyLyricVideoCredits = lyricVideoCredits;
      updateData.lyricVideoCredits = increment(lyricVideoCredits);
    }
    
    await updateDoc(userRef, updateData);
    
    console.log(`✅ Updated subscription for user ${userDocId}:`);
    console.log(`   - Product: ${productId}`);
    console.log(`   - Subscription ID: ${subscriptionId}`);
    console.log(`   - Cover Art Credits: ${coverArtCredits}/month`);
    console.log(`   - Lyric Video Credits: ${lyricVideoCredits}/month`);
  } catch (error) {
    console.error('❌ Error updating subscription:', error.message);
    console.error('❌ Error stack:', error.stack);
  }
}

// ==================== TEST ENDPOINTS & STANDALONE SERVER ====================

// Check if this is being run as a standalone server
const isStandalone = process.argv[1] && process.argv[1].includes('dodo-webhook.js');

if (isStandalone) {
  import('express').then(expressModule => {
    const express = expressModule.default;
    const app = express();
    
    // For webhook route, we need raw body for signature verification
    const rawBodyParser = express.raw({ type: 'application/json' });
    // For other routes, use JSON parsing
    app.use('/api', express.json());
    
    // Test endpoint to simulate Dodo webhook (for testing without actual Dodo)
    app.post('/api/test-webhook', rawBodyParser, async (req, res) => {
      try {
        const testData = {
          business_id: "bus_P3SXLcppjXgagmHS",
          data: {
            billing: {
              city: "New York",
              country: "US",
              state: "New York",
              street: "New York, New York",
              zipcode: "0"
            },
            brand_id: "bus_P3SXLcppjXgagmHS",
            business_id: "bus_P3SXLcppjXgagmHS",
            card_issuing_country: "GB",
            card_last_four: "4242",
            card_network: "VISA",
            card_type: "CREDIT",
            checkout_session_id: "cks_stst1231",
            created_at: "2025-08-04T05:30:31.152232Z",
            currency: "USD",
            customer: {
              customer_id: "cus_8VbC6JDZzPEqfB",
              email: "test@example.com",
              metadata: { user_id: "test123" },
              name: "Test user",
              phone_number: "+15555550100"
            },
            digital_products_delivered: false,
            discount_id: null,
            disputes: [],
            error_code: null,
            error_message: null,
            invoice_id: "inv_2IsUnWGtRKFLxk7xAQeyt",
            metadata: { user_id: "test123" },
            payload_type: "Payment",
            payment_id: "pay_2IjeQm4hqU6RA4Z4kwDee",
            payment_link: "https://test.checkout.dodopayments.com/cbq",
            payment_method: "card",
            payment_method_type: null,
            product_cart: [
              {
                product_id: "pdt_cover_starter",
                quantity: 1
              }
            ],
            refunds: [],
            settlement_amount: 400,
            settlement_currency: "USD",
            settlement_tax: null,
            status: "succeeded",
            subscription_id: null,
            tax: null,
            total_amount: 400,
            updated_at: null
          },
          timestamp: "2025-08-04T05:30:45.182629Z",
          type: "payment.succeeded"
        };

        // Generate signature for test
        const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
        if (!secret) {
          return res.status(500).json({ error: 'DODO_PAYMENTS_WEBHOOK_KEY not set' });
        }

        const rawBody = JSON.stringify(testData);
        const hmac = crypto.createHmac('sha256', secret);
        const digest = hmac.update(rawBody).digest('hex');
        
        console.log('🧪 Test webhook signature:', digest);
        
        // Call the actual handler with test data
        const mockReq = {
          method: 'POST',
          headers: {
            'dodo-signature': digest
          },
          body: testData
        };
        
        const mockRes = {
          status: (code) => ({
            json: (data) => {
              console.log('🧪 Test webhook response:', { code, data });
              return res.status(code).json(data);
            }
          })
        };

        // Temporarily enable body parser for this test
        const originalConfig = module.exports.config;
        module.exports.config = { api: { bodyParser: true } };
        
        await handler(mockReq, mockRes);
        
        module.exports.config = originalConfig;
        
      } catch (error) {
        console.error('❌ Test webhook error:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Webhook endpoint for standalone server
    app.post('/webhook', rawBodyParser, async (req, res) => {
      try {
        const rawBody = req.body.toString('utf8');
        
        // Parse headers from request
        const headers = {};
        Object.keys(req.headers).forEach(key => {
          headers[key.toLowerCase()] = req.headers[key];
        });
        
        // Create mock request object similar to Next.js API route
        const mockReq = {
          method: 'POST',
          headers: headers,
          body: JSON.parse(rawBody)
        };
        
        // Create mock response object
        const mockRes = {
          status: function(code) {
            this.statusCode = code;
            return this;
          },
          json: function(data) {
            console.log(`📤 Response (${this.statusCode}):`, data);
            res.status(this.statusCode || 200).json(data);
          }
        };
        
        // Call the handler
        await handler(mockReq, mockRes);
        
      } catch (error) {
        console.error('❌ Standalone webhook error:', error);
        res.status(500).json({ 
          error: error.message,
          success: false 
        });
      }
    });
    
    // Add credit management endpoints for testing
    app.post('/api/check-credits', async (req, res) => {
      try {
        const { userId, type } = req.body;
        
        if (!userId || !type) {
          return res.status(400).json({ error: 'Missing required fields' });
        }
        
        if (!isFirebaseAvailable()) {
          return res.status(503).json({ error: 'Firebase not available' });
        }
        
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
          console.log(`🔍 Check credits - User ${userId} not found`);
          return res.status(404).json({ error: 'User not found' });
        }
        
        const userData = userDoc.data();
        let credits = 0;
        
        if (type === 'coverArt') {
          credits = userData.points || 0;
        } else if (type === 'lyricVideo') {
          credits = userData.lyricVideoCredits || 0;
        }
        
        console.log(`💰 Check credits - User: ${userId}, Type: ${type}, Credits: ${credits}`);
        
        res.json({
          success: true,
          credits,
          type,
          userId
        });
      } catch (error) {
        console.error('❌ Error checking credits:', error.message);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Test signature verification endpoint
    app.post('/api/verify-signature', express.json(), (req, res) => {
      const { payload, signature } = req.body;
      const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
      
      if (!secret) {
        return res.status(500).json({ error: 'DODO_PAYMENTS_WEBHOOK_KEY not set' });
      }
      
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(JSON.stringify(payload)).digest('hex');
      
      res.json({
        expectedSignature: digest,
        receivedSignature: signature,
        match: digest === signature,
        details: {
          payloadKeys: Object.keys(payload),
          signatureLength: signature?.length,
          digestLength: digest.length
        }
      });
    });
    
    const PORT = process.env.PORT || 3002;
    app.listen(PORT, () => {
      console.log(`🧪 Dodo Webhook test server running on port ${PORT}`);
      console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook`);
      console.log(`🔗 Test endpoints:`);
      console.log(`   - POST /api/test-webhook - Simulate Dodo webhook`);
      console.log(`   - POST /api/verify-signature - Test signature verification`);
      console.log(`   - POST /api/check-credits - Check user credits`);
    });
  }).catch(err => {
    console.error('❌ Failed to load express:', err);
  });
}