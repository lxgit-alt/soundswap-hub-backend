// lemon-webhook.js - Dodo Payments Webhook Handler
import express from 'express';
import crypto from 'crypto';

// Initialize Firebase
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, updateDoc, increment, query, where, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

const router = express.Router();

// Initialize Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Collections
const PENDING_CREDIT_TRANSACTIONS_COLLECTION = 'pending_credit_transactions';
const CREDIT_TRANSACTIONS_COLLECTION = 'credit_transactions';
const PURCHASES_COLLECTION = 'purchases';
const SUBSCRIPTION_TRANSACTIONS_COLLECTION = 'subscription_transactions';
const PENDING_SUBSCRIPTIONS_COLLECTION = 'pending_subscriptions';
const USERS_COLLECTION = 'users';

// ==================== DODO PAYMENTS WEBHOOK HANDLER ====================

// Check if Firebase is available
const isFirebaseAvailable = () => {
  return !!db;
};

// Middleware to get raw body for signature verification
const rawBodyMiddleware = (req, res, next) => {
  req.rawBody = '';
  req.setEncoding('utf8');

  req.on('data', (chunk) => {
    req.rawBody += chunk;
  });

  req.on('end', () => {
    next();
  });
};

// Apply middleware to webhook endpoint
router.post('/', rawBodyMiddleware, async (req, res) => {
  try {
    console.log('🔄 Payment webhook received');
    
    // 1. Get raw body for signature verification
    const rawBody = req.rawBody;
    
    if (!rawBody || rawBody.length === 0) {
      console.error('❌ Empty request body');
      return res.status(400).json({ error: 'Empty request body' });
    }
    
    console.log('📦 Raw body received, length:', rawBody.length);
    console.log('📦 Raw body first 500 chars:', rawBody.substring(0, 500));

    // 2. Verify Dodo Payments Webhook Signature (Standard Webhooks format)
    const webhookId = req.headers['webhook-id'];
    const webhookTimestamp = req.headers['webhook-timestamp'];
    const webhookSignature = req.headers['webhook-signature'];
    const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;

    if (!secret) {
      console.error('❌ DODO_PAYMENTS_WEBHOOK_KEY not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      console.error('❌ Missing webhook headers:', {
        webhookId: !!webhookId,
        webhookTimestamp: !!webhookTimestamp,
        webhookSignature: !!webhookSignature
      });
      console.log('📋 All headers:', JSON.stringify(req.headers, null, 2));
      return res.status(401).json({ error: 'Missing webhook headers' });
    }

    // Extract just the signature part (remove "v1," prefix)
    if (!webhookSignature.startsWith('v1,')) {
      console.error('❌ Invalid signature format');
      return res.status(401).json({ error: 'Invalid signature format' });
    }

    const signatureParts = webhookSignature.split(',');
    const signature = signatureParts[1]; // The part after "v1,"

    // Build the signed content according to Standard Webhooks spec
    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;

    // Compute the expected signature
    const hmac = crypto.createHmac('sha256', secret);
    const expectedSignature = hmac.update(signedContent).digest('base64'); // Note: base64, not hex

    console.log('🔍 Signature Debug:');
    console.log('   - Webhook ID:', webhookId);
    console.log('   - Timestamp:', webhookTimestamp);
    console.log('   - Raw body length:', rawBody.length);
    console.log('   - Expected (first 20 chars):', expectedSignature.substring(0, 20));
    console.log('   - Received (first 20 chars):', signature.substring(0, 20));

    // Use constant-time comparison for security
    const expectedBuffer = Buffer.from(expectedSignature, 'base64');
    const receivedBuffer = Buffer.from(signature, 'base64');

    if (expectedBuffer.length !== receivedBuffer.length) {
      console.error('❌ Signature length mismatch');
      console.error('   Expected length:', expectedBuffer.length);
      console.error('   Received length:', receivedBuffer.length);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      console.error('❌ Signature verification failed');
      console.error('   Hint: Check your DODO_PAYMENTS_WEBHOOK_KEY environment variable');
      console.error('   Hint: Make sure you\'re using the correct secret from Dodo dashboard');
      console.error('   Hint: Check if webhook timestamp is within tolerance');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    console.log('✅ Signature verified successfully');

    // 3. Parse the event data
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('❌ Failed to parse webhook body:', parseError.message);
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    const eventType = event.type; // e.g., 'payment.succeeded'
    console.log(`🔄 Dodo webhook event: ${eventType}`);
    console.log('📋 Event data:', JSON.stringify(event.data, null, 2));

    // 4. Handle specific Dodo event types
    switch (eventType) {
      case 'payment.succeeded':
        await handlePaymentSucceeded(event.data);
        break;
      
      case 'subscription.created':
      case 'subscription.renewed':
        await handleSubscriptionEvent(event.data);
        break;
      
      case 'subscription.cancelled':
        console.log(`📅 Subscription cancelled: ${event.data.subscription_id}`);
        await handleSubscriptionCancelled(event.data);
        break;
      
      case 'payment.failed':
        console.log(`❌ Payment failed: ${event.data.transaction_id}`);
        await handlePaymentFailed(event.data);
        break;
      
      case 'subscription.payment_failed':
        console.log(`❌ Subscription payment failed: ${event.data.subscription_id}`);
        await handleSubscriptionPaymentFailed(event.data);
        break;
      
      default:
        console.log(`ℹ️ Unhandled webhook event: ${eventType}`);
    }

    res.status(200).json({ 
      success: true, 
      received: true,
      eventType,
      message: 'Webhook processed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    console.error(error.stack);
    res.status(500).json({ 
      error: error.message,
      success: false,
      details: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== EVENT HANDLERS ====================

async function handlePaymentSucceeded(data) {
  const transactionId = data.transaction_id;
  const customerEmail = data.customer?.email;
  const customerId = data.customer?.id;
  // Metadata is passed from your create-checkout.js
  const userId = data.metadata?.user_id; 
  const amount = data.amount / 100; // Convert from cents to dollars
  
  console.log(`💰 Payment succeeded - Transaction: ${transactionId}, Amount: $${amount}, Email: ${customerEmail}, Customer ID: ${customerId}, UserID: ${userId || 'not provided'}`);
  
  // Dodo provides products in a product_cart array
  const items = data.product_cart || [];
  let totalCredits = 0;
  let coverArtCredits = 0;
  let lyricVideoCredits = 0;

  for (const item of items) {
    const productId = item.product_id;
    const quantity = item.quantity || 1;
    const credits = getCreditsForVariant(productId);
    
    // Determine credit type based on product
    if (productId.startsWith('prod_') || productId.includes('cover') || productId.includes('art')) {
      coverArtCredits += credits * quantity;
    } else if (productId.includes('video')) {
      lyricVideoCredits += credits * quantity;
    }
    
    totalCredits += credits * quantity;
    
    console.log(`📦 Cart item - Product: ${productId}, Quantity: ${quantity}, Credits: ${credits * quantity}`);
  }

  console.log(`💰 Total credits breakdown - Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}, Total: ${totalCredits}`);

  if (customerEmail && totalCredits > 0) {
    // We prioritize using userId from metadata if it exists
    await addCreditsToUser(customerEmail, coverArtCredits, lyricVideoCredits, transactionId, userId);
  } else {
    console.warn(`⚠️ No email or zero credits - Email: ${customerEmail}, Credits: ${totalCredits}`);
  }
}

async function handleSubscriptionEvent(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  const customerId = data.customer?.id;
  const status = data.status;
  const productId = data.product_id;
  const userId = data.metadata?.user_id;
  
  console.log(`📅 Subscription event - ID: ${subscriptionId}, Status: ${status}, Product: ${productId}, Customer: ${customerEmail} (${customerId})`);

  if (status === 'active' || status === 'renewed') {
    const monthlyCredits = getCreditsForVariant(productId);
    let coverArtCredits = 0;
    let lyricVideoCredits = 0;
    
    // Determine credit type
    if (productId.startsWith('prod_') || productId.includes('cover') || productId.includes('art')) {
      coverArtCredits = monthlyCredits;
    } else if (productId.includes('video')) {
      lyricVideoCredits = monthlyCredits;
    }
    
    if (customerEmail && monthlyCredits > 0) {
      await updateUserSubscription(customerEmail, productId, coverArtCredits, lyricVideoCredits, subscriptionId, userId);
    }
  }
}

async function handleSubscriptionCancelled(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  const userId = data.metadata?.user_id;
  
  console.log(`📅 Subscription cancelled - ID: ${subscriptionId}, Email: ${customerEmail}`);
  
  try {
    let userDocId = userId;
    
    // Find user by email if userId wasn't in metadata
    if (!userDocId && customerEmail) {
      const usersRef = collection(db, USERS_COLLECTION);
      const q = query(usersRef, where('email', '==', customerEmail.toLowerCase()));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        userDocId = querySnapshot.docs[0].id;
      }
    }
    
    if (userDocId) {
      const userRef = doc(db, USERS_COLLECTION, userDocId);
      await updateDoc(userRef, {
        subscriptionStatus: 'cancelled',
        subscriptionUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      console.log(`✅ Updated subscription status to cancelled for user ${userDocId}`);
    }
  } catch (error) {
    console.error('❌ Error handling subscription cancellation:', error.message);
  }
}

async function handlePaymentFailed(data) {
  const transactionId = data.transaction_id;
  const customerEmail = data.customer?.email;
  
  console.log(`❌ Payment failed - Transaction: ${transactionId}, Email: ${customerEmail}`);
  
  // Record failed payment for analytics
  try {
    const failedRef = doc(collection(db, 'failed_payments'));
    await setDoc(failedRef, {
      transactionId,
      customerEmail,
      amount: data.amount / 100,
      reason: data.failure_reason || 'unknown',
      date: serverTimestamp(),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Error recording failed payment:', error.message);
  }
}

async function handleSubscriptionPaymentFailed(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  
  console.log(`❌ Subscription payment failed - ID: ${subscriptionId}, Email: ${customerEmail}`);
  
  try {
    const failedRef = doc(collection(db, 'failed_subscription_payments'));
    await setDoc(failedRef, {
      subscriptionId,
      customerEmail,
      date: serverTimestamp(),
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Error recording failed subscription payment:', error.message);
  }
}

// ==================== CREDIT MAPPING FUNCTIONS ====================

function getCreditsForVariant(productId) {
  // Map your Dodo Product IDs to credit amounts
  const creditMap = {
    // Cover Art Packs
    'prod_starter': 10,     // Starter Pack - 10 credits
    'prod_creator': 25,     // Creator Pack - 25 credits
    'prod_pro': 100,        // Professional Pack - 100 credits
    
    // Lyric Video Packs
    'video_30s': 1,         // Single 30s video = 1 credit
    'video_3pack_30s': 3,   // 3-pack 30s videos = 3 credits
    'video_full': 2,        // Full video = 2 credits
    'video_3pack_full': 6,  // 3-pack full videos = 6 credits
    'video_10pack_full': 20, // 10-pack full videos = 20 credits
    
    // Subscription Plans (monthly)
    'sub_basic_monthly': 10,    // Basic Monthly - 10 cover art credits/month
    'sub_creator_monthly': 25,  // Creator Monthly - 25 cover art credits/month
    'sub_pro_monthly': 100,     // Pro Monthly - 100 cover art credits/month
    
    // Add more product IDs as needed
    'price_1': 10,  // Example Stripe price ID format
    'price_2': 25,
    'price_3': 100,
  };
  
  // Fallback: check if productId contains keywords
  if (!creditMap[productId]) {
    if (productId.includes('starter') || productId.includes('basic')) {
      return 10;
    } else if (productId.includes('creator') || productId.includes('pro')) {
      return 25;
    } else if (productId.includes('enterprise') || productId.includes('ultimate')) {
      return 100;
    }
  }
  
  return creditMap[productId] || 0;
}

// ==================== CREDIT MANAGEMENT FUNCTIONS ====================

async function addCreditsToUser(email, coverArtCredits, lyricVideoCredits, orderId, userIdFromMeta) {
  try {
    if (!isFirebaseAvailable()) {
      console.error('❌ Firebase not available for adding credits');
      return;
    }

    let userDocId = userIdFromMeta;
    let userEmail = email;

    // Fallback: Find user by email if userId wasn't in metadata
    if (!userDocId) {
      const usersRef = collection(db, USERS_COLLECTION);
      const q = query(usersRef, where('email', '==', email.toLowerCase()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        console.warn(`⚠️ User not found for email: ${email}, creating transaction record only`);
        
        // Create a transaction record even if user doesn't exist yet
        // This can be reconciled later when user signs up
        const transactionRef = doc(collection(db, PENDING_CREDIT_TRANSACTIONS_COLLECTION));
        await setDoc(transactionRef, {
          email: email.toLowerCase(),
          orderId,
          coverArtCredits,
          lyricVideoCredits,
          totalCredits: coverArtCredits + lyricVideoCredits,
          status: 'pending_user_creation',
          date: serverTimestamp(),
          type: 'purchase',
          timestamp: Date.now()
        });
        
        console.log(`📝 Created pending transaction for email: ${email}`);
        return;
      }
      userDocId = querySnapshot.docs[0].id;
      userEmail = querySnapshot.docs[0].data().email || email;
    }
    
    const userRef = doc(db, USERS_COLLECTION, userDocId);
    
    // Prepare update data
    const updateData = {
      updatedAt: serverTimestamp(),
      lastTransaction: {
        orderId,
        creditsAdded: coverArtCredits + lyricVideoCredits,
        date: serverTimestamp(),
        type: 'purchase'
      }
    };
    
    // Add cover art credits if any
    if (coverArtCredits > 0) {
      updateData.points = increment(coverArtCredits);
      // Also update total lifetime credits
      updateData.totalCreditsEarned = increment(coverArtCredits);
    }
    
    // Add lyric video credits if any
    if (lyricVideoCredits > 0) {
      updateData.lyricVideoCredits = increment(lyricVideoCredits);
      updateData.totalLyricVideoCredits = increment(lyricVideoCredits);
    }
    
    await updateDoc(userRef, updateData);
    
    // Record transaction for cover art
    if (coverArtCredits > 0) {
      const transactionRef = doc(collection(db, CREDIT_TRANSACTIONS_COLLECTION));
      await setDoc(transactionRef, {
        userId: userDocId,
        userEmail: userEmail.toLowerCase(),
        orderId,
        type: 'purchase',
        creditType: 'coverArt',
        amount: coverArtCredits,
        status: 'completed',
        date: serverTimestamp(),
        timestamp: Date.now()
      });
    }
    
    // Record transaction for lyric video
    if (lyricVideoCredits > 0) {
      const transactionRef = doc(collection(db, CREDIT_TRANSACTIONS_COLLECTION));
      await setDoc(transactionRef, {
        userId: userDocId,
        userEmail: userEmail.toLowerCase(),
        orderId,
        type: 'purchase',
        creditType: 'lyricVideo',
        amount: lyricVideoCredits,
        status: 'completed',
        date: serverTimestamp(),
        timestamp: Date.now()
      });
    }
    
    // Also create a purchase record
    const purchaseRef = doc(collection(db, PURCHASES_COLLECTION));
    await setDoc(purchaseRef, {
      userId: userDocId,
      userEmail: userEmail.toLowerCase(),
      orderId,
      coverArtCredits,
      lyricVideoCredits,
      totalCredits: coverArtCredits + lyricVideoCredits,
      date: serverTimestamp(),
      status: 'completed',
      type: 'one_time'
    });
    
    console.log(`✅ Added credits to user ${userDocId} (${userEmail}) - Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}`);
  } catch (error) {
    console.error('❌ Error adding credits:', error.message);
    console.error(error.stack);
  }
}

async function updateUserSubscription(email, productId, coverArtCredits, lyricVideoCredits, subscriptionId, userIdFromMeta) {
  try {
    if (!isFirebaseAvailable()) {
      console.error('❌ Firebase not available for updating subscription');
      return;
    }

    let userDocId = userIdFromMeta;
    let userEmail = email;

    if (!userDocId) {
      const usersRef = collection(db, USERS_COLLECTION);
      const q = query(usersRef, where('email', '==', email.toLowerCase()));
      const querySnapshot = await getDocs(q);
      if (querySnapshot.empty) {
        console.warn(`⚠️ User not found for subscription: ${email}`);
        
        // Create pending subscription record
        const pendingRef = doc(collection(db, PENDING_SUBSCRIPTIONS_COLLECTION));
        await setDoc(pendingRef, {
          email: email.toLowerCase(),
          subscriptionId,
          productId,
          coverArtCredits,
          lyricVideoCredits,
          status: 'pending_user_creation',
          date: serverTimestamp(),
          timestamp: Date.now()
        });
        
        return;
      }
      userDocId = querySnapshot.docs[0].id;
      userEmail = querySnapshot.docs[0].data().email || email;
    }
    
    const userRef = doc(db, USERS_COLLECTION, userDocId);
    
    // Get current subscription data to preserve monthly credits if needed
    const userDoc = await getDocs(doc(db, USERS_COLLECTION, userDocId));
    const userData = userDoc.exists() ? userDoc.data() : {};
    
    const updateData = {
      subscriptionVariant: productId,
      subscriptionId,
      subscriptionStatus: 'active',
      subscriptionUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    // Add credit fields only if they have values
    if (coverArtCredits > 0) {
      updateData.monthlyCoverArtCredits = coverArtCredits;
      // Add the monthly credits to their balance
      updateData.points = increment(coverArtCredits);
      updateData.totalCreditsEarned = increment(coverArtCredits);
    }
    
    if (lyricVideoCredits > 0) {
      updateData.monthlyLyricVideoCredits = lyricVideoCredits;
      updateData.lyricVideoCredits = increment(lyricVideoCredits);
      updateData.totalLyricVideoCredits = increment(lyricVideoCredits);
    }
    
    await updateDoc(userRef, updateData);
    
    // Record subscription transaction
    const transactionRef = doc(collection(db, SUBSCRIPTION_TRANSACTIONS_COLLECTION));
    await setDoc(transactionRef, {
      userId: userDocId,
      userEmail: userEmail.toLowerCase(),
      subscriptionId,
      productId,
      coverArtCredits,
      lyricVideoCredits,
      date: serverTimestamp(),
      type: 'subscription_renewal',
      status: 'completed',
      timestamp: Date.now()
    });
    
    console.log(`✅ Updated subscription for user ${userDocId} (${userEmail}) - Product: ${productId}, Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}`);
  } catch (error) {
    console.error('❌ Error updating subscription:', error.message);
    console.error(error.stack);
  }
}

// ==================== TEST ENDPOINTS ====================

// Test endpoint to verify webhook is working
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Lemon Webhook endpoint is working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    firebase: isFirebaseAvailable() ? 'connected' : 'disconnected',
    dodoKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'missing'
  });
});

// Simulate webhook for testing
router.post('/simulate', async (req, res) => {
  try {
    const { eventType, data } = req.body;
    
    if (!eventType) {
      return res.status(400).json({
        success: false,
        message: 'eventType is required'
      });
    }
    
    console.log(`🔄 Simulating webhook event: ${eventType}`);
    
    // Handle simulated event
    switch (eventType) {
      case 'payment.succeeded':
        await handlePaymentSucceeded(data || {
          transaction_id: 'test_' + Date.now(),
          customer: { email: 'test@example.com' },
          amount: 1000,
          product_cart: [
            { product_id: 'prod_starter', quantity: 1 }
          ],
          metadata: { user_id: 'test_user' }
        });
        break;
      
      case 'subscription.created':
        await handleSubscriptionEvent(data || {
          subscription_id: 'test_sub_' + Date.now(),
          customer: { email: 'test@example.com' },
          status: 'active',
          product_id: 'sub_basic_monthly',
          metadata: { user_id: 'test_user' }
        });
        break;
      
      default:
        console.log(`ℹ️ Simulated event: ${eventType}`);
    }
    
    res.json({
      success: true,
      message: `Simulated ${eventType} event`,
      eventType,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in simulation:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get webhook status and configuration
router.get('/status', (req, res) => {
  res.json({
    success: true,
    service: 'dodo-payments-webhook',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    configuration: {
      firebase: isFirebaseAvailable() ? 'connected' : 'disconnected',
      dodoWebhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'configured' : 'missing',
      firebaseProject: process.env.FIREBASE_PROJECT_ID || 'not set',
      environment: process.env.NODE_ENV || 'development'
    },
    endpoints: {
      POST: '/api/lemon-webhook - Main webhook endpoint',
      GET: '/api/lemon-webhook/test - Test endpoint',
      POST: '/api/lemon-webhook/simulate - Simulate webhook events',
      GET: '/api/lemon-webhook/status - Get status info'
    },
    handledEvents: [
      'payment.succeeded',
      'subscription.created',
      'subscription.renewed',
      'subscription.cancelled',
      'payment.failed',
      'subscription.payment_failed'
    ],
    creditMapping: {
      'prod_starter': 10,
      'prod_creator': 25,
      'prod_pro': 100,
      'sub_basic_monthly': 10,
      'sub_creator_monthly': 25,
      'sub_pro_monthly': 100
    }
  });
});

console.log('🚀 Dodo Payments Webhook Handler Initialized');
console.log(`✅ Firebase: ${isFirebaseAvailable() ? 'Connected' : 'Disconnected'}`);
console.log(`✅ Dodo Webhook Key: ${process.env.DODO_PAYMENTS_WEBHOOK_KEY ? 'Configured' : 'Missing'}`);
console.log(`📊 Collections configured:`);
console.log(`   - ${USERS_COLLECTION}`);
console.log(`   - ${CREDIT_TRANSACTIONS_COLLECTION}`);
console.log(`   - ${PURCHASES_COLLECTION}`);
console.log(`   - ${SUBSCRIPTION_TRANSACTIONS_COLLECTION}`);
console.log(`✅ Ready to process webhooks at /api/lemon-webhook`);

export default router;