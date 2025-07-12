import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

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
    feedbackPoints: FieldValue.increment(1),
    hasUnreviewedTrack: false
  });

  await batch.commit();
};