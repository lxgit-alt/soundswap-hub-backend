import { allowCors } from './_cors.js';
import { getRandomPairsByGenre } from '../services/pairingService.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const genre = req.query.genre;
  if (!genre) return res.status(400).json({ error: 'genre is required' });

  try {
    const pairs = await getRandomPairsByGenre(genre);
    res.json({ pairs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export default allowCors(authMiddleware(handler));