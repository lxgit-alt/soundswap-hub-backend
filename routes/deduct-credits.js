import express from 'express';
const router = express.Router();

console.log('[INFO] 💳 Deduct-Credits, Check-Credits & User API Initialized');

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
                subscription: 'premium',
                subscriptionStatus: 'active',
                subscriptionVariant: 'premium',
                subscriptionId: 'sub_123',
                monthlyCoverArtCredits: 20,
                monthlyLyricVideoCredits: 10,
                founderPoints: 100,
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
              subscription: 'premium',
              subscriptionStatus: 'active',
              subscriptionVariant: 'premium',
              subscriptionId: 'sub_123',
              monthlyCoverArtCredits: 20,
              monthlyLyricVideoCredits: 10,
              founderPoints: 100,
              creditsHistory: []
            })
          })
        }),
        // Mock FieldValue
        FieldValue: {
          serverTimestamp: () => new Date(),
          increment: (n) => n
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
                subscription: 'premium',
                subscriptionStatus: 'active',
                subscriptionVariant: 'premium',
                subscriptionId: 'sub_123',
                monthlyCoverArtCredits: 20,
                monthlyLyricVideoCredits: 10,
                founderPoints: 100,
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

// ==================== HELPER FUNCTIONS ====================

const verifyToken = async (req) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized - No token provided');
  }

  const idToken = authHeader.split('Bearer ')[1];
  const { auth } = await loadFirebaseAdmin();
  const decodedToken = await auth.verifyIdToken(idToken);
  
  return decodedToken;
};

