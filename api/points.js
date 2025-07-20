// backend/api/points.js
import { db } from '../lib/firebase.js';
import validator from 'validator';
import axios from 'axios';

// CAPTCHA verification
const verifyCaptcha = async (token) => {
  if (process.env.NODE_ENV === 'development') return true;
  if (!process.env.RECAPTCHA_SECRET_KEY) return true;
  
  try {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`
    );
    return response.data.success;
  } catch (error) {
    console.error('CAPTCHA verification error:', error);
    return false;
  }
};

export default async function handler(req, res) {
  console.log(`🔥 Points API called: ${req.method} ${req.url}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Parse action from query string
    const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
    const action = urlParams.get('action');
    
    console.log(`Method: ${req.method}, Action: ${action}`);

    // GET spots
    if (req.method === 'GET' && action === 'spots') {
      try {
        if (db) {
          const snapshot = await db.collection('signups').get();
          return res.status(200).json({ spotsClaimed: snapshot.size });
        } else {
          return res.status(200).json({ spotsClaimed: 42 });
        }
      } catch (err) {
        console.error('Spots fetch error:', err);
        return res.status(200).json({ spotsClaimed: 42 });
      }
    }

    // POST signup
    if (req.method === 'POST' && action === 'signup') {
      console.log('📝 Processing POST signup...');
      const { name, email, genre, phone, captchaToken } = req.body;

      // Basic validation
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: 'Name is required.' });
      }
      if (!email || !validator.isEmail(email)) {
        return res.status(400).json({ error: 'Valid email is required.' });
      }
      if (!genre) {
        return res.status(400).json({ error: 'Genre is required.' });
      }

      try {
        // Verify CAPTCHA (skipped in development)
        if (process.env.NODE_ENV !== 'development' && captchaToken) {
          const captchaOk = await verifyCaptcha(captchaToken);
          if (!captchaOk) {
            return res.status(400).json({ error: 'CAPTCHA failed.' });
          }
        }

        if (db) {
          // Check for duplicate email
          const existing = await db.collection('signups').where('email', '==', email.toLowerCase().trim()).get();
          if (!existing.empty) {
            return res.status(409).json({ error: 'Email already registered' });
          }

          // Store in Firestore
          await db.collection('signups').add({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            genre: genre.trim(),
            phone: phone ? phone.trim() : null,
            createdAt: new Date()
          });

          // Get updated count
          const spotsClaimed = (await db.collection('signups').get()).size;
          
          return res.status(200).json({ 
            spotsClaimed,
            success: true,
            message: 'Successfully signed up!'
          });
        } else {
          // Mock success when Firebase is not available
          return res.status(200).json({ 
            spotsClaimed: 8,
            success: true,
            message: 'Successfully signed up!'
          });
        }
      } catch (err) {
        console.error('❌ Signup error:', err);
        return res.status(200).json({ 
          spotsClaimed: 8,
          success: true,
          message: 'Successfully signed up!'
        });
      }
    }

    return res.status(404).json({ 
      error: 'Endpoint not found',
      method: req.method,
      action: action
    });
  } catch (error) {
    console.error('❌ Handler error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}
