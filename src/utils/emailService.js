import nodemailer from 'nodemailer';
import { readFile } from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';
import dotenv from 'dotenv';

dotenv.config();

// Set client URL based on environment
const getClientURL = () => {
  if (process.env.NODE_ENV === 'production') {
    return 'https://soundswap.live';
  }
  return process.env.CLIENT_URL || 'https://soundswap.live';
};

// Set email sending retry options for production
const getTransportOptions = () => {
  const options = {
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  };

  // Add production-specific settings
  if (process.env.NODE_ENV === 'production') {
    options.pool = true; // Use pooled connections
    options.maxConnections = 5; // Limit connections
    options.maxMessages = 100; // Limit messages per connection
    options.rateDelta = 1000; // 1 second
    options.rateLimit = 5; // 5 messages per second (to avoid Gmail limits)
  }

  return options;
};

// Create reusable transporter object
const transporter = nodemailer.createTransport(getTransportOptions());

// Test the transporter connection
const testEmailConnection = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email server connection verified');
    console.log('📧 Using email:', process.env.GMAIL_USER);
    return true;
  } catch (error) {
    console.error('❌ Email server connection failed:', error);
    console.error('📧 Check your GMAIL_USER and GMAIL_PASS environment variables');
    return false;
  }
};

// Test connection on startup
testEmailConnection();

// Utility to load and compile a Handlebars template (async)
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

/**
 * Send email with Nodemailer
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML email content
 * @returns {Promise}
 */
export const sendEmail = async ({ to, subject, html }) => {
  const mailOptions = {
    from: `SoundSwap <${process.env.GMAIL_USER}>`,
    replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER,
    to,
    subject,
    html
  };

  try {
    // In production, add to queue; otherwise send directly
    if (process.env.NODE_ENV === 'production') {
      emailQueue.add(mailOptions);
      return { queued: true, to };
    } else {
      const info = await transporter.sendMail(mailOptions);
      console.log(`Email sent to ${to}: ${info.messageId}`);
      return info;
    }
  } catch (error) {
    console.error('Email send error:', error);
    throw new Error('Failed to send email');
  }
};

/**
 * Send founder activation email
 * @param {string} email - Recipient email
 * @param {string} name - User name
 */
