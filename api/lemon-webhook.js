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
    const signature = req.headers['webhook-signature'] || req.headers['x-dodo-signature'];
    const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    
    if (!secret) {
      console.error('❌ DODO_PAYMENTS_WEBHOOK_KEY not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Dodo uses HMAC SHA256 verification with the raw body
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(rawBody).digest('hex');
    
    // For debugging - remove in production
    console.log(`🔑 Expected signature: ${digest}`);
    console.log(`🔑 Received signature: ${signature}`);
    
    if (!signature) {
      console.error('❌ No signature provided in headers');
      return res.status(401).json({ error: 'No signature provided' });
    }
    
    // Compare signatures securely (constant-time comparison)
    const expectedSignatureBuffer = Buffer.from(digest, 'hex');
    const receivedSignatureBuffer = Buffer.from(signature, 'hex');
    
    if (!crypto.timingSafeEqual(expectedSignatureBuffer, receivedSignatureBuffer)) {
      console.error('❌ Invalid Dodo signature');
      console.error('❌ Raw body (first 500 chars):', rawBody.substring(0, 500));
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const eventType = event.type; // e.g., 'payment.succeeded'
    console.log(`🔄 Dodo webhook event: ${eventType}`);

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
        console.log('❌ Payment failed:', event.data);
        await handlePaymentFailed(event.data);
        break;
        
      case 'subscription.cancelled':
        console.log('📅 Subscription cancelled:', event.data);
        await handleSubscriptionCancelled(event.data);
        break;
      
      case 'subscription.expired':
        console.log('📅 Subscription expired:', event.data);
        await handleSubscriptionExpired(event.data);
        break;
      
      default:
        console.log(`ℹ️ Unhandled webhook event: ${eventType}`);
    }

    res.status(200).json({ 
      success: true, 
      received: true,
      eventType 
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
  const transactionId = data.transaction_id;
  const customerEmail = data.customer?.email;
  const userId = data.metadata?.user_id; 
  
  console.log(`💰 Payment succeeded - Transaction: ${transactionId}, Email: ${customerEmail}, UserID: ${userId || 'not provided'}`);
  
  const items = data.product_cart || [];
  let totalCredits = 0;
  let coverArtCredits = 0;
  let lyricVideoCredits = 0;

  for (const item of items) {
    const productId = item.product_id;
    const quantity = item.quantity || 1;
    const credits = getCreditsForVariant(productId);
    
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
    await addCreditsToUser(customerEmail, coverArtCredits, lyricVideoCredits, transactionId, userId);
  } else {
    console.warn(`⚠️ No email or zero credits - Email: ${customerEmail}, Credits: ${totalCredits}`);
  }
}

async function handleSubscriptionEvent(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  const status = data.status;
  const productId = data.product_id;
  const userId = data.metadata?.user_id;
  
  console.log(`📅 Subscription event - ID: ${subscriptionId}, Status: ${status}, Product: ${productId}`);

  if (status === 'active') {
    const monthlyCredits = getCreditsForVariant(productId);
    let coverArtCredits = 0;
    let lyricVideoCredits = 0;
    
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

async function handlePaymentFailed(data) {
  const transactionId = data.transaction_id;
  const customerEmail = data.customer?.email;
  const reason = data.failure_reason;
  
  console.log(`❌ Payment failed - Transaction: ${transactionId}, Email: ${customerEmail}, Reason: ${reason}`);
  
  // You might want to log this to a separate collection for failed payments
  try {
    if (isFirebaseAvailable()) {
      const failedPaymentRef = doc(collection(db, 'failed_payments'));
      await setDoc(failedPaymentRef, {
        transactionId,
        email: customerEmail,
        reason,
        data: data,
        date: serverTimestamp()
      });
      console.log(`📝 Logged failed payment for transaction ${transactionId}`);
    }
  } catch (error) {
    console.error('❌ Error logging failed payment:', error.message);
  }
}

async function handleSubscriptionCancelled(data) {
  const subscriptionId = data.subscription_id;
  const customerEmail = data.customer?.email;
  const userId = data.metadata?.user_id;
  
  console.log(`📅 Subscription cancelled - ID: ${subscriptionId}, Email: ${customerEmail}`);
  
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
  const userId = data.metadata?.user_id;
  
  console.log(`📅 Subscription expired - ID: ${subscriptionId}, Email: ${customerEmail}`);
  
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
  };
  
  return creditMap[productId] || 0;
}

async function addCreditsToUser(email, coverArtCredits, lyricVideoCredits, orderId, userIdFromMeta) {
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
        return;
      }
      userDocId = querySnapshot.docs[0].id;
    }
    
    const userRef = doc(db, 'users', userDocId);
    
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
        orderId,
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
        orderId,
        type: 'purchase',
        creditType: 'lyricVideo',
        amount: lyricVideoCredits,
        status: 'completed',
        date: serverTimestamp(),
        email
      });
    }
    
    console.log(`✅ Added credits to user ${userDocId} - Cover Art: ${coverArtCredits}, Lyric Video: ${lyricVideoCredits}`);
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
    }
    if (lyricVideoCredits > 0) {
      updateData.monthlyLyricVideoCredits = lyricVideoCredits;
    }
    
    await updateDoc(userRef, updateData);
    
    console.log(`✅ Updated subscription for user ${userDocId} - Product: ${productId}`);
  } catch (error) {
    console.error('❌ Error updating subscription:', error.message);
    console.error('❌ Error stack:', error.stack);
  }
}

