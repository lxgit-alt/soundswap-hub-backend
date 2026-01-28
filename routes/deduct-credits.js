// routes/deduct-credits.js
import express from 'express';
import admin from 'firebase-admin';

const router = express.Router();

console.log('[INFO] 🚀 Credit Management API Initialized - Original Route');

// ==================== INITIALIZATION ====================

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      })
    });
    console.log('[INFO] 🔥 Firebase Admin initialized successfully');
  } catch (error) {
    console.error('[ERROR] ❌ Failed to initialize Firebase Admin:', error);
  }
}

const db = admin.firestore();

// ==================== HELPER FUNCTIONS ====================

// Get user credits
const getUserCredits = async (userId) => {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return null;
    }
    
    const userData = userDoc.data();
    return {
      coverArt: userData.coverArtCredits || 0,
      lyricVideos: {
        seconds: userData.lyricVideoCredits?.seconds || 0,
        fullVideos: userData.lyricVideoCredits?.fullVideos || 0
      },
      trialUsed: userData.trialUsed || false,
      lastActive: userData.lastActive?.toDate() || null
    };
  } catch (error) {
    console.error('[ERROR] ❌ Error getting user credits:', error);
    throw error;
  }
};

// Update user credits
const updateUserCredits = async (userId, updates) => {
  try {
    const userRef = db.collection('users').doc(userId);
    await userRef.set(updates, { merge: true });
    return true;
  } catch (error) {
    console.error('[ERROR] ❌ Error updating user credits:', error);
    throw error;
  }
};

// Record transaction
const recordTransaction = async (userId, transactionData) => {
  try {
    const transactionRef = db.collection('credit_transactions').doc();
    await transactionRef.set({
      userId,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      date: new Date().toISOString(),
      ...transactionData
    });
    return transactionRef.id;
  } catch (error) {
    console.error('[ERROR] ❌ Error recording transaction:', error);
    throw error;
  }
};

// ==================== API ENDPOINTS ====================

