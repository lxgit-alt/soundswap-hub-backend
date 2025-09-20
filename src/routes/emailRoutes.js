import express from 'express';
import { sendWelcomeEmail } from '../utils/emailService.js';

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

export default router;