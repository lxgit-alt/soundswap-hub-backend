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
    res.json({ spotsClaimed: snapshot.size });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch spots' });
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
router.post('/claim', claimLimiter, async (req, res) => {
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
});

export default router;