// backend/api/auth/register.js
import { allowCors } from '../_cors.js'
import { createUser } from '../../services/userService.js'
import { signToken } from '../../utils/helpers.js'

async function handler(req, res) {
  // 1) Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  // 2) Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  // 3) Now it's safe to parse req.body
  const { name, email, password, genre } = req.body

  if (!name || !email || !password || !genre) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    const user = await createUser({ name, email, password, genre })
    const token = await signToken(user.id)
    return res.status(201).json({ user, token })
  } catch (err) {
    console.error('Register error:', err)
    return res.status(400).json({ error: err.message })
  }
}

export default allowCors(handler)
