import { generatePairs } from '../services/pairingService';
import { authenticate } from '../lib/authMiddleware';
import cors from 'cors';

const corsMiddleware = cors({
  origin: process.env.CLIENT_URL
});

export default async (req, res) => {
  await corsMiddleware(req, res);
  
  if (req.method !== 'GET') return res.status(405).end();
  
  const handler = authenticate(async (req, res) => {
    try {
      const genre = req.query.genre || 'all';
      const pairs = await generatePairs(genre);
      res.status(200).json({ pairs });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return handler(req, res);
};

export const config = { maxDuration: 30 };