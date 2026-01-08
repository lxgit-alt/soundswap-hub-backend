import express from 'express';

const router = express.Router();

console.log('[INFO] 🔧 Email routes module loaded - checking endpoints...');

// ==================== LAZY LOADING CONFIGURATION ====================

let isEmailLoaded = false;
let isTemplatesLoaded = false;

// Lazy loaded dependencies
let nodemailer = null;
let Handlebars = null;

// Utility functions that will be defined after lazy loading
let createTransporter = null;
let getClientURL = null;
let renderTemplate = null;
let sendWelcomeEmail = null;
let sendPasswordResetEmail = null;
let sendSongReviewedEmail = null;
let sendTop10ChartEmail = null;

// ==================== IMMEDIATE FUNCTIONS ====================
// These don't need any imports

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

// ==================== LAZY LOAD HELPER ====================

const loadEmailModules = async () => {
  if (!isEmailLoaded) {
    console.log('[INFO] 📧 Email: Lazy loading nodemailer and templates');
    
    // Dynamically import dependencies
    const nodemailerModule = await import('nodemailer');
    const fsModule = await import('fs/promises');
    const pathModule = await import('path');
    const handlebarsModule = await import('handlebars');
    
    nodemailer = nodemailerModule.default;
    Handlebars = handlebarsModule.default;
    
    // Now define functions that use these modules
    createTransporter = () => {
      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_PASS,
        },
      });
    };

    getClientURL = () => {
      if (process.env.NODE_ENV === 'production') {
        return 'https://soundswap.live';
      }
      return process.env.CLIENT_URL || 'https://soundswap.live';
    };

    renderTemplate = async (templateName, data) => {
      try {
        const templatePath = pathModule.join(process.cwd(), 'templates', `${templateName}.hbs`);
        
        const source = await fsModule.readFile(templatePath, 'utf8');
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
        console.error(`[ERROR] ❌ Failed to render template '${templateName}':`, error);
        throw new Error(`Template '${templateName}' not found or invalid`);
      }
    };

    sendWelcomeEmail = async (email, name, subscription, isFounder = false) => {
      try {
        console.log('[INFO] 📧 Preparing to send welcome email:', { email, name, subscription, isFounder });

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

        console.log('[INFO] 📤 Sending email to:', email);
        const result = await transporter.sendMail(mailOptions);
        console.log('[INFO] ✅ Email sent successfully:', result.messageId);
        return result;
      } catch (error) {
        console.error('[ERROR] ❌ Error sending welcome email:', error);
        throw error;
      }
    };

    sendPasswordResetEmail = async (email, resetToken, name) => {
      try {
        console.log('[INFO] 📧 Preparing to send password reset email:', { email, resetToken, name });

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

        console.log('[INFO] 📤 Sending password reset email to:', email);
        const result = await transporter.sendMail(mailOptions);
        console.log('[INFO] ✅ Password reset email sent successfully');
        return result;
      } catch (error) {
        console.error('[ERROR] ❌ Error sending password reset email:', error);
        throw error;
      }
    };

    sendSongReviewedEmail = async (email, name, songTitle, reviewerName, reviewComments, rating, songUrl) => {
      try {
        console.log('[INFO] 📧 Preparing to send song reviewed email:', { email, name, songTitle });

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

        console.log('[INFO] 📤 Sending song reviewed email to:', email);
        const result = await transporter.sendMail(mailOptions);
        console.log('[INFO] ✅ Song reviewed email sent successfully');
        return result;
      } catch (error) {
        console.error('[ERROR] ❌ Error sending song reviewed email:', error);
        throw error;
      }
    };

    sendTop10ChartEmail = async (
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
        console.log('[INFO] 📧 Preparing to send top 10 chart email:', { email, name, position, trackTitle });

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

        console.log('[INFO] 📤 Sending top 10 chart email to:', email);
        const result = await transporter.sendMail(mailOptions);
        console.log('[INFO] ✅ Top 10 chart email sent successfully');
        return result;
      } catch (error) {
        console.error('[ERROR] ❌ Error sending top 10 chart email:', error);
        throw error;
      }
    };

    isEmailLoaded = true;
    isTemplatesLoaded = true;
    console.log('[INFO] 📧 Email: All modules loaded successfully');
  }
};

// ==================== ROUTE HANDLERS ====================

