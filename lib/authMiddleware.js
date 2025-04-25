// lib/authMiddleware.js
import admin from './firebaseAdmin.js';

export async function authenticate(handler) {
  return async (req, res) => {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const { uid } = await admin.auth().verifyIdToken(token);
      req.userId = uid;
      return handler(req, res);
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}
