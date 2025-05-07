// backend/api/submissions.js
import { allowCors } from './_cors.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { submitSubmission } from '../services/submissionsService.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { trackUrl } = req.body;
  if (!trackUrl) {
    return res.status(400).json({ error: 'trackUrl is required' });
  }

  // userId from the token
  const submission = await submitSubmission({
    userId: req.userId,
    trackUrl,
  });

  return res.status(201).json(submission);
}

export default allowCors(authMiddleware(handler));
