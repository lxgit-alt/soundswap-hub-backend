import { generatePairs } from '../services/pairingService.js';
import { authenticate } from '../lib/authMiddleware.js';
import cors from 'cors';

const corsMiddleware = cors({
  origin: process.env.CLIENT_URL
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

export default async (req, res) => {
  // wait for CORS
  await runMiddleware(req, res, corsMiddleware);

  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  return authenticate(async (req, res) => {
    try {
      const genre = req.query.genre || 'all';
      const pairs = await generatePairs(genre);
      res.status(200).json({ pairs });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  })(req, res);
};

export const config = { maxDuration: 30 };