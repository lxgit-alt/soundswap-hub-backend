import express from 'express';
import admin from 'firebase-admin';
import { sendFounderActivationEmail } from '../src/utils/emailService.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const { email, name } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    await admin.firestore().runTransaction(async (transaction) => {
      const userRef = admin.firestore().collection('users').doc(email);
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
});

export default router;