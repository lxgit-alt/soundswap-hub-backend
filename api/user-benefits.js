import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  // Only GET is allowed
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract email from the URL: /api/user-benefits?email=someone@email.com
  const { email } = req.query || {};
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const userRef = db.collection('users').doc(email);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userDoc.data();
    res.status(200).json({
      premiumAccess: user.features?.premiumAccess || false,
      priorityRequests: user.features?.priorityRequests || false,
      founderBadge: user.features?.founderBadge || false,
      bonusPoints: user.features?.bonusPoints || 0,
      earlyAccess: user.features?.earlyAccess || false,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch benefits' });
  }
}