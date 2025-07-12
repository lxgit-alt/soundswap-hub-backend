// backend/api/points.js
import { allowCors } from './_cors.js';
import authenticate from '../lib/authMiddleware.js';
import { getUserPoints } from '../services/pointsService.js';

async function handler(req, res) {
  // authenticate attaches req.user.uid
  const userId = req.user?.uid;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Optionally override with ?userId=xxx
  let overrideId;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    overrideId = url.searchParams.get('userId');
  } catch {
    overrideId = undefined;
  }
  const finalUserId = overrideId || userId;

  if (!finalUserId) {
    return res.status(401).json({ error: 'Unauthorized: No user ID' });
  }

  const points = await getUserPoints(finalUserId);

  return res.json({ points });
}

export default allowCors(authenticate(handler));
