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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Adjust the query to your actual Firestore structure
    const snapshot = await db.collection('pairings')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    const current = snapshot.empty ? null : snapshot.docs[0].data();
    res.status(200).json({ current });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch current pairing' });
  }
}