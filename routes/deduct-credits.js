import express from 'express';
const router = express.Router();

console.log('[INFO] 💳 Deduct-Credits & Check-Credits API Initialized');

// ==================== LAZY LOADING CONFIGURATION ====================

let isFirebaseLoaded = false;
let auth = null;
let firestore = null;

// ==================== LAZY LOAD HELPER ====================

const loadFirebaseAdmin = async () => {
  if (!isFirebaseLoaded) {
    console.log('[INFO] 🔥 Firebase: Lazy loading Firebase Admin');
    try {
      const adminModule = await import('firebase-admin');
      const admin = adminModule.default;
      
      if (admin.apps.length > 0) {
        auth = admin.auth();
        firestore = admin.firestore();
        console.log('[INFO] 🔥 Firebase: Using existing Firebase Admin instance');
      } else {
        console.log('[INFO] 🔥 Firebase: Initializing Firebase Admin');
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
          auth = admin.auth();
          firestore = admin.firestore();
          console.log('[INFO] 🔥 Firebase: Initialized successfully');
        } else {
          console.error('[ERROR] ❌ Firebase credentials incomplete');
          auth = null;
          firestore = null;
        }
      }
      
      isFirebaseLoaded = true;
      console.log('[INFO] 🔥 Firebase: Admin loaded successfully');
    } catch (error) {
      console.error('[ERROR] ❌ Failed to load Firebase Admin:', error.message);
      // Mock for testing
      auth = {
        verifyIdToken: async (token) => {
          console.log('[TEST] 🔐 Mock token verification for testing');
          return { 
            uid: token === 'test-token' ? 'test-user-id' : 'mock-user-id',
            email: 'test@example.com'
          };
        }
      };
      
      // Add mock firestore for testing
      firestore = {
        collection: (name) => ({
          doc: (id) => ({
            get: async () => ({
              exists: true,
              data: () => ({
                coverArtCredits: 10,
                lyricVideoCredits: 5,
                creditsHistory: []
              })
            })
          })
        }),
        doc: (path) => ({
          get: async () => ({
            exists: true,
            data: () => ({
              coverArtCredits: 10,
              lyricVideoCredits: 5,
              creditsHistory: []
            })
          })
        }),
        // Mock FieldValue
        FieldValue: {
          serverTimestamp: () => new Date()
        }
      };
      
      // Mock transaction
      firestore.runTransaction = async (callback) => {
        console.log('[TEST] 🔄 Mock Firestore transaction');
        
        const mockTransaction = {
          get: async (docRef) => {
            console.log(`[TEST] 📄 Mock get for: ${docRef}`);
            return {
              exists: true,
              data: () => ({
                coverArtCredits: 10,
                lyricVideoCredits: 5,
                creditsHistory: []
              })
            };
          },
          update: (docRef, data) => {
            console.log(`[TEST] 📝 Mock update for ${docRef}:`, data);
          },
          set: (docRef, data) => {
            console.log(`[TEST] 📝 Mock set for ${docRef}:`, data);
          }
        };
        
        try {
          const result = await callback(mockTransaction);
          console.log('[TEST] ✅ Transaction completed successfully');
          return result;
        } catch (error) {
          console.error('[TEST] ❌ Transaction failed:', error.message);
          throw error;
        }
      };
      
      isFirebaseLoaded = true;
      console.log('[INFO] 🔥 Firebase: Using mock auth and firestore for testing');
    }
  }
  return { auth, firestore };
};

