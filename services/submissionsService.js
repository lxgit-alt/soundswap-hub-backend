// backend/services/submissionsService.js
import { db, admin } from '../firebaseAdmin.js';

export async function submitSubmission({ userId, trackURL }) {
  // 1) Add a submission document
  const subRef = db.collection('submissions').doc();
  const submissionData = {
    id: subRef.id,
    userId,
    trackURL,
    reviewed: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await subRef.set(submissionData);

  // 2) Update the user’s profile
  await db.collection('users').doc(userId).update({
    trackURL,
    hasUnreviewedTrack: true,
    lastSubmitted: admin.firestore.FieldValue.serverTimestamp(),
  });

  return submissionData;
}
