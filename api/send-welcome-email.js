import express from 'express';
import nodemailer from 'nodemailer';

const router = express.Router();

console.log('🔧 Email routes module loaded - checking endpoints...');

// Create email transporter
const createTransporter = () => {
  return nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
};

// Send welcome email function
const sendWelcomeEmail = async (email, name, subscription, isFounder = false) => {
  try {
    console.log('📧 Preparing to send welcome email:', { email, name, subscription, isFounder });

    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();

    const subject = isFounder 
      ? `🎉 Welcome to SoundSwap, ${name}! You're a Founder Member!`
      : `🎉 Welcome to SoundSwap, ${name}! Your ${subscription} Plan is Active`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to SoundSwap</title>
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; color: #333; line-height: 1.6; }
        .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
        .header { background: linear-gradient(135deg, #fd4e2f, #ff6b47); padding: 40px 30px; text-align: center; color: white; }
        .header h1 { margin: 0; font-size: 32px; font-weight: bold; }
        .content { padding: 40px 30px; }
        .greeting { font-size: 20px; font-weight: 600; margin-bottom: 20px; color: #333; }
        .message { font-size: 16px; margin-bottom: 30px; color: #555; }
        .features { background: #f8f9fa; border-radius: 8px; padding: 25px; margin: 30px 0; }
        .cta-button { display: inline-block; background: #fd4e2f; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; text-align: center; margin: 20px 0; }
        .footer { background: #f8f9fa; padding: 30px; text-align: center; font-size: 14px; color: #666; border-top: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1>Welcome to SoundSwap!</h1>
            <p>Your musical journey starts here</p>
        </div>
        <div class="content">
            <div class="greeting">Hey ${name}!</div>
            <div class="message">Welcome to SoundSwap - the community where musicians connect, collaborate, and grow together!</div>
            <div style="text-align: center;">
                <a href="https://soundswap.live/dashboard" class="cta-button">Start Your Musical Journey</a>
            </div>
        </div>
        <div class="footer">
            <p>© ${new Date().getFullYear()} SoundSwap. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;

    const mailOptions = {
      from: { name: 'SoundSwap', address: process.env.GMAIL_USER },
      to: email,
      subject: subject,
      html: htmlContent
    };

    console.log('📤 Sending email to:', email);
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', result.messageId);
    return result;
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    throw error;
  }
};

// Send password reset email function
const sendPasswordResetEmail = async (email, resetToken, name) => {
  try {
    console.log('📧 Preparing to send password reset email:', { email, resetToken, name });

    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();
    const clientURL = process.env.NODE_ENV === 'production' ? 'https://soundswap.live' : (process.env.CLIENT_URL || 'https://soundswap.live');
    const resetUrl = `${clientURL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset - SoundSwap</title>
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; color: #333; line-height: 1.6; }
        .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); padding: 40px 30px; text-align: center; color: white; }
        .content { padding: 40px 30px; }
        .reset-button { display: inline-block; background: #667eea; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; text-align: center; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header"><h1>Password Reset</h1></div>
        <div class="content">
            <div style="text-align: center;">
                <a href="${resetUrl}" class="reset-button">Reset Your Password</a>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    const mailOptions = {
      from: { name: 'SoundSwap', address: process.env.GMAIL_USER },
      to: email,
      subject: '🔐 Reset Your SoundSwap Password',
      html: htmlContent
    };

    console.log('📤 Sending password reset email to:', email);
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset email sent successfully');
    return result;
  } catch (error) {
    console.error('❌ Error sending password reset email:', error);
    throw error;
  }
};

// Send song reviewed notification email function
const sendSongReviewedEmail = async (email, name, songTitle, reviewerName, reviewComments, rating, songUrl) => {
  try {
    console.log('📧 Preparing to send song reviewed email:', { email, name, songTitle });

    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Song Reviewed - SoundSwap</title>
    <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa; color: #333; line-height: 1.6; }
        .email-container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); padding: 40px 30px; text-align: center; color: white; }
        .content { padding: 40px 30px; }
        .cta-button { display: inline-block; background: #667eea; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; text-align: center; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header"><h1>Your Song Got Feedback! 🎵</h1></div>
        <div class="content">
            <div style="text-align: center;">
                <a href="${songUrl}" class="cta-button">View Your Song & Response</a>
            </div>
        </div>
    </div>
</body>
</html>
    `;

    const mailOptions = {
      from: { name: 'SoundSwap', address: process.env.GMAIL_USER },
      to: email,
      subject: `🎵 Your Song "${songTitle}" Has Been Reviewed!`,
      html: htmlContent
    };

    console.log('📤 Sending song reviewed email to:', email);
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Song reviewed email sent successfully');
    return result;
  } catch (error) {
    console.error('❌ Error sending song reviewed email:', error);
    throw error;
  }
};

// ==================== ROUTE HANDLERS ====================

// Send welcome email route
export const sendWelcomeEmailHandler = async (req, res) => {
  console.log('📍 Hit /send-welcome-email endpoint');
  console.log('📨 Request body:', req.body);
  
  try {
    const { email, name, subscription, isFounder } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    await sendWelcomeEmail(email, name || 'Artist', subscription || 'Free', isFounder || false);
    
    console.log('✅ Welcome email route completed successfully');
    res.json({ success: true, message: 'Welcome email sent successfully' });
  } catch (error) {
    console.error('❌ Welcome email route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send welcome email',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Send password reset email route
export const sendPasswordResetHandler = async (req, res) => {
  console.log('📍 Hit /send-password-reset endpoint');
  console.log('📨 Request body:', req.body);
  
  try {
    const { email, resetToken, name } = req.body;

    if (!email || !resetToken) {
      return res.status(400).json({ success: false, message: 'Email and reset token are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    await sendPasswordResetEmail(email, resetToken, name || '');
    
    console.log('✅ Password reset email route completed successfully');
    res.json({ success: true, message: 'Password reset email sent successfully' });
  } catch (error) {
    console.error('❌ Password reset email route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send password reset email',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Send song reviewed notification route
export const sendSongReviewedHandler = async (req, res) => {
  console.log('📍 Hit /send-song-reviewed endpoint');
  console.log('📨 Request body:', req.body);
  
  try {
    const { email, name, songTitle, reviewerName, reviewComments, rating, songUrl } = req.body;

    if (!email || !songTitle || !songUrl) {
      return res.status(400).json({ success: false, message: 'Email, songTitle, and songUrl are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    await sendSongReviewedEmail(email, name || 'Artist', songTitle, reviewerName, reviewComments, rating, songUrl);
    
    console.log('✅ Song reviewed email route completed successfully');
    res.json({ success: true, message: 'Song reviewed notification sent successfully' });
  } catch (error) {
    console.error('❌ Song reviewed email route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send song reviewed notification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Test endpoint for email configuration
export const testEmailHandler = async (req, res) => {
  console.log('📍 Hit /test endpoint');
  
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
        'POST /api/email/send-song-reviewed',
        'GET /api/email/test'
      ]
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==================== EXPRESS ROUTES ====================

// Add route logging middleware
router.use((req, res, next) => {
  console.log(`🛣️  Email route accessed: ${req.method} ${req.path}`);
  next();
});

// Define all email routes
router.post('/send-welcome-email', sendWelcomeEmailHandler);
router.post('/send-password-reset', sendPasswordResetHandler);
router.post('/send-song-reviewed', sendSongReviewedHandler);
router.get('/test', testEmailHandler);

// Debug route to list all registered routes
router.get('/debug-routes', (req, res) => {
  const routes = router.stack
    .filter(layer => layer.route)
    .map(layer => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods)
    }));
  
  console.log('📋 Registered email routes:', routes);
  
  res.json({
    success: true,
    routes: routes,
    mountPath: '/api/email',
    fullPaths: routes.map(route => 
      route.methods.map(method => `${method.toUpperCase()} /api/email${route.path}`)
    ).flat()
  });
});

console.log('✅ Email routes registered:');
console.log('   POST /api/email/send-welcome-email');
console.log('   POST /api/email/send-password-reset'); 
console.log('   POST /api/email/send-song-reviewed');
console.log('   GET /api/email/test');
console.log('   GET /api/email/debug-routes');

export default router;