// ==================== CREDIT CHECK ENDPOINT ====================
router.post('/check', async (req, res) => {
  console.log('[INFO] 🔍 Checking credits request received');
  
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[WARN] ⚠️ No authorization header provided for credit check');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - No token provided' 
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    console.log('[DEBUG] Credit check token received, length:', idToken.length);
    
    // Verify Firebase ID token
    let decodedToken;
    try {
      const { auth } = await loadFirebaseAdmin();
      console.log('[DEBUG] Auth loaded for credit check, verifying token...');
      decodedToken = await auth.verifyIdToken(idToken);
      console.log('[DEBUG] Credit check token verified, user:', decodedToken.uid);
    } catch (error) {
      console.error('[ERROR] ❌ Credit check token verification error:', error.message);
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - Invalid token' 
      });
    }

    const { uid } = decodedToken;
    const { creditType, returnAllCredits = false } = req.body;
    
    console.log('[DEBUG] Credit check params:', { uid, creditType, returnAllCredits });
    
    if (!returnAllCredits && !creditType) {
      console.log('[ERROR] ❌ Missing creditType in credit check request');
      return res.status(400).json({ 
        success: false,
        error: 'Missing creditType parameter (or set returnAllCredits to true)' 
      });
    }

    console.log(`[INFO] 🔍 Checking credits - User: ${uid}, Type: ${creditType || 'all'}`);

    const { firestore: fs } = await loadFirebaseAdmin();
    
    if (!fs) {
      console.error('[ERROR] ❌ Firestore not initialized for credit check');
      return res.status(500).json({ 
        success: false,
        error: 'Database not available'
      });
    }
    
    try {
      console.log(`[DEBUG] Credit check: Getting user document - users/${uid}`);
      const userRef = fs.doc(`users/${uid}`);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        console.error(`[ERROR] ❌ User ${uid} not found in Firestore during credit check`);
        return res.status(404).json({ 
          success: false,
          error: 'User profile not found'
        });
      }
      
      const userData = userDoc.data();
      const timestamp = new Date().toISOString();
      
      // If returnAllCredits is true, return all credit types
      if (returnAllCredits) {
        console.log('[INFO] 🔍 Returning all credit types for user');
        const allCredits = {
          coverArtCredits: userData.coverArtCredits || 0,
          lyricVideoCredits: userData.lyricVideoCredits || 0,
          totalCredits: (userData.coverArtCredits || 0) + (userData.lyricVideoCredits || 0),
          userId: uid,
          timestamp: timestamp
        };
        
        console.log(`[INFO] ✅ User ${uid} credits:`, allCredits);
        
        return res.status(200).json({
          success: true,
          credits: allCredits,
          message: 'All credit types retrieved successfully'
        });
      }
      
      // Otherwise, return specific credit type
      const creditField = `${creditType}Credits`;
      
      if (!userData.hasOwnProperty(creditField)) {
        console.error(`[ERROR] ❌ Invalid credit type: ${creditType}`);
        return res.status(400).json({ 
          success: false,
          error: `Invalid credit type: ${creditType}. Valid types: coverArt, lyricVideo`
        });
      }
      
      const currentCredits = userData[creditField] || 0;
      
      console.log(`[INFO] ✅ User ${uid} has ${currentCredits} ${creditType} credits`);
      
      return res.status(200).json({
        success: true,
        credits: currentCredits,
        creditType: creditType,
        userId: uid,
        timestamp: timestamp
      });
      
    } catch (error) {
      console.error('[ERROR] ❌ Error during credit check:', error.message);
      console.error('[ERROR] Stack trace:', error.stack);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to check credits',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
  } catch (error) {
    console.error('[ERROR] ❌ Credit check endpoint error:', error.message);
    console.error('[ERROR] Stack trace:', error.stack);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== CREDIT DEDUCTION ENDPOINT ====================
router.post('/', async (req, res) => {
  console.log('[INFO] 🔄 Deducting credits request received');
  console.log('[DEBUG] Request headers:', req.headers ? 'Present' : 'Missing');
  console.log('[DEBUG] Request body:', req.body);
  
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[WARN] ⚠️ No authorization header provided');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - No token provided' 
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    console.log('[DEBUG] Token received, length:', idToken.length);
    
    // Verify Firebase ID token
    let decodedToken;
    try {
      const { auth } = await loadFirebaseAdmin();
      console.log('[DEBUG] Auth loaded, verifying token...');
      decodedToken = await auth.verifyIdToken(idToken);
      console.log('[DEBUG] Token verified, user:', decodedToken.uid);
    } catch (error) {
      console.error('[ERROR] ❌ Token verification error:', error.message);
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - Invalid token' 
      });
    }

    const { uid } = decodedToken;
    const { creditType, amount = 1 } = req.body;
    
    console.log('[DEBUG] Request params:', { uid, creditType, amount });
    
    if (!creditType) {
      console.log('[ERROR] ❌ Missing creditType in request');
      return res.status(400).json({ 
        success: false,
        error: 'Missing creditType parameter' 
      });
    }

    console.log(`[INFO] 🔄 Processing credit deduction - User: ${uid}, Type: ${creditType}, Amount: ${amount}`);

    const { firestore: fs } = await loadFirebaseAdmin();
    
    if (!fs) {
      console.error('[ERROR] ❌ Firestore not initialized');
      return res.status(500).json({ 
        success: false,
        error: 'Database not available'
      });
    }
    
    // Use Firestore transaction for atomic operations
    try {
      console.log('[DEBUG] Starting Firestore transaction...');
      
      const result = await fs.runTransaction(async (transaction) => {
        console.log(`[DEBUG] Transaction started, getting user: users/${uid}`);
        
        const userRef = fs.doc(`users/${uid}`);
        const userDoc = await transaction.get(userRef);
        
        if (!userDoc.exists) {
          console.error(`[ERROR] ❌ User ${uid} not found in Firestore`);
          throw new Error('User profile not found');
        }
        
        const userData = userDoc.data();
        const creditField = `${creditType}Credits`;
        
        // Validate credit type
        if (!userData.hasOwnProperty(creditField)) {
          console.error(`[ERROR] ❌ Invalid credit type: ${creditType}`);
          throw new Error(`Invalid credit type: ${creditType}. Valid types: coverArt, lyricVideo`);
        }
        
        const currentCredits = userData[creditField] || 0;
        
        console.log(`[INFO] 🔄 Current ${creditType} credits for user ${uid}: ${currentCredits}`);
        
        // Check if user has enough credits
        if (currentCredits < amount) {
          console.log(`[ERROR] ❌ Insufficient credits - Required: ${amount}, Available: ${currentCredits}`);
          throw new Error(`Insufficient ${creditType} credits. Required: ${amount}, Available: ${currentCredits}`);
        }
        
        const newCredits = currentCredits - amount;
        
        console.log(`[DEBUG] Updating credits from ${currentCredits} to ${newCredits}`);
        
        // Update user credits
        transaction.update(userRef, {
          [creditField]: newCredits,
          updatedAt: fs.FieldValue.serverTimestamp(),
          lastActive: fs.FieldValue.serverTimestamp()
        });
        
        // Create transaction record
        const transactionRef = fs.collection('credit_transactions').doc();
        console.log(`[DEBUG] Creating transaction record at: credit_transactions/${transactionRef.id}`);
        
        transaction.set(transactionRef, {
          userId: uid,
          type: 'credit_deduction',
          creditType: creditType,
          amount: amount,
          previousBalance: currentCredits,
          newBalance: newCredits,
          reason: 'generation',
          date: fs.FieldValue.serverTimestamp(),
          timestamp: new Date().toISOString()
        });
        
        // Update credits history
        const historyUpdate = {
          date: fs.FieldValue.serverTimestamp(),
          type: 'credit_deduction',
          creditType: creditType,
          amount: amount,
          source: 'generation',
          reason: 'generation',
          remaining: newCredits
        };
        
        const currentHistory = userData.creditsHistory || [];
        const updatedHistory = [...currentHistory.slice(-49), historyUpdate];
        
        transaction.update(userRef, {
          creditsHistory: updatedHistory
        });
        
        console.log(`✅ Deducted ${amount} ${creditType} credits from user ${uid}. New total: ${newCredits}`);
        
        return {
          success: true,
          previousBalance: currentCredits,
          newBalance: newCredits,
          remainingCredits: newCredits,
          creditType: creditType,
          amountDeducted: amount
        };
      });
      
      console.log('[INFO] ✅ Transaction completed successfully');
      return res.status(200).json(result);
      
    } catch (error) {
      console.error('[ERROR] ❌ Transaction error:', error.message);
      console.error('[ERROR] Stack trace:', error.stack);
      
      if (error.message.includes('Insufficient')) {
        return res.status(402).json({ 
          success: false,
          error: error.message,
          message: 'Insufficient credits. Please purchase more credits.'
        });
      }
      
      if (error.message.includes('Invalid credit type')) {
        return res.status(400).json({ 
          success: false,
          error: error.message
        });
      }
      
      return res.status(500).json({ 
        success: false,
        error: error.message || 'Transaction failed'
      });
    }
    
  } catch (error) {
    console.error('[ERROR] ❌ Credit deduction error:', error.message);
    console.error('[ERROR] Stack trace:', error.stack);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== GET USER CREDITS (GET ENDPOINT) ====================
router.get('/', async (req, res) => {
  console.log('[INFO] 🔍 GET request for user credits');
  
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[WARN] ⚠️ No authorization header provided for GET request');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - No token provided' 
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    // Verify Firebase ID token
    let decodedToken;
    try {
      const { auth } = await loadFirebaseAdmin();
      decodedToken = await auth.verifyIdToken(idToken);
      console.log('[DEBUG] GET token verified, user:', decodedToken.uid);
    } catch (error) {
      console.error('[ERROR] ❌ GET token verification error:', error.message);
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized - Invalid token' 
      });
    }

    const { uid } = decodedToken;
    const creditType = req.query.creditType;
    const returnAll = req.query.returnAll === 'true';
    
    console.log('[DEBUG] GET query params:', { creditType, returnAll });

    const { firestore: fs } = await loadFirebaseAdmin();
    
    if (!fs) {
      throw new Error('Firestore not initialized');
    }
    
    try {
      const userRef = fs.doc(`users/${uid}`);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        throw new Error('User profile not found');
      }
      
      const userData = userDoc.data();
      const timestamp = new Date().toISOString();
      
      // If returnAll is true, return all credit types
      if (returnAll) {
        const allCredits = {
          coverArtCredits: userData.coverArtCredits || 0,
          lyricVideoCredits: userData.lyricVideoCredits || 0,
          totalCredits: (userData.coverArtCredits || 0) + (userData.lyricVideoCredits || 0),
          userId: uid,
          timestamp: timestamp
        };
        
        console.log(`[INFO] ✅ GET: User ${uid} all credits retrieved`);
        
        return res.status(200).json({
          success: true,
          credits: allCredits,
          message: 'All credit types retrieved successfully'
        });
      }
      
      // Otherwise, return specific credit type
      if (!creditType) {
        return res.status(400).json({ 
          success: false,
          error: 'Missing creditType query parameter (or set returnAll=true)'
        });
      }
      
      const creditField = `${creditType}Credits`;
      
      if (!userData.hasOwnProperty(creditField)) {
        return res.status(400).json({ 
          success: false,
          error: `Invalid credit type: ${creditType}. Valid types: coverArt, lyricVideo`
        });
      }
      
      const currentCredits = userData[creditField] || 0;
      
      console.log(`[INFO] ✅ GET: User ${uid} has ${currentCredits} ${creditType} credits`);
      
      return res.status(200).json({
        success: true,
        credits: currentCredits,
        creditType: creditType,
        userId: uid,
        timestamp: timestamp
      });
      
    } catch (error) {
      console.error('[ERROR] ❌ Error in GET credits:', error.message);
      return res.status(500).json({ 
        success: false,
        error: error.message || 'Failed to retrieve credits'
      });
    }
    
  } catch (error) {
    console.error('[ERROR] ❌ GET credits endpoint error:', error.message);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error'
    });
  }
});

