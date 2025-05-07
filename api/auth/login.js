import { allowCors } from '../_cors.js';
import { verifyUser } from '../../services/userService.js';
import { signToken } from '../../utils/helpers.js';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const { email, password } = req.body;
  const user = await verifyUser(email, password);
  const token = await signToken(user.id);
  res.json({ user, token });
}

export default allowCors(handler);
