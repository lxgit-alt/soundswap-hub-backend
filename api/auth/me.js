// backend/api/auth/me.js
const cors = require('../../lib/cors');
const { admin, db } = require('../../lib/firebaseAdmin');

module.exports = cors(async (req, res) => {
  if (req.method !== 'GET') 
    return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { uid } = await admin.auth().verifyIdToken(token);
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) throw new Error('Profile not found');
    return res.status(200).json({ user: doc.data() });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
});
