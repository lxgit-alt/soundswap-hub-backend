import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import authenticate from '../lib/authMiddleware.js';
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
  }
});

// CAPTCHA
const verifyCaptcha = async (token) => {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  const response = await axios.post(
    `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`
  );
  return response.data.success;
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Parse action and id from query string
  let action, id;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    action = url.searchParams.get('action');
    id = url.searchParams.get('id');
  } catch {
    action = undefined;
    id = undefined;
  }

  // --- GET: /api/feedback?action=stats ---
  if (req.method === 'GET' && action === 'stats') {
    try {
      const snapshot = await db.collection('feedback').get();
      const feedbacks = snapshot.docs.map(doc => doc.data());
      const count = feedbacks.length;
      const avgRating = count
        ? feedbacks.reduce((sum, f) => sum + (f.rating || 0), 0) / count
        : 0;
      res.json({ count, avgRating });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
    return;
  }

  // --- GET: /api/feedback?action=recent ---
  if (req.method === 'GET' && action === 'recent') {
    try {
      const snapshot = await db.collection('feedback')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();
      const recent = snapshot.docs.map(doc => doc.data());
      res.json({ recent });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch recent feedback' });
    }
    return;
  }

  // --- GET: /api/feedback?action=recentForUser ---
  if (req.method === 'GET' && action === 'recentForUser') {
    // Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split(' ')[1];
    let decodedToken;
    try {
      decodedToken = await authenticate(idToken);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    try {
      const snapshot = await db.collection('feedback')
        .where('toUserId', '==', decodedToken.uid)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get();

      const feedbackList = [];
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const fromUserDoc = await db.collection('users').doc(data.fromUserId).get();
        feedbackList.push({
          id: doc.id,
          rating: data.rating,
          comments: data.comments,
          createdAt: data.createdAt,
          fromUser: fromUserDoc.exists ? fromUserDoc.data() : null
        });
      }
      res.status(200).json(feedbackList);
    } catch (error) {
      console.error('Recent feedback error:', error);
      res.status(500).json({
        error: 'Failed to fetch feedback',
        details: error.message
      });
    }
    return;
  }

  // --- GET: /api/feedback?id=xxxx ---
  if (req.method === 'GET' && id) {
    try {
      const doc = await db.collection('feedback').doc(id).get();
      if (!doc.exists) {
        return res.status(404).json({ error: 'Feedback not found' });
      }
      res.json({ id: doc.id, ...doc.data() });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch feedback' });
    }
    return;
  }

  // --- GET: /api/feedback?action=statsForUser ---
  if (req.method === 'GET' && action === 'statsForUser') {
    // Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split(' ')[1];
    let decodedToken;
    try {
      decodedToken = await authenticate(idToken);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    try {
      const userDoc = await db.collection('users').doc(decodedToken.uid).get();
      if (!userDoc.exists) {
        return res.status(200).json({ points: 0 });
      }
      const points = userDoc.data().feedbackPoints || 0;
      res.status(200).json({ points });
    } catch (error) {
      console.error('Stats endpoint error:', error);
      res.status(500).json({
        error: 'Failed to fetch points',
        details: error.message
      });
    }
    return;
  }

  // --- POST: /api/feedback?action=claim ---
  if (req.method === 'POST' && action === 'claim') {
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
    if (!captchaToken || !(await verifyCaptcha(captchaToken))) {
      return res.status(400).json({ error: 'CAPTCHA verification failed.' });
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
      res.status(200).json({ spotsClaimed });
    } catch (err) {
      console.error('Email send error:', err);
      res.status(500).json({ error: 'Failed to send email' });
    }
    return;
  }

  // --- Method not allowed ---
  res.status(405).json({ error: 'Method not allowed' });
}