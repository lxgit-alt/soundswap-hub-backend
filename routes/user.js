import express from 'express';
import admin from 'firebase-admin';

const router = express.Router();

router.get('/:email/benefits', async (req, res) => {
  const { email } = req.params;
  try {
    const userRef = admin.firestore().collection('users').doc(email);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userDoc.data();
    res.json({
      premiumAccess: user.features?.premiumAccess || false,
      priorityRequests: user.features?.priorityRequests || false,
      founderBadge: user.features?.founderBadge || false,
      bonusPoints: user.features?.bonusPoints || 0,
      earlyAccess: user.features?.earlyAccess || false,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch benefits' });
  }
});

export default router;