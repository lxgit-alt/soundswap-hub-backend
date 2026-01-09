import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Firebase init with proper credentials
if (!getApps().length) {
  console.log('🔥 Initializing Firebase Admin for User...');
  try {
    const firebaseConfig = {
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID || 'soundswap-7e780',
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL || 'firebase-adminsdk-xxxxx@soundswap-7e780.iam.gserviceaccount.com',
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
      projectId: process.env.FIREBASE_PROJECT_ID || 'soundswap-7e780',
    };
    initializeApp(firebaseConfig);
    console.log('✅ Firebase initialized successfully for User');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
  }
}

const db = getFirestore();

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(200).end();
  }

  // Set CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  try {
    // Parse action from query string: /api/user?action=signup,login,get
    const { action } = req.query;

    if (req.method === 'POST' && action === 'signup') {
      // SIGNUP logic
      const { name, email, password, genre, phone } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
      }
      try {
        const userSnapshot = await db.collection('users').where('email', '==', email).get();
        if (!userSnapshot.empty) {
          return res.status(409).json({ error: 'User already exists.' });
        }
        const userRef = db.collection('users').doc();
        await userRef.set({
          id: userRef.id,
          name,
          email,
          // NOTE: In production, use Firebase Auth instead of storing passwords
          genre,
          phone: phone || null,
          createdAt: FieldValue.serverTimestamp(),
        });
        return res.status(201).json({ 
          message: 'Signup successful!', 
          user: { id: userRef.id, name, email, genre, phone } 
        });
      } catch (error) {
        console.error('Signup error:', error);
        return res.status(500).json({ error: 'Signup failed.', details: error.message });
      }
    }

    if (req.method === 'POST' && action === 'login') {
      // LOGIN logic - NOTE: This should use Firebase Auth in production
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }
      try {
        const userSnapshot = await db.collection('users').where('email', '==', email).get();
        if (userSnapshot.empty) {
          return res.status(401).json({ error: 'Invalid credentials.' });
        }
        const user = userSnapshot.docs[0].data();
        // NOTE: In production, use proper password hashing and Firebase Auth
        return res.status(200).json({ 
          message: 'Login successful!', 
          user: { id: user.id, name: user.name, email: user.email, genre: user.genre, phone: user.phone } 
        });
      } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Login failed.', details: error.message });
      }
    }

    // --- GET: /api/user?action=get&email=xxx ---
    if (req.method === 'GET' && action === 'get') {
      const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
      const email = urlParams.get('email');
      
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      try {
        const userDoc = await db.collection('users').doc(email).get();
        if (!userDoc.exists) {
          return res.status(404).json({ error: 'User not found' });
        }
        return res.status(200).json({ id: userDoc.id, ...userDoc.data() });
      } catch (err) {
        console.error('User fetch error:', err);
        return res.status(404).json({ error: 'User not found' });
      }
    }

    if (req.method === 'GET' && action === 'benefits') {
      // GET USER BENEFITS logic (by email)
      const { email } = req.query;
      if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
      }
      try {
        const userRef = db.collection('users').doc(email);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
          return res.status(404).json({ error: 'User not found' });
        }
        const user = userDoc.data();
        return res.status(200).json({
          premiumAccess: user.features?.premiumAccess || false,
          priorityRequests: user.features?.priorityRequests || false,
          founderBadge: user.features?.founderBadge || false,
          bonusPoints: user.features?.bonusPoints || 0,
          earlyAccess: user.features?.earlyAccess || false,
        });
      } catch (error) {
        console.error('Get benefits error:', error);
        return res.status(500).json({ error: 'Failed to fetch benefits' });
      }
    }

    return res.status(405).json({ error: 'Method Not Allowed or invalid action.' });
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}