import { db } from '../../utils/firebaseAdmin.js';
import { 
  doc, updateDoc, increment, collection, 
  query, where, getDocs, serverTimestamp, setDoc 
} from 'firebase/firestore';
import crypto from 'crypto';

// Check if Firebase is available (for logging purposes only)
const isFirebaseAvailable = () => {
  return !!db;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Payment webhook received');
    
    // 1. Verify Dodo Payments Webhook Signature
    const signature = req.headers['webhook-signature'];
    const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    
    if (!secret) {
      console.error('❌ DODO_PAYMENTS_WEBHOOK_KEY not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Dodo uses a raw body HMAC SHA256 verification
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(JSON.stringify(req.body)).digest('hex');
    
    if (signature !== digest) {
      console.error('❌ Invalid Dodo signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    const eventType = event.type; // e.g., 'payment.succeeded'
    console.log(`🔄 Dodo webhook event: ${eventType}`);

    // 2. Handle specific Dodo event types
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
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ 
      error: error.message,
      success: false 
    });
  }
}

async function handlePaymentSucceeded(data) {
  const transactionId = data.transaction_id;
  const customerEmail = data.customer?.email;
  // Metadata is passed from your create-checkout.js
  const userId = data.metadata?.user_id; 
  
  console.log(`💰 Payment succeeded - Transaction: ${transactionId}, Email: ${customerEmail}, UserID: ${userId || 'not provided'}`);
  
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
  const status = data.status;
  const productId = data.product_id;
  const userId = data.metadata?.user_id;
  
  console.log(`📅 Subscription event - ID: ${subscriptionId}, Status: ${status}, Product: ${productId}`);

  if (status === 'active') {
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
  }
}

// ==================== CREDIT MANAGEMENT ENDPOINTS ====================
// These endpoints are for testing and manual operations

// Check if this is being run as a standalone server
const isStandalone = process.argv[1] && process.argv[1].includes('lemon-webhook.js');

if (isStandalone) {
  import('express').then(expressModule => {
    const express = expressModule.default;
    const app = express();
    
    app.use(express.json());
    
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
    
    const PORT = process.env.PORT || 3002;
    app.listen(PORT, () => {
      console.log(`🧪 Webhook test server running on port ${PORT}`);
    });
  });
}