// backend/api/auth/login.js
import { allowCors } from '../_cors.js'
import { loginUser } from '../../services/userService.js'

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const { email, password } = req.body || {}
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' })
  }

  try {
    // loginUser now returns a Firebase custom token
    const customToken = await loginUser(email, password)
    return res.status(200).json({ customToken })
  } catch (err) {
    console.error('Login error:', err)
    // Handle not-found or other errors with 401
    return res.status(401).json({ error: err.message })
  }
}

export default allowCors(handler)
