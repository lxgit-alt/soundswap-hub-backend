import { allowCors } from '../_cors.js';
import { authMiddleware } from '../../middlewares/authMiddleware.js';
import { getUserById } from '../../services/userService.js';

async function handler(req, res) {
  // authMiddleware will have set req.userId
  const user = await getUserById(req.userId);
  res.json({ user });
}

// Wrap authMiddleware then CORS
export default allowCors(authMiddleware(handler));
