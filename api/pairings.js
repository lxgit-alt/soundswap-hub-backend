import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import express from 'express';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();
const router = express.Router();

router.get('/current', async (req, res) => {
  // Only GET is allowed
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Adjust the query to your actual Firestore structure
    const snapshot = await db.collection('pairings')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    const current = snapshot.empty ? null : snapshot.docs[0].data();
    res.json({ current });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch current pairing' });
  }
});

export default router;