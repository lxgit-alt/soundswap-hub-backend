// backend/api/pairings.js

import { allowCors } from './_cors.js';
import authenticate from '../lib/authMiddleware.js';  // Add .js extension
import { getRandomPairsByGenre } from '../services/pairingService.js';

async function handler(req, res) {
  // Only GETs are allowed
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const genre = req.query.genre
  if (!genre) {
    return res.status(400).json({ error: 'genre is required' })
  }

  try {
    console.log('Pairings request for genre:', genre)
    const pairs = await getRandomPairsByGenre(genre)
    console.log('Generated pairs:', pairs)
    return res.status(200).json({ pairs })
  } catch (err) {
    console.error('Pairings error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// Wrap with CORS and authentication
export default allowCors(authenticate(handler))
