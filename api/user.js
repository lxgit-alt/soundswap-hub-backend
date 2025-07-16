import express from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';

if (!getApps().length) {
  initializeApp({ credential: applicationDefault() });
}
const db = getFirestore();

const router = express.Router();

router.get('/:email/benefits', async (req, res) => {
  const { email } = req.params;
  try {
    const userRef = admin.firestore().collection('users').doc(email);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userDoc.data();
    res.json({
      premiumAccess: user.features?.premiumAccess || false,
      priorityRequests: user.features?.priorityRequests || false,
      founderBadge: user.features?.founderBadge || false,
      bonusPoints: user.features?.bonusPoints || 0,
      earlyAccess: user.features?.earlyAccess || false,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch benefits' });
  }
});

export default async function handler(req, res) {
  // Parse action from query string: /api/user?action=signup,login,get
  const { action } = req.query;

  if (req.method === 'POST' && action === 'signup') {
    // SIGNUP logic
    const { name, email, password, genre, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    try {
      const userSnapshot = await db.collection('users').where('email', '==', email).get();
      if (!userSnapshot.empty) {
        return res.status(409).json({ error: 'User already exists.' });
      }
      const userRef = db.collection('users').doc();
      await userRef.set({
        id: userRef.id,
        name,
        email,
        password, // In production, hash this!
        genre,
        phone: phone || null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return res.status(201).json({ message: 'Signup successful!', user: { id: userRef.id, name, email, genre, phone } });
    } catch (error) {
      return res.status(500).json({ error: 'Signup failed.', details: error.message });
    }
  }

  if (req.method === 'POST' && action === 'login') {
    // LOGIN logic
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    try {
      const userSnapshot = await db.collection('users').where('email', '==', email).get();
      if (userSnapshot.empty) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      const user = userSnapshot.docs[0].data();
      if (user.password !== password) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      return res.status(200).json({ message: 'Login successful!', user: { id: user.id, name: user.name, email: user.email, genre: user.genre, phone: user.phone } });
    } catch (error) {
      return res.status(500).json({ error: 'Login failed.', details: error.message });
    }
  }

  if (req.method === 'GET' && action === 'get') {
    // GET USER logic (by email)
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    try {
      const userSnapshot = await db.collection('users').where('email', '==', email).get();
      if (userSnapshot.empty) {
        return res.status(404).json({ error: 'User not found.' });
      }
      const user = userSnapshot.docs[0].data();
      return res.status(200).json({ user });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch user.', details: error.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed or invalid action.' });
}