// SIMPLE TEST ENDPOINT - No external API dependencies
router.get('/test-simple', (req, res) => {
  const endpointType = req.baseUrl.includes('ai-art') ? 'ai-art' : 'doodle-art';
  
  // Get all relevant environment variables (safely)
  const envVars = {
    // Replicate
    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN ? 
      `✓ Set (${process.env.REPLICATE_API_TOKEN.substring(0, 10)}...)` : 
      '✗ Missing',
    
    // Firebase
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '✗ Missing',
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL ? 
      `✓ Set (${process.env.FIREBASE_CLIENT_EMAIL.substring(0, 20)}...)` : 
      '✗ Missing',
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? 
      `✓ Set (${process.env.FIREBASE_PRIVATE_KEY.substring(0, 30)}...)` : 
      '✗ Missing',
    
    // App config
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || 3001,
    
    // Check if dotenv is loaded
    dotenv_loaded: !!process.env.npm_package_name
  };
  
  // Check which ones are actually set
  const checkStatus = {
    replicate: !!process.env.REPLICATE_API_TOKEN,
    firebase: !!process.env.FIREBASE_PROJECT_ID && 
              !!process.env.FIREBASE_CLIENT_EMAIL && 
              !!process.env.FIREBASE_PRIVATE_KEY,
    allRequired: !!process.env.REPLICATE_API_TOKEN && 
                 !!process.env.FIREBASE_PROJECT_ID && 
                 !!process.env.FIREBASE_CLIENT_EMAIL && 
                 !!process.env.FIREBASE_PRIVATE_KEY
  };
  
  const response = {
    success: checkStatus.allRequired,
    message: checkStatus.allRequired ? 
      `✅ ${endpointType.toUpperCase()} API configuration looks good!` : 
      `⚠️ ${endpointType.toUpperCase()} API needs configuration`,
    endpoint: endpointType,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    serverTime: new Date().toLocaleTimeString(),
    
    // Configuration status
    configStatus: {
      replicate: checkStatus.replicate ? '✅ Configured' : '❌ Missing REPLICATE_API_TOKEN',
      firebase: checkStatus.firebase ? '✅ Configured' : '❌ Missing Firebase credentials',
      overall: checkStatus.allRequired ? 'READY' : 'NEEDS_CONFIG'
    },
    
    // Environment variables (safe display)
    env: envVars,
    
    // Server info
    server: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`
      },
      uptime: `${Math.round(process.uptime())} seconds`
    },
    
    // Routes available
    routes: [
      'GET /test-simple',
      'GET /test-connection',
      'GET /health-check',
      'GET /health',
      'GET /',
      endpointType === 'doodle-art' ? 'POST /generate' : 'POST /generate-ai',
      endpointType === 'doodle-art' ? 'POST /animate' : 'POST /animate-ai'
    ],
    
    // Next steps
    nextSteps: !checkStatus.allRequired ? [
      '1. Check if .env file exists in backend directory',
      '2. Verify REPLICATE_API_TOKEN starts with r8_',
      '3. Restart the server after updating .env',
      '4. Check server logs for dotenv loading'
    ] : [
      '✅ API is ready to use!',
      `Use POST /${endpointType === 'doodle-art' ? 'generate' : 'generate-ai'} for doodle-to-art`,
      `Use POST /${endpointType === 'doodle-art' ? 'animate' : 'animate-ai'} for animations`
    ]
  };
  
  res.json(response);
});

// Also add this quick ping endpoint
router.get('/ping', (req, res) => {
  const endpointType = req.baseUrl.includes('ai-art') ? 'ai-art' : 'doodle-art';
  res.json({
    success: true,
    message: `🚀 ${endpointType.toUpperCase()} API is running!`,
    timestamp: new Date().toISOString(),
    endpoint: endpointType,
    uptime: `${Math.round(process.uptime())}s`
  });
});

// Quick health check (no external calls)
router.get('/health-check', (req, res) => {
  const endpointType = req.baseUrl.includes('ai-art') ? 'ai-art' : 'doodle-art';
  
  const health = {
    success: true,
    service: `${endpointType}-api`,
    status: 'running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    configCheck: {
      replicateToken: !!process.env.REPLICATE_API_TOKEN,
      firebaseProject: !!process.env.FIREBASE_PROJECT_ID,
      nodeVersion: process.version
    },
    endpoints: [
      '/test-connection',
      '/health-check', 
      '/health',
      endpointType === 'doodle-art' ? '/generate' : '/generate-ai',
      endpointType === 'doodle-art' ? '/animate' : '/animate-ai'
    ]
  };
  
  res.json(health);
});

// ==================== CREDIT CHECK ENDPOINT ====================
router.post('/check', async (req, res) => {
  console.log('[INFO] 🔍 Checking credits request received');
  
  try {
    const decodedToken = await verifyToken(req);
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
      error: error.message === 'Unauthorized - No token provided' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== CREDIT DEDUCTION ENDPOINT ====================
router.post('/', async (req, res) => {
  console.log('[INFO] 🔄 Deducting credits request received');
  
  try {
    const decodedToken = await verifyToken(req);
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
      error: error.message === 'Unauthorized - No token provided' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== GET USER CREDITS (GET ENDPOINT) ====================
router.get('/', async (req, res) => {
  console.log('[INFO] 🔍 GET request for user credits');
  
  try {
    const decodedToken = await verifyToken(req);
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
      error: error.message === 'Unauthorized - No token provided' ? error.message : 'Internal server error'
    });
  }
});

// ==================== GET USER CREDIT BALANCE (NEW: /api/credits/:userId) ====================
router.get('/balance/:userId', async (req, res) => {
  console.log('[INFO] 💰 Getting user credit balance');
  
  try {
    // Verify token first
    const decodedToken = await verifyToken(req);
    const requestUid = decodedToken.uid;
    const { userId } = req.params;
    
    // Optionally: Check if the requesting user has permission to view this user's credits
    // For now, we'll allow users to check their own credits
    if (requestUid !== userId) {
      console.warn(`[WARN] ⚠️ User ${requestUid} trying to access credits of user ${userId}`);
      // In production, you might want to check admin permissions here
    }
    
    console.log(`[DEBUG] Getting credit balance for user: ${userId}`);
    
    const { firestore: fs } = await loadFirebaseAdmin();
    
    if (!fs) {
      throw new Error('Firestore not initialized');
    }
    
    try {
      const userRef = fs.doc(`users/${userId}`);
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        console.error(`[ERROR] ❌ User ${userId} not found in Firestore`);
        return res.status(404).json({ 
          success: false,
          error: 'User not found',
          userId: userId
        });
      }
      
      const userData = userDoc.data();
      
      const balance = {
        success: true,
        userId,
        credits: {
          coverArt: userData.coverArtCredits || 0,
          lyricVideo: userData.lyricVideoCredits || 0,
          total: (userData.coverArtCredits || 0) + (userData.lyricVideoCredits || 0)
        },
        subscription: {
          status: userData.subscriptionStatus || 'none',
          plan: userData.subscriptionVariant || 'none',
          id: userData.subscriptionId || 'none',
          monthlyCredits: {
            coverArt: userData.monthlyCoverArtCredits || 0,
            lyricVideo: userData.monthlyLyricVideoCredits || 0
          }
        },
        additionalInfo: {
          founderPoints: userData.founderPoints || 0,
          lastActive: userData.lastActive || null,
          createdAt: userData.createdAt || null
        },
        timestamp: new Date().toISOString()
      };
      
      console.log(`[INFO] ✅ Credit balance retrieved for user ${userId}`);
      return res.status(200).json(balance);
      
    } catch (error) {
      console.error('[ERROR] ❌ Error getting credit balance:', error.message);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve credit balance',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
  } catch (error) {
    console.error('[ERROR] ❌ Credit balance endpoint error:', error.message);
    return res.status(500).json({ 
      success: false,
      error: error.message === 'Unauthorized - No token provided' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== GET USER TRANSACTIONS (NEW: /api/transactions/:userId) ====================
router.get('/transactions/:userId', async (req, res) => {
  console.log('[INFO] 📊 Getting user transaction history');
  
  try {
    // Verify token first
    const decodedToken = await verifyToken(req);
    const requestUid = decodedToken.uid;
    const { userId } = req.params;
    const { limit = 50, type, startDate, endDate } = req.query;
    
    // Optionally: Check if the requesting user has permission to view this user's transactions
    if (requestUid !== userId) {
      console.warn(`[WARN] ⚠️ User ${requestUid} trying to access transactions of user ${userId}`);
      // In production, you might want to check admin permissions here
    }
    
    console.log(`[DEBUG] Getting transactions for user: ${userId}, limit: ${limit}, type: ${type}`);
    
    const { firestore: fs } = await loadFirebaseAdmin();
    
    if (!fs) {
      throw new Error('Firestore not initialized');
    }
    
    try {
      // Build query
      let query = fs.collection('credit_transactions')
        .where('userId', '==', userId)
        .orderBy('date', 'desc');
      
      // Apply filters
      if (type) {
        query = query.where('creditType', '==', type);
      }
      
      // Apply date filters if provided
      if (startDate) {
        const start = new Date(startDate);
        query = query.where('date', '>=', start);
      }
      
      if (endDate) {
        const end = new Date(endDate);
        query = query.where('date', '<=', end);
      }
      
      // Apply limit
      query = query.limit(parseInt(limit) || 50);
      
      const snapshot = await query.get();
      const transactions = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        transactions.push({
          id: doc.id,
          type: data.type || 'unknown',
          creditType: data.creditType,
          amount: data.amount,
          previousBalance: data.previousBalance,
          newBalance: data.newBalance,
          reason: data.reason,
          date: data.date && typeof data.date.toDate === 'function' 
                ? data.date.toDate().toISOString() 
                : (data.date || new Date().toISOString()),
          timestamp: data.timestamp || new Date().toISOString()
        });
      });
      
      const response = {
        success: true,
        transactions,
        count: transactions.length,
        userId,
        filters: {
          limit: parseInt(limit) || 50,
          type: type || 'all',
          startDate: startDate || null,
          endDate: endDate || null
        },
        timestamp: new Date().toISOString()
      };
      
      console.log(`[INFO] ✅ Retrieved ${transactions.length} transactions for user ${userId}`);
      return res.status(200).json(response);
      
    } catch (error) {
      console.error('[ERROR] ❌ Error getting transactions:', error.message);
      
      // If there's an index error, provide a helpful message
      if (error.message.includes('index')) {
        return res.status(500).json({
          success: false,
          error: 'Transaction query requires Firestore composite index. Please create an index on: userId (ascending), date (descending)',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
      
      return res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve transactions',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
  } catch (error) {
    console.error('[ERROR] ❌ Transactions endpoint error:', error.message);
    return res.status(500).json({ 
      success: false,
      error: error.message === 'Unauthorized - No token provided' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ==================== GET USER PURCHASES (ALIAS FOR /api/purchases/:userId) ====================
router.get('/purchases/:userId', async (req, res) => {
  console.log('[INFO] 🛒 Getting user purchase history');
  
  try {
    // Verify token first
    const decodedToken = await verifyToken(req);
    const requestUid = decodedToken.uid;
    const { userId } = req.params;
    const { limit = 20 } = req.query;
    
    // Optionally: Check if the requesting user has permission to view this user's purchases
    if (requestUid !== userId) {
      console.warn(`[WARN] ⚠️ User ${requestUid} trying to access purchases of user ${userId}`);
      // In production, you might want to check admin permissions here
    }
    
    console.log(`[DEBUG] Getting purchases for user: ${userId}, limit: ${limit}`);
    
    const { firestore: fs } = await loadFirebaseAdmin();
    
    if (!fs) {
      throw new Error('Firestore not initialized');
    }
    
    try {
      const query = fs.collection('purchases')
        .where('userId', '==', userId)
        .orderBy('date', 'desc')
        .limit(parseInt(limit) || 20);
      
      const snapshot = await query.get();
      const purchases = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        purchases.push({
          id: doc.id,
          productId: data.productId,
          productName: data.productName,
          price: data.price,
          creditsAdded: data.creditsAdded || {},
          status: data.status || 'completed',
          date: data.date && typeof data.date.toDate === 'function'
                ? data.date.toDate().toISOString() 
                : (data.date || new Date().toISOString()),
          transactionId: data.transactionId,
          paymentMethod: data.paymentMethod
        });
      });
      
      const response = {
        success: true,
        purchases,
        count: purchases.length,
        userId,
        timestamp: new Date().toISOString()
      };
      
      console.log(`[INFO] ✅ Retrieved ${purchases.length} purchases for user ${userId}`);
      return res.status(200).json(response);
      
    } catch (error) {
      console.error('[ERROR] ❌ Error getting purchases:', error.message);
      
      // If there's an index error, provide a helpful message
      if (error.message.includes('index')) {
        return res.status(500).json({
          success: false,
          error: 'Purchase query requires Firestore composite index. Please create an index on: userId (ascending), date (descending)',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
      
      return res.status(500).json({ 
        success: false,
        error: 'Failed to retrieve purchases',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
  } catch (error) {
    console.error('[ERROR] ❌ Purchases endpoint error:', error.message);
    return res.status(500).json({ 
      success: false,
      error: error.message === 'Unauthorized - No token provided' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
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
      'GET /balance/:userId': 'Get complete credit balance (includes subscription info)',
      'GET /transactions/:userId': 'Get user transaction history',
      'GET /purchases/:userId': 'Get user purchase history',
      'GET /test-connection': 'Test API connection (no auth required)',
      'GET /health': 'API health check (no auth required)',
      'GET /test': 'Detailed test endpoint (no auth required)'
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== TEST ENDPOINT ====================
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Credit Management API is working',
    endpoints: {
      'POST /': 'Deduct credits',
      'POST /check': 'Check credit balance (POST)',
      'GET /': 'Check credit balance (GET)',
      'GET /balance/:userId': 'Get full credit balance',
      'GET /transactions/:userId': 'Get transaction history',
      'GET /purchases/:userId': 'Get purchase history',
      'GET /test-connection': 'Test API connection (similar to /api/reddit-admin/test-reddit)',
      'GET /health': 'Health check',
      'GET /test': 'Test endpoint'
    },
    timestamp: new Date().toISOString()
  });
});

console.log('[INFO] ✅ Credit Management API Ready');
console.log('[INFO] 🔧 Test Endpoint: GET /api/deduct-credits/test-connection');
console.log('[INFO] 🔄 Endpoint: POST /api/deduct-credits');
console.log('[INFO] 🔍 Check Endpoint (POST): POST /api/deduct-credits/check');
console.log('[INFO] 🔍 Check Endpoint (GET): GET /api/deduct-credits');
console.log('[INFO] 💰 Balance Endpoint: GET /api/deduct-credits/balance/:userId');
console.log('[INFO] 📊 Transactions Endpoint: GET /api/deduct-credits/transactions/:userId');
console.log('[INFO] 🛒 Purchases Endpoint: GET /api/deduct-credits/purchases/:userId');
console.log('[INFO] 🏥 Health Check: GET /api/deduct-credits/health');

export default router;