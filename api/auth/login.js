// backend/api/auth/login.js
const cors = require('../../lib/cors');
const { admin, db } = require('../../lib/firebaseAdmin');
const fetch = global.fetch || require('node-fetch');

module.exports = cors(async (req, res) => {
  if (req.method !== 'POST') 
    return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  try {
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) throw new Error('Missing FIREBASE_API_KEY env var');

    // Sign in via Firebase Auth REST endpoint
    const signInRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const signInData = await signInRes.json();
    if (!signInRes.ok) {
      throw new Error(signInData.error?.message || 'Login failed');
    }

    const idToken = signInData.idToken;
    // Verify token to get UID
    const { uid } = await admin.auth().verifyIdToken(idToken);

    // Fetch profile from Firestore
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) throw new Error('User profile not found');
    const profile = doc.data();

    return res.status(200).json({ token: idToken, user: profile });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(400).json({ error: err.message });
  }
});
