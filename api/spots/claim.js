import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import validator from 'validator';
import axios from 'axios';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

// Configure your mail transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Verify CAPTCHA with Google
const verifyCaptcha = async (token) => {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  const response = await axios.post(
    `https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${token}`
  );
  return response.data.success;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
}