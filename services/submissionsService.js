// backend/services/submissionsService.js
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

export async function submitSubmission({ userId, trackURL }) {
  // 1) Add a submission document
  const subRef = db.collection('submissions').doc();
  const submissionData = {
    id: subRef.id,
    userId,
    trackURL,
    reviewed: false,
    createdAt: FieldValue.serverTimestamp(),
  };
  await subRef.set(submissionData);

  // 2) Update the user’s profile
  await db.collection('users').doc(userId).update({
    trackURL,
    hasUnreviewedTrack: true,
    lastSubmitted: FieldValue.serverTimestamp(),
  });

  return submissionData;
}

export const submitSubmissionV2 = async ({ userId, trackURL }) => {
  try {
    const submissionRef = await db.collection('submissions').add({
      userId,
      trackURL,
      createdAt: new Date(),
      status: 'pending',
    });

    return {
      id: submissionRef.id,
      userId,
      trackURL,
      status: 'pending',
      createdAt: new Date(),
    };
  } catch (error) {
    console.error('Error submitting track:', error);
    throw error;
  }
};
