// backend/api/feedback.js
import { allowCors } from './_cors.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { submitFeedback } from '../services/feedbackService.js';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { submissionId, comments, rating } = req.body;
  if (!submissionId || comments == null || rating == null) {
    return res
      .status(400)
      .json({ error: 'submissionId, comments, and rating are required' });
  }

  // fromUser comes from the validated token
  const feedback = await submitFeedback({
    fromUser: req.userId,
    submissionId,
    comments,
    rating,
  });

  return res.status(201).json(feedback);
}

export default allowCors(authMiddleware(handler));
