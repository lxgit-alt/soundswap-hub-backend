// backend/api/points.js
import { allowCors } from './_cors.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { getUserPoints } from '../services/pointsService.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // you can override with ?userId=xxx, otherwise use the logged-in user
  const userId = req.query.userId || req.userId;
  const points = await getUserPoints(userId);

  return res.json({ points });
}

export default allowCors(authMiddleware(handler));
