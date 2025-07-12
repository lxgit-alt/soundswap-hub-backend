// backend/api/feedback.js
import { allowCors } from './_cors.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// --- Simple CORS helper ---
function allowCors(handler) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    return handler(req, res);
  };
}

// --- Real Firebase Auth middleware ---
function authMiddleware(handler) {
  return async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = auth.replace('Bearer ', '');
    try {
      const decodedToken = await getAuth().verifyIdToken(idToken);
      req.userId = decodedToken.uid;
      return handler(req, res);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

// --- Firestore setup ---
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

// --- Main handler ---
async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { submissionId, comments, rating } = req.body;
  if (!submissionId || comments == null || rating == null) {
    return res
      .status(400)
      .json({ error: 'submissionId, comments, and rating are required' });
  }

  try {
    const feedbackRef = await db.collection('feedback').add({
      fromUser: req.userId,
      submissionId,
      comments,
      rating,
      createdAt: new Date(),
    });
    return res.status(201).json({ id: feedbackRef.id, success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save feedback' });
  }
}

// --- Compose middlewares ---
export default allowCors(authMiddleware(handler));
