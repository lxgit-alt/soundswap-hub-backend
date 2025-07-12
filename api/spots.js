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
  if (req.method === 'GET') {
    try {
      const snapshot = await db.collection('signups').get();
      res.status(200).json({ spotsClaimed: snapshot.size });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch spots' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}