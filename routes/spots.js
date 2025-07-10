import express from 'express';
import nodemailer from 'nodemailer';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import validator from 'validator';
import axios from 'axios';
import dotenv from 'dotenv';


dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Only initialize Firebase once
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    readFileSync(path.join(__dirname, '../serviceAccountKey.json'), 'utf8')
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const router = express.Router();

// Configure your mail transporter (use environment variables for real projects)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER, // Use env variable
    pass: process.env.GMAIL_PASS  // Use env variable
  },
  logger: true,
  debug: true
});

// Limit to 5 requests per IP per hour for /claim
const claimLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20, // allow 20 attempts per 10 minutes
  message: { error: 'Too many signup attempts from this IP, please try again later.' }
});

// Get spots claimed
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('signups').get();
    const spotsClaimed = snapshot.size; // Number of signups
    res.json({ spotsClaimed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch spots claimed' });
  }
});

// Verify CAPTCHA with Google
const verifyCaptcha = async (token) => {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  const response = await axios.post(
    `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`
  );
  console.log('reCAPTCHA response:', response.data); // <-- Add this line
  return response.data.success;
};

// Claim a spot
router.post('/claim', claimLimiter, express.json(), async (req, res) => {
  const { email, captchaToken } = req.body;
  if (!email || !validator.isEmail(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  if (!captchaToken) {
    return res.status(400).json({ error: 'CAPTCHA token missing' });
  }
  const captchaValid = await verifyCaptcha(captchaToken);
  if (!captchaValid) {
    return res.status(400).json({ error: 'CAPTCHA verification failed' });
  }

  // Check if email already exists
  const existing = await db.collection('signups').doc(email).get();
  if (existing.exists) {
    return res.status(409).json({ error: 'Email already used' });
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: 'Your SoundSwap Lifetime Deal',
      text: 'Thank you for signing up for the SoundSwap lifetime deal! Stay tuned for more info.'
    });
    console.log('Email sent:', info);

    // Save email to Firestore
    await db.collection('signups').doc(email).set({
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Add user to the users collection with founder features
    const userRef = db.collection('users').doc(email);
    await userRef.set({
      email: email,
      isFounder: true,
      features: {
        premiumAccess: {
          type: "permanent",
          grantedAt: new Date().toISOString()
        },
        priorityRequests: true,
        founderBadge: true,
        bonusPoints: 500,
        earlyAccess: true
      },
      feedbackPoints: 500,
      subscription: "lifetime",
      founderSince: new Date().toISOString().slice(0, 10)
    }, { merge: true }); // merge: true to avoid overwriting if user exists

    // Get updated count
    const snapshot = await db.collection('signups').get();
    res.json({ spotsClaimed: snapshot.size });
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

export default router;