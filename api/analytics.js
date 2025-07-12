import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import jwt from 'jsonwebtoken';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers (Vercel handles preflight automatically)
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Auth middleware
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Log analytics event to Firestore
  try {
    const { eventType, trackUrl, timestamp } = req.body;
    await db.collection('analytics').add({
      userId: decoded.id,
      eventType,
      trackUrl,
      timestamp: timestamp || new Date(),
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to log analytics' });
  }
}