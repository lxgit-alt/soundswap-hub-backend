// backend/api/submissions.js
import { allowCors } from './_cors.js';
import { submitSubmission } from '../services/submissionsService.js';
import authenticate from '../lib/authMiddleware.js';

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
  let decodedToken;
  try {
    decodedToken = await authenticate(idToken); // authenticate should return user info
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { trackURL } = req.body;
  if (!trackURL) {
    return res.status(400).json({ error: 'trackURL is required' });
  }

  try {
    const submission = await submitSubmission({
      userId: decodedToken.uid,
      trackURL,
    });
    return res.status(201).json(submission);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to submit track' });
  }
}

export default allowCors(handler);
