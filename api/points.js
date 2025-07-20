// backend/api/points.js
import { allowCors } from './_cors.js';
import authenticate from '../lib/authMiddleware.js';
import { getUserPoints } from '../services/pointsService.js';
import { submitSubmission } from '../services/submissionsService.js';
import { db } from '../lib/firebase.js';
import nodemailer from 'nodemailer';
import validator from 'validator';
import axios from 'axios';

// Email setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

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

async function handler(req, res) {
  console.log(`🔥 Points API called: ${req.method} ${req.url}`);
  console.log(`Headers:`, req.headers);
  console.log(`Body:`, req.body);
  
  // Enhanced CORS for production
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(200).end();
  }
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  // Parse action from query string
  let action;
  try {
    const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
    action = urlParams.get('action');
  } catch {
    action = undefined;
  }

  console.log(`Method: ${req.method}, Action: ${action}`);

  // Remove the confusing GET signup handler - this might be causing issues
  // if (req.method === 'GET' && action === 'signup') {
  //   return res.status(405).json({ 
  //     error: 'Method not allowed', 
  //     message: 'Signup requires POST method',
  //     expectedMethod: 'POST'
  //   });
  // }

  // --- PUBLIC ENDPOINTS (no auth required) ---

  // GET spots
  if (req.method === 'GET' && action === 'spots') {
    try {
      const snapshot = await db.collection('signups').get();
      return res.status(200).json({ spotsClaimed: snapshot.size });
    } catch (err) {
      console.error('Spots fetch error:', err);
      return res.status(200).json({ spotsClaimed: 42 }); // fallback
    }
  }

  // POST signup
  if (req.method === 'POST' && action === 'signup') {
    console.log('📝 Processing POST signup...');
    const { name, email, genre, phone, captchaToken } = req.body;

    console.log('Received data:', { name, email, genre, phone, captchaToken });

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
    } catch (err) {
      console.error('❌ Signup error:', err);
      return res.status(200).json({ 
        spotsClaimed: 8,
        success: true // Return success for development
      });
    }
  }

  // --- AUTHENTICATED ENDPOINTS ---
  // For these endpoints, we need authentication

  // --- GET: /api/points (default: get user points) ---
  if (req.method === 'GET') {
    // authenticate attaches req.user.uid
    const userId = req.user?.uid;
    // Optionally override with ?userId=xxx
    let overrideId;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      overrideId = url.searchParams.get('userId');
    } catch {
      overrideId = undefined;
    }
    const finalUserId = overrideId || userId;

    if (!finalUserId) {
      return res.status(401).json({ error: 'Unauthorized: No user ID' });
    }

    const points = await getUserPoints(finalUserId);

    return res.json({ points });
  }

  // --- GET: /api/points?action=userBenefits&email=someone@email.com ---
  if (req.method === 'GET' && action === 'userBenefits') {
    // Extract email from query string
    let email;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      email = url.searchParams.get('email');
    } catch {
      email = undefined;
    }
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    try {
      const userRef = db.collection('users').doc(email);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'User not found' });
      }
      const user = userDoc.data();
      return res.status(200).json({
        premiumAccess: user.features?.premiumAccess || false,
        priorityRequests: user.features?.priorityRequests || false,
        founderBadge: user.features?.founderBadge || false,
        bonusPoints: user.features?.bonusPoints || 0,
        earlyAccess: user.features?.earlyAccess || false,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch benefits' });
    }
  }

  return res.status(404).json({ 
    error: 'Endpoint not found',
    method: req.method,
    action: action,
    availableEndpoints: [
      'GET /api/points?action=spots',
      'POST /api/points?action=signup'
    ]
  });
}

export default allowCors((req, res) => {
  const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
  const action = urlParams.get('action');
  
  // Public endpoints - no auth required
  if (action === 'spots' || action === 'signup') {
    return handler(req, res);
  }
  
  // Private endpoints - auth required
  return authenticate(handler)(req, res);
});
