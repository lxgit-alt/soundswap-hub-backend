// backend/api/submissions.js
import { allowCors } from './_cors.js';
import authenticate from '../lib/authMiddleware.js';
import { submitSubmission } from '../services/submissionsService.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Extract and validate the Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const idToken = authHeader.split(' ')[1];
  try {
    const decodedToken = await authenticate(idToken); // Assuming authenticate validates the token
    req.user = decodedToken;
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { trackURL } = req.body;
  if (!trackURL) {
    return res.status(400).json({ error: 'trackURL is required' });
  }

  const submission = await submitSubmission({
    userId: req.user.uid,
    trackURL,
  });

  return res.status(201).json(submission);
}

export default allowCors(authenticate(handler));
