import { auth } from 'firebase-admin';

export async function authenticate(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }

    const decoded = await auth().verifyIdToken(token);
    req.user = decoded;
    return decoded;
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }
}

export default authenticate;