import { getAuth } from 'firebase-admin/auth';

const authenticate = (handler) => {
  return async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        if (process.env.NODE_ENV === 'development') {
          // Mock user in development
          req.user = { uid: 'dev-user-123' };
          return handler(req, res);
        }
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const idToken = authHeader.split(' ')[1];
      const auth = getAuth();
      const decodedToken = await auth.verifyIdToken(idToken);
      
      req.user = decodedToken;
      return handler(req, res);
    } catch (error) {
      console.error('Auth error:', error);
      
      if (process.env.NODE_ENV === 'development') {
        // Allow in development
        req.user = { uid: 'dev-user-123' };
        return handler(req, res);
      }
      
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
};

export default authenticate;