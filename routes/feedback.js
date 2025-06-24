import express from 'express';
import admin from 'firebase-admin';
const router = express.Router();

const db = admin.firestore();

router.get('/stats', async (req, res) => {
  try {
    const snapshot = await db.collection('feedback').get();
    const feedbacks = snapshot.docs.map(doc => doc.data());
    const count = feedbacks.length;
    const avgRating = count
      ? feedbacks.reduce((sum, f) => sum + (f.rating || 0), 0) / count
      : 0;
    res.json({ count, avgRating });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const snapshot = await db.collection('feedback')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    const recent = snapshot.docs.map(doc => doc.data());
    res.json({ recent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch recent feedback' });
  }
});

// Add this endpoint for /api/feedback/:id
router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('feedback').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Feedback not found' });
    }
    // Include the document ID in the response if needed
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

export default router;