// backend/api/points.js
import { allowCors } from './_cors.js';
import authenticate from '../lib/authMiddleware.js';
import { getUserPoints } from '../services/pointsService.js';
import { submitSubmission } from '../services/submissionsService.js';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import validator from 'validator';
import axios from 'axios';

// Firebase init
if (!getApps().length) {
  initializeApp({ credential: applicationDefault() });
}
const db = getFirestore();

// Email setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  logger: true,
  debug: true
});

// CAPTCHA
const verifyCaptcha = async (token) => {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  const response = await axios.post(
    `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`
  );
  return response.data.success;
};

async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Parse action from query string
  let action;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    action = url.searchParams.get('action');
  } catch {
    action = undefined;
  }

  // --- GET: /api/points?action=spots (get spots claimed) ---
  if (req.method === 'GET' && action === 'spots') {
    try {
      const snapshot = await db.collection('signups').get();
      res.json({ spotsClaimed: snapshot.size });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch spots' });
    }
    return;
  }

  // --- GET: /api/points?action=pairingsCurrent (get latest pairing) ---
  if (req.method === 'GET' && action === 'pairingsCurrent') {
    try {
      const snapshot = await db.collection('pairings')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      const current = snapshot.empty ? null : snapshot.docs[0].data();
      res.json({ current });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch current pairing' });
    }
    return;
  }

  // --- POST: /api/points?action=signup (signup/claim spot) ---
  if (req.method === 'POST' && action === 'signup') {
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
    if (phone && !/^\+?\d{10,15}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }

    // Verify CAPTCHA
    if (captchaToken) {
      const captchaOk = await verifyCaptcha(captchaToken);
      if (!captchaOk) {
        return res.status(400).json({ error: 'CAPTCHA failed.' });
      }
    }

    // Check for duplicate email
    const existing = await db.collection('signups').where('email', '==', email).get();
    if (!existing.empty) {
      return res.status(409).json({ error: 'Email already used' });
    }

    // Store in Firestore
    await db.collection('signups').add({
      name,
      email,
      genre,
      phone: phone || null,
      createdAt: new Date()
    });

    // Send confirmation email
    try {
      await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to: email,
        subject: 'Your SoundSwap Lifetime Deal',
        text: `Hi ${name},\n\nThank you for signing up for SoundSwap!\n\nWe've noted your genre: ${genre}.\n\nStay tuned for more info.`
      });
      // Update spotsClaimed count
      const spotsClaimed = (await db.collection('signups').get()).size;
      res.json({ spotsClaimed });
    } catch (err) {
      console.error('Email send error:', err);
      res.status(500).json({ error: 'Failed to send email' });
    }
    return;
  }

  // --- POST: /api/points?action=submission (submit track) ---
  if (req.method === 'POST' && action === 'submission') {
    // Extract and validate the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split(' ')[1];
    let decodedToken;
    try {
      decodedToken = await authenticate(idToken); // authenticate should return user info
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { trackURL } = req.body;
    if (!trackURL) {
      return res.status(400).json({ error: 'trackURL is required' });
    }

    try {
      const submission = await submitSubmission({
        userId: decodedToken.uid,
        trackURL,
      });
      return res.status(201).json(submission);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to submit track' });
    }
  }

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

  // Method not allowed
  res.status(405).json({ error: 'Method not allowed' });
}

export default allowCors(authenticate(handler));
