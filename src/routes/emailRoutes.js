import express from 'express';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../utils/emailService.js';

const router = express.Router();

// Send welcome email serverless function
export const sendWelcomeEmailHandler = async (req, res) => {
  try {
    console.log('📨 Received welcome email request:', req.body);
    
    const { email, name, subscription, isFounder } = req.body;

    // Validate required fields
    if (!email) {
      console.error('❌ Email is required');
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('❌ Invalid email format:', email);
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    console.log('🔄 Sending welcome email to:', { email, name, subscription, isFounder });

    // Send the welcome email
    await sendWelcomeEmail(
      email,
      name || 'Artist',
      subscription || 'Free',
      isFounder || false
    );

    console.log('✅ Welcome email sent successfully to:', email);

    res.json({
      success: true,
      message: 'Welcome email sent successfully'
    });
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    
    let errorMessage = 'Failed to send welcome email';
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Please check email credentials.';
    } else if (error.code === 'EENVELOPE') {
      errorMessage = 'Invalid email address.';
    } else if (error.message.includes('ENOTFOUND')) {
      errorMessage = 'Network error. Please try again.';
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Send password reset email serverless function
export const sendPasswordResetHandler = async (req, res) => {
  try {
    console.log('📨 Received password reset email request:', req.body);
    
    const { email, resetToken, name } = req.body;

    // Validate required fields
    if (!email || !resetToken) {
      console.error('❌ Email and reset token are required');
      return res.status(400).json({
        success: false,
        message: 'Email and reset token are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('❌ Invalid email format:', email);
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    console.log('🔄 Sending password reset email to:', { email, resetToken, name });

    // Generate reset URL
    const clientURL = process.env.NODE_ENV === 'production'
      ? 'https://soundswap.live'
      : (process.env.CLIENT_URL || 'https://soundswap.live');
    
    const resetUrl = `${clientURL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Send the password reset email
    await sendPasswordResetEmail(
      email,
      resetUrl,
      name || ''
    );

    console.log('✅ Password reset email sent successfully to:', email);

    res.json({
      success: true,
      message: 'Password reset email sent successfully'
    });
  } catch (error) {
    console.error('❌ Error sending password reset email:', error);
    
    let errorMessage = 'Failed to send password reset email';
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Please check email credentials.';
    } else if (error.code === 'EENVELOPE') {
      errorMessage = 'Invalid email address.';
    } else if (error.message.includes('ENOTFOUND')) {
      errorMessage = 'Network error. Please try again.';
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Test endpoint for email configuration serverless function
export const testEmailHandler = async (req, res) => {
  try {
    const hasEmailConfig = !!(process.env.GMAIL_USER && process.env.GMAIL_PASS);
    
    res.json({
      success: true,
      email_configured: hasEmailConfig,
      email_user: process.env.GMAIL_USER ? 'Configured' : 'Not set',
      node_env: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      message: 'Email API endpoint is operational',
      available_endpoints: [
        'POST /api/email/send-welcome-email',
        'POST /api/email/send-password-reset',
        'GET /api/email/test'
      ]
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// ==================== EXPRESS ROUTES (FOR BACKWARD COMPATIBILITY) ====================

// Send welcome email endpoint
router.post('/send-welcome-email', sendWelcomeEmailHandler);

// Send password reset email endpoint
router.post('/send-password-reset', sendPasswordResetHandler);

// Test endpoint for email configuration
router.get('/test', testEmailHandler);

export default router;