export const sendFounderActivationEmail = async (email, name = 'Artist') => {
  const html = await renderTemplate('welcome', {
    name,
    subscription: 'Founder',
    isFounder: true
  });

  const mailOptions = {
    from: `SoundSwap <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Welcome to SoundSwap Founders Circle!',
    html
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Email send error:', error);
    throw new Error('Failed to send email');
  }
};

/**
 * Send welcome email to new users
 * @param {string} email - User email
 * @param {string} name - User name
 * @param {string} subscription - User subscription tier
 * @param {boolean} isFounder - Whether user is a founder
 */
export const sendWelcomeEmail = async (email, name = 'Artist', subscription = 'Free', isFounder = false) => {
  try {
    const html = await renderTemplate('welcome', {
      name,
      subscription,
      isFounder
    });

    const subject = `Welcome to SoundSwap, ${name}! Your musical journey begins now`;

    const mailOptions = {
      from: `SoundSwap <${process.env.GMAIL_USER}>`,
      replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER,
      to: email,
      subject,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Welcome email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('❌ Welcome email send error:', error);
    throw new Error('Failed to send welcome email');
  }
};

/**
 * Send audit alert email
 * @param {string} email - Admin email
 * @param {Array} issues - List of issues
 * @param {string} founderEmail - Affected founder email
 */
export const sendAuditAlertEmail = async (email, issues, founderEmail) => {
  const subject = `🚨 SoundSwap Audit Alert: Issues with ${founderEmail}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #f8f9fa; padding: 30px; border-radius: 10px;">
        <h2 style="color: #d33a3a; text-align: center;">Founder Benefits Audit Alert</h2>
        <div style="background: white; border-radius: 8px; padding: 25px; margin: 20px 0;">
          <p><strong>Affected Founder:</strong> ${founderEmail}</p>
          <h3 style="color: #333; margin-top: 25px;">Missing Benefits:</h3>
          <ul style="padding-left: 20px;">
            ${issues.map(issue => `<li>${issue}</li>`).join('')}
          </ul>
          <div style="margin-top: 30px; background: #fff8f8; border-left: 4px solid #d33a3a; padding: 10px 15px;">
            <p>Please investigate and manually resolve these issues in the Firestore database.</p>
          </div>
        </div>
        <div style="text-align: center; margin-top: 30px;">
          <a href="${getClientURL()}/admin/users/${encodeURIComponent(founderEmail)}" 
            style="color: #d3a373; font-weight: bold;">
            View User in Admin Dashboard
          </a>
        </div>
      </div>
    </div>
  `;

  return sendEmail({ to: email, subject, html });
};

/**
 * Send password reset email
 * @param {string} email - User email address
 * @param {string} resetToken - Password reset token
 * @param {string} name - User name (optional)
 */
export const sendPasswordResetEmail = async (email, resetToken, name = '') => {
  try {
    const resetUrl = `${getClientURL()}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    const html = await renderTemplate('password-reset', {
      name,
      resetUrl
    });

    const subject = 'Reset Your SoundSwap Password';

    const mailOptions = {
      from: `SoundSwap <${process.env.GMAIL_USER}>`,
      replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER,
      to: email,
      subject,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('❌ Password reset email send error:', error);
    throw new Error('Failed to send password reset email');
  }
};

/**
 * Send song reviewed notification email
 * @param {string} email - User email
 * @param {string} name - User name
 * @param {string} songTitle - Song title
 * @param {string} reviewerName - Reviewer's name
 * @param {string} reviewComments - Review comments
 * @param {number} rating - Rating (0-5)
 * @param {string} songUrl - URL to the song
 */
export const sendSongReviewedEmail = async (email, name = 'Artist', songTitle, reviewerName, reviewComments, rating, songUrl) => {
  try {
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

    const subject = `🎵 Your Song "${songTitle}" Has Been Reviewed!`;

    const mailOptions = {
      from: `SoundSwap <${process.env.GMAIL_USER}>`,
      replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER,
      to: email,
      subject,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Song reviewed email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('❌ Song reviewed email send error:', error);
    throw new Error('Failed to send song reviewed email');
  }
};

/**
 * Send top 10 chart notification email
 * @param {string} email - User email
 * @param {string} name - User name
 * @param {number} position - Chart position (1-10)
 * @param {string} trackTitle - Track title
 * @param {string} trackGenre - Track genre
 * @param {number} trackScore - Track score
 * @param {number} averageRating - Average rating
 * @param {number} ratingCount - Number of ratings
 * @param {number} pairingEngagement - Pairing engagement count
 * @param {number} uniqueReviewers - Number of unique reviewers
 * @param {number} pointsAwarded - Points awarded for chart position
 * @param {string} chartWeek - Chart week (e.g., "January 15-21, 2024")
 * @param {Array} chartData - Top 10 chart data
 */
export const sendTop10ChartEmail = async (
  email, 
  name = 'Artist', 
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
      from: `SoundSwap <${process.env.GMAIL_USER}>`,
      replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER,
      to: email,
      subject,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Top 10 chart email sent to ${email} for position #${position}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('❌ Top 10 chart email send error:', error);
    throw new Error('Failed to send top 10 chart email');
  }
};

// Serverless function to test email configuration
export const testEmailServiceHandler = async (req, res) => {
  try {
    const hasEmailConfig = !!(process.env.GMAIL_USER && process.env.GMAIL_PASS);
    const connectionVerified = await testEmailConnection();
    
    res.json({
      success: true,
      email_configured: hasEmailConfig,
      connection_verified: connectionVerified,
      email_user: process.env.GMAIL_USER ? 'Configured' : 'Not set',
      node_env: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      message: 'Email service is operational',
      templates_available: ['welcome', 'password-reset', 'song-reviewed', 'top10-chart']
    });
  } catch (error) {
    console.error('Email service test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Simple email queue with retry for production
class EmailQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxRetries = 3;
  }

  // Add email to queue
  add(emailOptions, retryCount = 0) {
    this.queue.push({ options: emailOptions, retryCount });
    
    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }
  }

  // Process the email queue
  async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const { options, retryCount } = this.queue.shift();

    try {
      // Try to send the email
      await transporter.sendMail(options);
      console.log(`✅ Email sent to ${options.to} (Production Queue)`);
      
      // Process next item in queue
      setTimeout(() => this.processQueue(), 1000); // Rate limiting
    } catch (error) {
      console.error(`❌ Failed to send email to ${options.to}:`, error);
      
      // Retry if under max retries
      if (retryCount < this.maxRetries) {
        console.log(`🔄 Retrying email to ${options.to} (${retryCount + 1}/${this.maxRetries})`);
        this.add(options, retryCount + 1);
      } else {
        console.error(`❌ Failed to send email to ${options.to} after ${this.maxRetries} attempts`);
      }
      
      // Continue processing queue
      setTimeout(() => this.processQueue(), 2000); // Longer delay after error
    }
  }
}

// Create email queue instance for production
const emailQueue = new EmailQueue();