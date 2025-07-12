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
  if (req.method === 'POST') {
    const { name, email, genre } = req.body;

    if (!name || !email || !genre) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      // Check for duplicate email
      const existing = await db.collection('signups').where('email', '==', email).get();
      if (!existing.empty) {
        return res.status(409).json({ error: 'Email already used' });
      }

      // Save to Firestore
      await db.collection('signups').add({
        name,
        email,
        genre,
        createdAt: new Date()
      });
      res.status(200).json({ success: true, message: 'Signup received!' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save signup' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}