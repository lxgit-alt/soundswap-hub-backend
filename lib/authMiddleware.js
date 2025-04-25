import { auth } from 'firebase-admin';

export const authenticate = (handler) => async (req, res) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = await auth().verifyIdToken(token);
    req.user = decoded;
    return handler(req, res);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};