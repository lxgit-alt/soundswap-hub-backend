// backend/api/auth/register.js
const cors = require('../../lib/cors');
const { admin, db } = require('../../lib/firebaseAdmin');

module.exports = cors(async (req, res) => {
  if (req.method !== 'POST') 
    return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, password, genre } = req.body;
  if (!name || !email || !password || !genre) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1) Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
    });

    // 2) Save profile in Firestore
    const profile = {
      id: userRecord.uid,
      name,
      email,
      genre,
      active: true,
      createdAt: Date.now(),
    };
    await db.collection('users').doc(userRecord.uid).set(profile);

    // 3) Create a custom token (ID token)
    const token = await admin.auth().createCustomToken(userRecord.uid);

    return res.status(200).json({ token, user: profile });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(400).json({ error: err.message });
  }
});
