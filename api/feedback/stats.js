import { authenticate } from '../../lib/authMiddleware.js';
import { db } from '../../lib/firebaseAdmin.js';

export default async function handler(req, res) {
  try {
    // Authenticate first
    await authenticate(req, res);
    
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userDoc = await db.collection('users').doc(req.user.uid).get();
    
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