// GET /api/deduct-credits/credits/:userId - Get user credits
// Note: Your frontend calls /api/deduct-credits/credits/:userId=${userId}
// So we need to handle both :userId parameter and query string
router.get('/credits/:userId?', async (req, res) => {
  try {
    let userId = req.params.userId;
    
    // If userId is in the format ":userId=actualUserId", extract it
    if (userId && userId.startsWith(':userId=')) {
      userId = userId.split('=')[1];
    }
    
    // Also check query parameters
    if (!userId && req.query.userId) {
      userId = req.query.userId;
    }
    
    console.log(`[INFO] 📊 Getting credits for user: ${userId}`);
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }
    
    const credits = await getUserCredits(userId);
    
    if (!credits) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    return res.json({
      success: true,
      credits,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[ERROR] ❌ Error getting credits:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// POST /api/deduct-credits/credits/:userId - Check and deduct credits
// Note: Your frontend calls this endpoint with userId in the body
router.post('/credits/:userId?', async (req, res) => {
  try {
    let userId = req.params.userId;
    const { userId: bodyUserId, service, cost = 1, ...options } = req.body;
    
    // Priority: body userId > param userId
    userId = bodyUserId || userId;
    
    console.log(`[INFO] 🔄 Processing credits for user: ${userId}, service: ${service}, cost: ${cost}`);
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }
    
    // Get user data
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const userData = userDoc.data();
    
    // Handle trial credits request
    if (service === 'trial' || options.serviceType === 'trial') {
      // Check if trial already used
      if (userData.trialUsed) {
        return res.status(400).json({
          success: false,
          error: 'Trial already used',
          message: 'You have already claimed your trial credits'
        });
      }
      
      // Add trial credits based on service type
      const serviceType = options.serviceType || 'coverArt';
      let trialCredits = {};
      
      if (serviceType === 'coverArt') {
        // 3 free cover art generations
        const currentCoverArt = userData.coverArtCredits || 0;
        const newCoverArt = currentCoverArt + 3;
        
        trialCredits = {
          coverArtCredits: newCoverArt,
          trialUsed: true,
          trialClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        // Record transaction
        await recordTransaction(userId, {
          type: 'trial_credits',
          creditType: 'coverArt',
          amount: 3,
          previousBalance: currentCoverArt,
          newBalance: newCoverArt,
          serviceType: 'coverArt'
        });
        
        const newBalance = await getUserCredits(userId);
        
        return res.json({
          success: true,
          hasEnoughCredits: true,
          trialCredits: 3,
          newBalance,
          credits: newBalance,
          message: '🎉 Trial credits added! You received 3 free cover art credits.'
        });
        
      } else if (serviceType === 'lyricVideos') {
        // 1 free 30-second lyric video
        const currentSeconds = userData.lyricVideoCredits?.seconds || 0;
        const newSeconds = currentSeconds + 1;
        
        trialCredits = {
          lyricVideoCredits: {
            seconds: newSeconds,
            fullVideos: userData.lyricVideoCredits?.fullVideos || 0
          },
          trialUsed: true,
          trialClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        // Record transaction
        await recordTransaction(userId, {
          type: 'trial_credits',
          creditType: 'lyricVideo',
          amount: 1,
          previousBalance: currentSeconds,
          newBalance: newSeconds,
          serviceType: 'lyricVideos',
          videoType: 'seconds'
        });
        
        const newBalance = await getUserCredits(userId);
        
        return res.json({
          success: true,
          hasEnoughCredits: true,
          trialCredits: 1,
          newBalance,
          credits: newBalance,
          message: '🎉 Trial credits added! You received 1 free 30-second lyric video credit.'
        });
      }
    }
    
    // Handle credit check for service usage
    let hasEnoughCredits = false;
    let remainingCredits = null;
    
    if (service === 'coverArt') {
      const currentCredits = userData.coverArtCredits || 0;
      hasEnoughCredits = currentCredits >= cost;
      
      if (hasEnoughCredits) {
        // Deduct credits
        const newCredits = currentCredits - cost;
        await userRef.update({
          coverArtCredits: newCredits,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Record transaction
        await recordTransaction(userId, {
          type: 'credit_deduction',
          service: 'coverArt',
          creditType: 'coverArt',
          amount: cost,
          previousBalance: currentCredits,
          newBalance: newCredits,
          ...options
        });
        
        remainingCredits = {
          coverArt: newCredits,
          lyricVideos: {
            seconds: userData.lyricVideoCredits?.seconds || 0,
            fullVideos: userData.lyricVideoCredits?.fullVideos || 0
          }
        };
      }
    } else if (service === 'lyricVideos') {
      const videoType = options.videoType || 'seconds';
      const currentCredits = videoType === 'fullVideos' 
        ? userData.lyricVideoCredits?.fullVideos || 0
        : userData.lyricVideoCredits?.seconds || 0;
      
      hasEnoughCredits = currentCredits >= cost;
      
      if (hasEnoughCredits) {
        // Deduct credits
        const newCredits = currentCredits - cost;
        let updatedCredits = {
          ...userData.lyricVideoCredits
        };
        
        if (videoType === 'fullVideos') {
          updatedCredits.fullVideos = newCredits;
        } else {
          updatedCredits.seconds = newCredits;
        }
        
        await userRef.update({
          lyricVideoCredits: updatedCredits,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Record transaction
        await recordTransaction(userId, {
          type: 'credit_deduction',
          service: 'lyricVideos',
          creditType: videoType,
          amount: cost,
          previousBalance: currentCredits,
          newBalance: newCredits,
          ...options
        });
        
        remainingCredits = {
          coverArt: userData.coverArtCredits || 0,
          lyricVideos: updatedCredits
        };
      }
    }
    
    if (!hasEnoughCredits) {
      return res.json({
        success: true,
        hasEnoughCredits: false,
        error: 'Insufficient Credits',
        message: `You need ${cost} credit(s) for this service. You currently have ${
          service === 'coverArt' 
            ? (userData.coverArtCredits || 0) 
            : (options.videoType === 'fullVideos' 
                ? (userData.lyricVideoCredits?.fullVideos || 0) 
                : (userData.lyricVideoCredits?.seconds || 0))
        } credit(s).`,
        required: cost,
        available: service === 'coverArt' 
          ? (userData.coverArtCredits || 0) 
          : (options.videoType === 'fullVideos' 
              ? (userData.lyricVideoCredits?.fullVideos || 0) 
              : (userData.lyricVideoCredits?.seconds || 0))
      });
    }
    
    return res.json({
      success: true,
      hasEnoughCredits: true,
      remainingCredits,
      credits: remainingCredits,
      deducted: cost,
      message: `Successfully used ${cost} credit(s)`
    });
    
  } catch (error) {
    console.error('[ERROR] ❌ Error processing credits:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// POST /api/deduct-credits/credits - For purchase webhook to add credits
router.post('/credits', async (req, res) => {
  try {
    const { userId, packType, packId, price, credits, serviceType } = req.body;
    
    console.log(`[INFO] 🛒 Processing purchase for user: ${userId}, pack: ${packType}, credits: ${credits}`);
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }
    
    // Get user data
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const userData = userDoc.data();
    let updateData = {};
    let previousBalance = 0;
    let newBalance = 0;
    let creditType = 'coverArt';
    
    // Determine which credits to add based on serviceType
    if (serviceType === 'coverArt' || packType?.includes('cover')) {
      previousBalance = userData.coverArtCredits || 0;
      newBalance = previousBalance + parseInt(credits) || 0;
      creditType = 'coverArt';
      updateData.coverArtCredits = newBalance;
    } else if (serviceType === 'lyricVideos' || packType?.includes('video')) {
      // Determine if it's seconds or full videos
      if (packType?.includes('30s') || packType?.includes('seconds')) {
        previousBalance = userData.lyricVideoCredits?.seconds || 0;
        newBalance = previousBalance + parseInt(credits) || 0;
        creditType = 'lyricVideo_seconds';
        updateData.lyricVideoCredits = {
          ...userData.lyricVideoCredits,
          seconds: newBalance
        };
      } else {
        // Full videos
        previousBalance = userData.lyricVideoCredits?.fullVideos || 0;
        newBalance = previousBalance + parseInt(credits) || 0;
        creditType = 'lyricVideo_full';
        updateData.lyricVideoCredits = {
          ...userData.lyricVideoCredits,
          fullVideos: newBalance
        };
      }
    }
    
    // Update user
    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await userRef.update(updateData);
    
    // Record purchase transaction
    await recordTransaction(userId, {
      type: 'purchase',
      creditType: creditType.includes('lyricVideo') ? 'lyricVideo' : 'coverArt',
      amount: parseInt(credits) || 0,
      previousBalance,
      newBalance,
      packType,
      packId,
      price: parseFloat(price) || 0,
      serviceType,
      paymentStatus: 'completed'
    });
    
    // Get updated credits
    const updatedCredits = await getUserCredits(userId);
    
    // Create checkout URL (simplified - in reality this would be from  Lemon Squeezy)
    const checkoutUrl = `/checkout/session_${Date.now()}`;
    
    return res.json({
      success: true,
      url: checkoutUrl,
      message: 'Purchase processed successfully',
      credits: updatedCredits,
      addedCredits: parseInt(credits) || 0
    });
    
  } catch (error) {
    console.error('[ERROR] ❌ Error processing purchase:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ==================== ADDITIONAL ENDPOINTS FOR COMPATIBILITY ====================

// GET /api/deduct-credits/health - Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'deduct-credits',
    status: 'operational',
    endpoints: [
      'GET /api/deduct-credits/credits/:userId',
      'POST /api/deduct-credits/credits/:userId',
      'POST /api/deduct-credits/credits'
    ],
    firebase: admin.apps.length > 0 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// GET /api/deduct-credits/test - Test endpoint
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Deduct Credits API is working',
    frontendRoutes: [
      'GET /api/deduct-credits/credits/:userId=${userId}',
      'POST /api/deduct-credits/credits/:userId (for checking credits)',
      'POST /api/deduct-credits/credits/:userId (for trial credits)',
      'POST /api/deduct-credits/credits (for purchases)'
    ],
    timestamp: new Date().toISOString()
  });
});

console.log('[INFO] ✅ Original Deduct-Credits Route Ready');
console.log('[INFO] 🔥 Firebase Connection:', admin.apps.length > 0 ? 'Active' : 'Inactive');
console.log('[INFO] 🎯 Frontend-Compatible Endpoints:');
console.log('[INFO]   GET  /api/deduct-credits/credits/:userId');
console.log('[INFO]   POST /api/deduct-credits/credits/:userId');
console.log('[INFO]   POST /api/deduct-credits/credits');
console.log('[INFO]   GET  /api/deduct-credits/health');
console.log('[INFO]   GET  /api/deduct-credits/test');

export default router;