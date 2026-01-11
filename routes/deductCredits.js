// backend/routes/deductCredits.js (example)
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

router.post('/', async (req, res) => {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) return res.status(401).json({ error: 'No token' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const { type, amount, reason = 'generation' } = req.body;
    if (!['coverArt','lyricVideo'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

    const userRef = admin.firestore().doc(`users/${uid}`);
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new Error('Profile not found');
      const data = snap.data();
      const field = type === 'coverArt' ? 'points' : 'lyricVideoCredits';
      const current = (data[field] || 0);
      if (current < amount) throw new Error('Insufficient credits');
      tx.update(userRef, { [field]: current - amount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

      const txRef = admin.firestore().collection('credit_transactions').doc();
      tx.set(txRef, {
        userId: uid,
        type: 'deduction',
        creditType: type,
        amount: -amount,
        reason,
        remaining: current - amount,
        date: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('deductCredits error', err);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;