// ==================== HEALTH CHECK ENDPOINT ====================
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Credit Management API is operational',
    endpoints: {
      'POST /': 'Deduct credits from user account',
      'POST /check': 'Check credit balance (POST version)',
      'GET /': 'Check credit balance (GET version)',
      'GET /health': 'API health check',
      'GET /test': 'Test endpoint'
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== TEST ENDPOINT ====================
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Deduct-Credits & Check-Credits API is working',
    endpoints: {
      'POST /': 'Deduct credits',
      'POST /check': 'Check credit balance (POST)',
      'GET /': 'Check credit balance (GET)',
      'POST /check with returnAllCredits: true': 'Get all credit types',
      'GET /?returnAll=true': 'Get all credit types (GET)',
      'GET /health': 'Health check',
      'GET /test': 'Test endpoint'
    },
    timestamp: new Date().toISOString()
  });
});

console.log('[INFO] ✅ Deduct-Credits & Check-Credits API Ready');
console.log('[INFO] 🔄 Endpoint: POST /api/deduct-credits');
console.log('[INFO] 🔍 Check Endpoint (POST): POST /api/deduct-credits/check');
console.log('[INFO] 🔍 Check Endpoint (GET): GET /api/deduct-credits');
console.log('[INFO] 🏥 Health Check: GET /api/deduct-credits/health');

export default router;