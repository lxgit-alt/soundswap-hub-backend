import { authenticate } from '../../lib/authMiddleware.js';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase only once per cold start
let db;
if (!getApps().length) {
  initializeApp({ credential: applicationDefault() });
}
db = getFirestore();

export default async function handler(req, res) {
  // Authenticate first
  const isAuthenticated = await authenticate(req, res);
  if (!isAuthenticated) return;

  try {
    const now = Timestamp.now();

    const snapshot = await db.collection('pairings')
      .where('participants', 'array-contains', req.user.uid)
      .where('status', '==', 'active')
      .where('expiresAt', '>', now)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(200).json(null);
    }

    const pairing = snapshot.docs[0].data();
    const partnerId = pairing.participants.find(id => id !== req.user.uid);

    if (!partnerId) {
      return res.status(200).json(null);
    }

    const partnerDoc = await db.collection('users').doc(partnerId).get();

    res.status(200).json({
      id: snapshot.docs[0].id,
      partner: partnerDoc.exists ? partnerDoc.data() : null,
      expiresAt: pairing.expiresAt,
      trackUrl: pairing.trackUrl
    });
  } catch (error) {
    console.error('Current pairing error:', error);
    res.status(500).json({
      error: 'Failed to fetch pairing',
      details: error.message
    });
  }
}