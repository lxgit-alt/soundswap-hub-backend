import { authenticate } from '../../lib/authMiddleware';
import { db } from '../../lib/firebaseAdmin';

export default authenticate(async (req, res) => {
  try {
    const snapshot = await db.collection('feedback')
      .where('toUserId', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    const feedbackList = [];
    
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const fromUserDoc = await db.collection('users').doc(data.fromUserId).get();
      
      feedbackList.push({
        id: doc.id,
        rating: data.rating,
        comments: data.comments,
        createdAt: data.createdAt,
        fromUser: fromUserDoc.exists ? fromUserDoc.data() : null
      });
    }

    res.status(200).json(feedbackList);
  } catch (error) {
    console.error('Recent feedback error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch feedback',
      details: error.message 
    });
  }
});