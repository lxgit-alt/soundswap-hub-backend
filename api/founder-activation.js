import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { sendFounderActivationEmail } from '../src/utils/emailService.js';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, name } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(email);
      const userDoc = await transaction.get(userRef);

      const founderData = {
        isFounder: true,
        features: {
          premiumAccess: {
            type: "permanent",
            grantedAt: new Date().toISOString()
          },
          priorityRequests: true,
          founderBadge: true,
          bonusPoints: 500,
          earlyAccess: true
        },
        feedbackPoints: 500,
        subscription: "lifetime",
        founderSince: new Date().toISOString().split('T')[0]
      };

      if (!userDoc.exists) {
        transaction.set(userRef, {
          email,
          ...founderData
        });
      } else {
        transaction.update(userRef, founderData);
      }
    });

    // Send activation email using Handlebars template
    await sendFounderActivationEmail(email, name || 'Artist');

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Founder activation error:', error);
    res.status(500).json({ error: error.message });
  }
}