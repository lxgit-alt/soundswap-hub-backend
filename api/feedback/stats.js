import authenticate from '../../lib/authMiddleware.js';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  try {
    // Extract and validate the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split(' ')[1];

    // Authenticate and get user info
    let decodedToken;
    try {
      decodedToken = await authenticate(idToken); // should return user info with uid
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userDoc = await db.collection('users').doc(decodedToken.uid).get();

    if (!userDoc.exists) {
      return res.status(200).json({ points: 0 });
    }

    const points = userDoc.data().feedbackPoints || 0;
    res.status(200).json({ points });

  } catch (error) {
    console.error('Stats endpoint error:', error);
    res.status(500).json({
      error: 'Failed to fetch points',
      details: error.message
    });
  }
}