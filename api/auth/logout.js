// backend/api/auth/logout.js
const cors = require('../../lib/cors');
const { admin } = require('../../lib/firebaseAdmin');

module.exports = cors(async (req, res) => {
  if (req.method !== 'POST') 
    return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { uid } = await admin.auth().verifyIdToken(token);
    // Revoke all refresh tokens for the user
    await admin.auth().revokeRefreshTokens(uid);
    return res.status(200).json({ message: 'Logged out' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(400).json({ error: err.message });
  }
});
