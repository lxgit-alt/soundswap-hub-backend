import { initializeApp, applicationDefault, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import validator from 'validator';
import axios from 'axios';

// Firebase init with proper credentials (same pattern as analytics.js)
if (!getApps().length) {
  console.log('🔥 Initializing Firebase Admin for Feedback...');
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
    console.log('✅ Firebase initialized successfully for Feedback');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
  }
}

const db = getFirestore();

// Email setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// CAPTCHA with development bypass
const verifyCaptcha = async (token) => {
  // Skip CAPTCHA verification in development/testing
  if (!process.env.RECAPTCHA_SECRET_KEY) {
    console.log('⚠️ No RECAPTCHA_SECRET_KEY found, skipping CAPTCHA verification');
    return true;
  }
  
  try {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`
    );
    console.log('🔒 CAPTCHA response:', response.data);
    return response.data.success;
  } catch (error) {
    console.error('CAPTCHA verification error:', error);
    return false;
  }
};

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
    // Parse action and id from query string with better error handling
    let action, id;
    try {
      const baseUrl = req.headers.host ? `https://${req.headers.host}` : 'https://localhost:3000';
      const url = new URL(req.url, baseUrl);
      action = url.searchParams.get('action');
      id = url.searchParams.get('id');
    } catch (urlError) {
      console.error('URL parsing error:', urlError);
      const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
      action = urlParams.get('action');
      id = urlParams.get('id');
    }

    // --- GET: /api/feedback?action=stats ---
    if (req.method === 'GET' && action === 'stats') {
      try {
        const snapshot = await db.collection('feedback').get();
        const feedbacks = snapshot.docs.map(doc => doc.data());
        const count = feedbacks.length;
        const avgRating = count
          ? feedbacks.reduce((sum, f) => sum + (f.rating || 0), 0) / count
          : 0;
        return res.status(200).json({ count, avgRating });
      } catch (err) {
        console.error('Stats fetch error:', err);
        // Return mock data if Firebase fails
        return res.status(200).json({ count: 15, avgRating: 4.2 });
      }
    }

    // --- GET: /api/feedback?action=recent ---
    if (req.method === 'GET' && action === 'recent') {
      try {
        const snapshot = await db.collection('feedback')
          .orderBy('createdAt', 'desc')
          .limit(10)
          .get();
        const recent = snapshot.docs.map(doc => doc.data());
        return res.status(200).json({ recent });
      } catch (err) {
        console.error('Recent feedback fetch error:', err);
        // Return mock data if Firebase fails
        const mockRecent = [
          { id: '1', rating: 5, comments: 'Great track!', createdAt: new Date() },
          { id: '2', rating: 4, comments: 'Nice work', createdAt: new Date() }
        ];
        return res.status(200).json({ recent: mockRecent });
      }
    }

    // --- GET: /api/feedback?action=recentForUser ---
    if (req.method === 'GET' && action === 'recentForUser') {
      // Authenticate user
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const idToken = authHeader.split(' ')[1];
      let decodedToken;
      try {
        const { getAuth } = await import('firebase-admin/auth');
        const auth = getAuth();
        decodedToken = await auth.verifyIdToken(idToken);
      } catch (error) {
        console.error('Auth error:', error);
        return res.status(401).json({ error: 'Invalid token' });
      }

      try {
        const snapshot = await db.collection('feedback')
          .where('toUserId', '==', decodedToken.uid)
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get();

        const feedbackList = [];
        for (const doc of snapshot.docs) {
          const data = doc.data();
          const fromUserDoc = await db.collection('users').doc(data.fromUserId).get();
          feedbackList.push({
            id: doc.id,
            rating: data.rating,
            comments: data.comments,
            createdAt: data.createdAt,
            fromUser: fromUserDoc.exists ? fromUserDoc.data() : null
          });
        }
        return res.status(200).json(feedbackList);
      } catch (error) {
        console.error('Recent feedback error:', error);
        return res.status(500).json({
          error: 'Failed to fetch feedback',
          details: error.message
        });
      }
    }

    // --- GET: /api/feedback?id=xxxx ---
    if (req.method === 'GET' && id) {
      try {
        const doc = await db.collection('feedback').doc(id).get();
        if (!doc.exists) {
          return res.status(404).json({ error: 'Feedback not found' });
        }
        return res.status(200).json({ id: doc.id, ...doc.data() });
      } catch (err) {
        console.error('Feedback fetch error:', err);
        return res.status(500).json({ error: 'Failed to fetch feedback' });
      }
    }

    // --- GET: /api/feedback?action=statsForUser ---
    if (req.method === 'GET' && action === 'statsForUser') {
      // Authenticate user
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const idToken = authHeader.split(' ')[1];
      let decodedToken;
      try {
        const { getAuth } = await import('firebase-admin/auth');
        const auth = getAuth();
        decodedToken = await auth.verifyIdToken(idToken);
      } catch (error) {
        console.error('Auth error:', error);
        return res.status(401).json({ error: 'Invalid token' });
      }

      try {
        const userDoc = await db.collection('users').doc(decodedToken.uid).get();
        if (!userDoc.exists) {
          return res.status(200).json({ points: 0 });
        }
        const points = userDoc.data().feedbackPoints || 0;
        return res.status(200).json({ points });
      } catch (error) {
        console.error('Stats endpoint error:', error);
        return res.status(500).json({
          error: 'Failed to fetch points',
          details: error.message
        });
      }
    }

    // --- POST: /api/feedback (submit new feedback) ---
    if (req.method === 'POST' && !action) {
      // Authenticate user
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const idToken = authHeader.split(' ')[1];
      let decodedToken;
      try {
        const { getAuth } = await import('firebase-admin/auth');
        const auth = getAuth();
        decodedToken = await auth.verifyIdToken(idToken);
      } catch (error) {
        console.error('Auth error:', error);
        return res.status(401).json({ error: 'Invalid token' });
      }

      const { toUserId, rating, comments } = req.body;
      
      if (!toUserId || !rating) {
        return res.status(400).json({ error: 'toUserId and rating are required' });
      }
      
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }

      try {
        const feedbackRef = await db.collection('feedback').add({
          fromUserId: decodedToken.uid,
          toUserId,
          rating,
          comments: comments || '',
          createdAt: new Date()
        });
        
        return res.status(201).json({ 
          id: feedbackRef.id, 
          message: 'Feedback submitted successfully' 
        });
      } catch (error) {
        console.error('Feedback submission error:', error);
        return res.status(500).json({ error: 'Failed to submit feedback' });
      }
    }

    // Method not allowed
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}