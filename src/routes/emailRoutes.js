import express from 'express';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../utils/emailService.js';

const router = express.Router();

// Send welcome email endpoint
router.post('/send-welcome-email', async (req, res) => {
  try {
    const { email, name, subscription, isFounder } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Send the welcome email
    await sendWelcomeEmail(
      email,
      name || 'Artist',
      subscription || 'Free',
      isFounder || false
    );

    res.json({
      success: true,
      message: 'Welcome email sent successfully'
    });
  } catch (error) {
    console.error('Error sending welcome email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send welcome email',
      error: error.message
    });
  }
});

// Add this new endpoint for password reset
router.post('/send-password-reset', async (req, res) => {
  try {
    const { email, resetToken, name } = req.body;

    // Validate required fields
    if (!email || !resetToken) {
      return res.status(400).json({
        success: false,
        message: 'Email and reset token are required'
      });
    }

    // Generate reset URL
    const clientURL = process.env.NODE_ENV === 'production'
      ? 'https://soundswap.onrender.com'
      : (process.env.CLIENT_URL || 'http://localhost:5173');
    
    const resetUrl = `${clientURL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Send the password reset email
    await sendPasswordResetEmail(
      email,
      resetUrl,
      name || ''
    );

    res.json({
      success: true,
      message: 'Password reset email sent successfully'
    });
  } catch (error) {
    console.error('Error sending password reset email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send password reset email',
      error: error.message
    });
  }
});

export default router;