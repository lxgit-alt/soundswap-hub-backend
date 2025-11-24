import express from 'express';
import nodemailer from 'nodemailer';
import { readFile } from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';

const router = express.Router();

console.log('🔧 Email routes module loaded - checking endpoints...');

// Create email transporter - FIXED: use createTransport not createTransporter
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
};

// Set client URL based on environment
const getClientURL = () => {
  if (process.env.NODE_ENV === 'production') {
    return 'https://soundswap.live';
  }
  return process.env.CLIENT_URL || 'https://soundswap.live';
};

// Utility to load and compile a Handlebars template
async function renderTemplate(templateName, data) {
  try {
    const templatePath = path.join(process.cwd(), 'templates', `${templateName}.hbs`);
    console.log(`📄 Loading template from: ${templatePath}`);
    
    const source = await readFile(templatePath, 'utf8');
    const template = Handlebars.compile(source);
    
    // Default data for all templates
    const templateData = {
      dashboardUrl: `${getClientURL()}/dashboard`,
      supportUrl: `${getClientURL()}/support`,
      settingsUrl: `${getClientURL()}/settings`,
      unsubscribeUrl: `${getClientURL()}/unsubscribe`,
      loginUrl: `${getClientURL()}/login`,
      chartsUrl: `${getClientURL()}/charts`,
      twitterUrl: 'https://twitter.com/soundswap',
      facebookUrl: 'https://facebook.com/soundswap',
      instagramUrl: 'https://instagram.com/soundswap_official',
      youtubeUrl: 'https://youtube.com/soundswap',
      ...data
    };
    
    return template(templateData);
  } catch (error) {
    console.error(`❌ Failed to render template '${templateName}':`, error);
    throw new Error(`Template '${templateName}' not found or invalid`);
  }
}

// Send welcome email function
const sendWelcomeEmail = async (email, name, subscription, isFounder = false) => {
  try {
    console.log('📧 Preparing to send welcome email:', { email, name, subscription, isFounder });

    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();

    const html = await renderTemplate('welcome', {
      name,
      subscription,
      isFounder
    });

    const subject = isFounder 
      ? `🎉 Welcome to SoundSwap, ${name}! You're a Founder Member!`
      : `🎉 Welcome to SoundSwap, ${name}! Your ${subscription} Plan is Active`;

    const mailOptions = {
      from: { name: 'SoundSwap', address: process.env.GMAIL_USER },
      to: email,
      subject: subject,
      html: html
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
    const resetUrl = `${getClientURL()}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    const html = await renderTemplate('password-reset', {
      name,
      resetUrl
    });

    const mailOptions = {
      from: { name: 'SoundSwap', address: process.env.GMAIL_USER },
      to: email,
      subject: '🔐 Reset Your SoundSwap Password',
      html: html
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

    // Register star rating helper for Handlebars
    Handlebars.registerHelper('stars', function(rating) {
      const fullStars = Math.round(rating);
      const stars = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars);
      return new Handlebars.SafeString(stars);
    });

    const html = await renderTemplate('song-reviewed', {
      name,
      songTitle,
      reviewerName,
      reviewComments,
      rating,
      songUrl
    });

    const mailOptions = {
      from: { name: 'SoundSwap', address: process.env.GMAIL_USER },
      to: email,
      subject: `🎵 Your Song "${songTitle}" Has Been Reviewed!`,
      html: html
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

// Send top 10 chart notification email function
const sendTop10ChartEmail = async (
  email, 
  name, 
  position, 
  trackTitle, 
  trackGenre, 
  trackScore, 
  averageRating, 
  ratingCount, 
  pairingEngagement, 
  uniqueReviewers, 
  pointsAwarded, 
  chartWeek,
  chartData = []
) => {
  try {
    console.log('📧 Preparing to send top 10 chart email:', { email, name, position, trackTitle });

    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();

    const html = await renderTemplate('top10-chart', {
      name,
      position,
      trackTitle,
      trackGenre,
      trackScore: trackScore.toFixed(1),
      averageRating: averageRating.toFixed(1),
      ratingCount,
      pairingEngagement,
      uniqueReviewers,
      pointsAwarded,
      chartWeek,
      chartData,
      chartUrl: `${getClientURL()}/charts`
    });

    const positionEmoji = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : '🎵';
    const subject = `${positionEmoji} Congratulations! You're #${position} in SoundSwap Charts!`;

    const mailOptions = {
      from: { name: 'SoundSwap', address: process.env.GMAIL_USER },
      to: email,
      subject,
      html
    };

    console.log('📤 Sending top 10 chart email to:', email);
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Top 10 chart email sent successfully');
    return result;
  } catch (error) {
    console.error('❌ Error sending top 10 chart email:', error);
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

// Send top 10 chart notification route
export const sendTop10ChartHandler = async (req, res) => {
  console.log('📍 Hit /send-top10-chart endpoint');
  console.log('📨 Request body:', req.body);
  
  try {
    const { 
      email, 
      name, 
      position, 
      trackTitle, 
      trackGenre, 
      trackScore, 
      averageRating, 
      ratingCount, 
      pairingEngagement, 
      uniqueReviewers, 
      pointsAwarded, 
      chartWeek,
      chartData 
    } = req.body;

    // Validate required fields
    if (!email || !position || !trackTitle) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, position, and trackTitle are required' 
      });
    }

    // Validate position is between 1-10
    if (position < 1 || position > 10) {
      return res.status(400).json({ 
        success: false, 
        message: 'Position must be between 1 and 10' 
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    await sendTop10ChartEmail(
      email,
      name || 'Artist',
      position,
      trackTitle,
      trackGenre || 'Unknown',
      trackScore || 0,
      averageRating || 0,
      ratingCount || 0,
      pairingEngagement || 0,
      uniqueReviewers || 0,
      pointsAwarded || 0,
      chartWeek || getCurrentWeekRange(),
      chartData || []
    );
    
    console.log('✅ Top 10 chart email route completed successfully');
    res.json({ success: true, message: 'Top 10 chart notification sent successfully' });
  } catch (error) {
    console.error('❌ Top 10 chart email route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send top 10 chart notification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to get current week range
const getCurrentWeekRange = () => {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  
  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };
  
  return `${formatDate(startOfWeek)} - ${formatDate(endOfWeek)}`;
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
        'POST /api/email/send-top10-chart',
        'GET /api/email/test'
      ],
      templates_used: ['welcome.hbs', 'password-reset.hbs', 'song-reviewed.hbs', 'top10-chart.hbs']
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
router.post('/send-top10-chart', sendTop10ChartHandler);
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
    ).flat(),
    templates_used: ['welcome.hbs', 'password-reset.hbs', 'song-reviewed.hbs', 'top10-chart.hbs']
  });
});

console.log('✅ Email routes registered:');
console.log('   POST /api/email/send-welcome-email');
console.log('   POST /api/email/send-password-reset'); 
console.log('   POST /api/email/send-song-reviewed');
console.log('   POST /api/email/send-top10-chart');
console.log('   GET /api/email/test');
console.log('   GET /api/email/debug-routes');
console.log('📧 Using Handlebars templates: welcome.hbs, password-reset.hbs, song-reviewed.hbs, top10-chart.hbs');

export default router;