// ==================== TEST ENDPOINTS ====================
// These endpoints are for testing and manual operations

// Check if this is being run as a standalone server
const isStandalone = process.argv[1] && process.argv[1].includes('lemon-webhook.js');

if (isStandalone) {
  import('express').then(expressModule => {
    const express = expressModule.default;
    const app = express();
    
    // For webhook route, we need raw body for signature verification
    app.use('/webhook', express.raw({ type: 'application/json' }));
    // For other routes, use JSON parsing
    app.use('/api', express.json());
    
    // Webhook endpoint
    app.post('/webhook', async (req, res) => {
      try {
        const rawBody = req.body.toString('utf8');
        const event = JSON.parse(rawBody);
        
        console.log('🔄 Standalone webhook received');
        
        // Verify signature (same logic as above)
        const signature = req.headers['webhook-signature'] || req.headers['x-dodo-signature'];
        const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
        
        if (!secret) {
          console.error('❌ DODO_PAYMENTS_WEBHOOK_KEY not set');
          return res.status(500).json({ error: 'Server configuration error' });
        }

        const hmac = crypto.createHmac('sha256', secret);
        const digest = hmac.update(rawBody).digest('hex');
        
        console.log(`🔑 Expected signature: ${digest}`);
        console.log(`🔑 Received signature: ${signature}`);
        
        if (!signature) {
          console.error('❌ No signature provided in headers');
          return res.status(401).json({ error: 'No signature provided' });
        }
        
        const expectedSignatureBuffer = Buffer.from(digest, 'hex');
        const receivedSignatureBuffer = Buffer.from(signature, 'hex');
        
        if (!crypto.timingSafeEqual(expectedSignatureBuffer, receivedSignatureBuffer)) {
          console.error('❌ Invalid Dodo signature in standalone server');
          return res.status(401).json({ error: 'Invalid signature' });
        }
        
        const eventType = event.type;
        
        switch (eventType) {
          case 'payment.succeeded':
            await handlePaymentSucceeded(event.data);
            break;
          
          case 'subscription.created':
          case 'subscription.renewed':
            await handleSubscriptionEvent(event.data);
            break;
          
          default:
            console.log(`ℹ️ Unhandled webhook event: ${eventType}`);
        }

        res.status(200).json({ 
          success: true, 
          received: true,
          eventType 
        });
      } catch (error) {
        console.error('❌ Standalone webhook error:', error.message);
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
    
    app.post('/api/deduct-credits', async (req, res) => {
      try {
        const { userId, type, amount = 1, reason = 'generation' } = req.body;
        
        if (!userId || !type) {
          return res.status(400).json({ error: 'Missing required fields' });
        }
        
        if (!isFirebaseAvailable()) {
          return res.status(503).json({ error: 'Firebase not available' });
        }
        
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
          console.log(`🔍 Deduct credits - User ${userId} not found`);
          return res.status(404).json({ error: 'User not found' });
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
          return res.status(400).json({ error: 'Invalid credit type' });
        }
        
        if (currentCredits < amount) {
          console.log(`❌ Insufficient credits - User: ${userId}, Type: ${type}, Available: ${currentCredits}, Required: ${amount}`);
          return res.status(400).json({ 
            error: 'Insufficient credits',
            required: amount,
            available: currentCredits
          });
        }
        
        const newCredits = currentCredits - amount;
        
        await userRef.update({
          [fieldToUpdate]: newCredits,
          updatedAt: serverTimestamp()
        });
        
        console.log(`💰 Deduct credits - User: ${userId}, Type: ${type}, Deducted: ${amount}, Remaining: ${newCredits}`);
        
        res.json({
          success: true,
          type,
          deducted: amount,
          remaining: newCredits
        });
      } catch (error) {
        console.error('❌ Error deducting credits:', error.message);
        res.status(500).json({ error: error.message });
      }
    });
    
    // Test endpoint to verify webhook signature
    app.post('/api/test-signature', (req, res) => {
      const { rawBody, signature } = req.body;
      const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
      
      if (!secret) {
        return res.status(500).json({ error: 'DODO_PAYMENTS_WEBHOOK_KEY not set' });
      }
      
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(rawBody).digest('hex');
      
      res.json({
        expectedSignature: digest,
        receivedSignature: signature,
        match: digest === signature
      });
    });
    
    const PORT = process.env.PORT || 3002;
    app.listen(PORT, () => {
      console.log(`🧪 Webhook test server running on port ${PORT}`);
      console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook`);
      console.log(`🔗 Test endpoints available at /api/*`);
    });
  }).catch(err => {
    console.error('❌ Failed to load express:', err);
  });
}