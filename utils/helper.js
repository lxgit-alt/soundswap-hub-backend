// backend/utils/helpers.js
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'replace-with-your-secret';

export function signToken(uid) {
  // create a token that expires in 7 days
  return jwt.sign({ uid }, JWT_SECRET, { expiresIn: '7d' });
}
