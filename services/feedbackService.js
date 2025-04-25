import { db } from '../lib/firebaseAdmin';

export const submitFeedback = async ({ fromUserId, toUserId, rating, comments }) => {
  const batch = db.batch();
  
  const feedbackRef = db.collection('feedback').doc();
  batch.set(feedbackRef, {
    fromUserId,
    toUserId,
    rating: Math.min(5, Math.max(1, rating)),
    comments,
    createdAt: new Date()
  });

  const userRef = db.collection('users').doc(toUserId);
  batch.update(userRef, {
    feedbackPoints: firebase.firestore.FieldValue.increment(1),
    hasUnreviewedTrack: false
  });

  await batch.commit();
};