import { authenticate } from '../../lib/authMiddleware.js';
import { db } from '../../lib/firebaseAdmin.js';
import { Timestamp } from 'firebase-admin/firestore';

export default async (req, res) => {
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
};