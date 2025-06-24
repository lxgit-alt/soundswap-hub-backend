import { auth } from 'firebase-admin';

export const authenticate = async (req, res) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = await auth().verifyIdToken(token);
    req.user = decoded;
    return true;
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid token' });
    return false;
  }
};

export default authenticate;