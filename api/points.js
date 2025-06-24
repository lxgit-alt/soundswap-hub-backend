// backend/api/points.js
import { allowCors } from './_cors.js';
import authenticate from '../lib/authMiddleware.js';
import { getUserPoints, getPoints, redeemPoints } from '../services/pointsService.js';

async function handler(req, res) {
  // authenticate attaches req.user.uid
  const userId = req.user.uid;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // you can override with ?userId=xxx, otherwise use the logged-in user
  const points = await getUserPoints(userId);

  return res.json({ points });
}

export default allowCors(authMiddleware(handler));
