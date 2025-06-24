import express from 'express';
import admin from 'firebase-admin';
const router = express.Router();

const db = admin.firestore();

router.get('/current', async (req, res) => {
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