// Send welcome email route
const sendWelcomeEmailHandler = async (req, res) => {
  console.log('[INFO] 📍 Hit /send-welcome-email endpoint');
  
  try {
    const { email, name, subscription, isFounder } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    // Lazy load email modules if not already loaded
    if (!isEmailLoaded) {
      await loadEmailModules();
    }

    await sendWelcomeEmail(email, name || 'Artist', subscription || 'Free', isFounder || false);
    
    console.log('[INFO] ✅ Welcome email route completed successfully');
    res.json({ success: true, message: 'Welcome email sent successfully' });
  } catch (error) {
    console.error('[ERROR] ❌ Welcome email route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send welcome email',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Send password reset email route
const sendPasswordResetHandler = async (req, res) => {
  console.log('[INFO] 📍 Hit /send-password-reset endpoint');
  
  try {
    const { email, resetToken, name } = req.body;

    if (!email || !resetToken) {
      return res.status(400).json({ success: false, message: 'Email and reset token are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    // Lazy load email modules if not already loaded
    if (!isEmailLoaded) {
      await loadEmailModules();
    }

    await sendPasswordResetEmail(email, resetToken, name || '');
    
    console.log('[INFO] ✅ Password reset email route completed successfully');
    res.json({ success: true, message: 'Password reset email sent successfully' });
  } catch (error) {
    console.error('[ERROR] ❌ Password reset email route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send password reset email',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Send song reviewed notification route
const sendSongReviewedHandler = async (req, res) => {
  console.log('[INFO] 📍 Hit /send-song-reviewed endpoint');
  
  try {
    const { email, name, songTitle, reviewerName, reviewComments, rating, songUrl } = req.body;

    if (!email || !songTitle || !songUrl) {
      return res.status(400).json({ success: false, message: 'Email, songTitle, and songUrl are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    // Lazy load email modules if not already loaded
    if (!isEmailLoaded) {
      await loadEmailModules();
    }

    await sendSongReviewedEmail(email, name || 'Artist', songTitle, reviewerName, reviewComments, rating, songUrl);
    
    console.log('[INFO] ✅ Song reviewed email route completed successfully');
    res.json({ success: true, message: 'Song reviewed notification sent successfully' });
  } catch (error) {
    console.error('[ERROR] ❌ Song reviewed email route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send song reviewed notification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Send top 10 chart notification route
const sendTop10ChartHandler = async (req, res) => {
  console.log('[INFO] 📍 Hit /send-top10-chart endpoint');
  
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

    // Lazy load email modules if not already loaded
    if (!isEmailLoaded) {
      await loadEmailModules();
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
    
    console.log('[INFO] ✅ Top 10 chart email route completed successfully');
    res.json({ success: true, message: 'Top 10 chart notification sent successfully' });
  } catch (error) {
    console.error('[ERROR] ❌ Top 10 chart email route error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send top 10 chart notification',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Test endpoint for email configuration
const testEmailHandler = async (req, res) => {
  console.log('[INFO] 📍 Hit /test endpoint');
  
  try {
    const hasEmailConfig = !!(process.env.GMAIL_USER && process.env.GMAIL_PASS);
    
    res.json({
      success: true,
      email_configured: hasEmailConfig,
      email_user: process.env.GMAIL_USER ? 'Configured' : 'Not set',
      node_env: process.env.NODE_ENV,
      lazy_loading_status: {
        email_modules: isEmailLoaded ? 'LOADED' : 'NOT LOADED',
        templates: isTemplatesLoaded ? 'LOADED' : 'NOT LOADED'
      },
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
    console.error('[ERROR] ❌ Test endpoint error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ==================== EXPRESS ROUTES ====================

// Add route logging middleware
router.use((req, res, next) => {
  console.log(`[INFO] 🛣️  Email route accessed: ${req.method} ${req.path}`);
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
  
  console.log('[INFO] 📋 Registered email routes:', routes);
  
  res.json({
    success: true,
    routes: routes,
    mountPath: '/api/email',
    fullPaths: routes.map(route => 
      route.methods.map(method => `${method.toUpperCase()} /api/email${route.path}`)
    ).flat(),
    templates_used: ['welcome.hbs', 'password-reset.hbs', 'song-reviewed.hbs', 'top10-chart.hbs'],
    lazy_loading: {
      enabled: true,
      email_modules: isEmailLoaded ? 'loaded' : 'not loaded',
      status: 'Modules will load when first email route is called'
    }
  });
});

console.log('[INFO] ✅ Email routes registered:');
console.log('[INFO]    POST /api/email/send-welcome-email');
console.log('[INFO]    POST /api/email/send-password-reset'); 
console.log('[INFO]    POST /api/email/send-song-reviewed');
console.log('[INFO]    POST /api/email/send-top10-chart');
console.log('[INFO]    GET /api/email/test');
console.log('[INFO]    GET /api/email/debug-routes');
console.log('[INFO] 📧 Using Handlebars templates: welcome.hbs, password-reset.hbs, song-reviewed.hbs, top10-chart.hbs');
console.log('[INFO] 🔄 Email modules will lazy load on first use to improve startup time');

export default router;