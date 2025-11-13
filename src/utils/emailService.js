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
    // Handle template path differently for production
    let templatePath;
    if (process.env.NODE_ENV === 'production') {
      // In production, templates might be in different locations
      // Check if path from project root works
      templatePath = path.join(process.cwd(), 'templates', `${templateName}.hbs`);
      
      // Alternative paths if needed
      if (!await fileExists(templatePath)) {
        // Try alternative paths
        const alternatives = [
          path.join(process.cwd(), 'dist', 'templates', `${templateName}.hbs`),
          path.join(process.cwd(), 'build', 'templates', `${templateName}.hbs`)
        ];
        
        for (const alt of alternatives) {
          if (await fileExists(alt)) {
            templatePath = alt;
            break;
          }
        }
      }
    } else {
      // Development path
      templatePath = path.join(process.cwd(), 'templates', `${templateName}.hbs`);
    }
    
    console.log(`📄 Loading template from: ${templatePath}`);
    const source = await readFile(templatePath, 'utf8');
    const template = Handlebars.compile(source);
    return template(data);
  } catch (error) {
    console.error(`❌ Failed to render template '${templateName}':`, error);
    // Fallback to a basic template if needed
    return generateFallbackTemplate(templateName, data);
  }
}

// Helper to check if file exists
async function fileExists(filepath) {
  try {
    await readFile(filepath);
    return true;
  } catch {
    return false;
  }
}

// Generate a simple fallback template in case the .hbs file can't be found
function generateFallbackTemplate(templateName, data) {
  if (templateName === 'password-reset') {
    return `
      <h2>Reset Your SoundSwap Password</h2>
      <p>Hello ${data.name || 'there'},</p>
      <p>Click the link below to reset your password:</p>
      <p><a href="${data.resetUrl}">Reset Password</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
    `;
  }
  
  if (templateName === 'welcome') {
    return `
      <h2>Welcome to SoundSwap!</h2>
      <p>Hello ${data.name || 'Artist'},</p>
      <p>Thank you for joining SoundSwap with a ${data.subscription || 'Free'} subscription.</p>
      <p><a href="${data.dashboardUrl}">Go to Dashboard</a></p>
    `;
  }
  
  return `
    <h2>SoundSwap Notification</h2>
    <p>This is an automated message from SoundSwap.</p>
  `;
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
  const html = await renderTemplate('founderActivation', {
    name,
    dashboardUrl: getClientURL() + '/dashboard'
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
    // Use inline HTML template instead of file template for reliability
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to SoundSwap</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #f8f9fa;
            color: #333;
            line-height: 1.6;
        }
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .header {
            background: linear-gradient(135deg, #fd4e2f, #ff6b47);
            padding: 40px 30px;
            text-align: center;
            color: white;
        }
        .header h1 {
            margin: 0;
            font-size: 32px;
            font-weight: bold;
        }
        .header p {
            margin: 10px 0 0;
            font-size: 18px;
            opacity: 0.9;
        }
        .content {
            padding: 40px 30px;
        }
        .greeting {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 20px;
            color: #333;
        }
        .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #555;
        }
        .features {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 25px;
            margin: 30px 0;
        }
        .features h3 {
            margin: 0 0 15px;
            color: #333;
            font-size: 18px;
        }
        .feature-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .feature-list li {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
            font-size: 15px;
            color: #555;
        }
        .feature-list li:before {
            content: "✓";
            color: #fd4e2f;
            font-weight: bold;
            margin-right: 12px;
            font-size: 16px;
        }
        .cta-button {
            display: inline-block;
            background: #fd4e2f;
            color: white;
            padding: 14px 30px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            text-align: center;
            margin: 20px 0;
            transition: background-color 0.3s ease;
        }
        .cta-button:hover {
            background: #e63946;
        }
        .subscription-info {
            background: linear-gradient(135deg, #e8f4fd, #f0f8ff);
            border: 2px solid #0077b6;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            text-align: center;
        }
        .subscription-info h4 {
            margin: 0 0 10px;
            color: #0077b6;
            font-size: 18px;
        }
        .subscription-info p {
            margin: 0;
            color: #333;
            font-size: 14px;
        }
        .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            font-size: 14px;
            color: #666;
            border-top: 1px solid #eee;
        }
        .footer a {
            color: #fd4e2f;
            text-decoration: none;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        .social-links {
            margin: 20px 0;
        }
        .social-links a {
            display: inline-block;
            margin: 0 10px;
            color: #666;
            font-size: 20px;
            text-decoration: none;
        }
        @media (max-width: 600px) {
            .email-container {
                margin: 0;
                border-radius: 0;
            }
            .header, .content, .footer {
                padding: 20px;
            }
            .header h1 {
                font-size: 28px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1>Welcome to SoundSwap!</h1>
            <p>Your musical journey starts here</p>
        </div>
        
        <div class="content">
            <div class="greeting">
                Hey ${name}!
            </div>
            
            <div class="message">
                Welcome to SoundSwap - the community where musicians connect, collaborate, and grow together! We're thrilled to have you join our vibrant community of artists, producers, and music lovers.
            </div>

            ${subscription && subscription !== 'Free' ? `
            <div class="subscription-info">
                <h4>🎉 ${subscription} Plan Activated!</h4>
                <p>You now have access to all ${subscription} features. Start exploring your enhanced music experience!</p>
            </div>
            ` : ''}

            <div class="features">
                <h3>What you can do now:</h3>
                <ul class="feature-list">
                    <li>Upload and share your tracks with the community</li>
                    <li>Give and receive valuable feedback from fellow musicians</li>
                    <li>Discover new music across all genres</li>
                    <li>Connect with artists who share your passion</li>
                    <li>Track your musical journey with detailed analytics</li>
                    ${isFounder ? `
                    <li>Access exclusive Founder Circle benefits</li>
                    <li>Enjoy unlimited uploads and premium features</li>
                    ` : ''}
                </ul>
            </div>

            <div style="text-align: center;">
                <a href="${getClientURL()}/dashboard" class="cta-button">
                    Start Your Musical Journey
                </a>
            </div>

            <div class="message">
                <strong>Pro tip:</strong> Complete your profile and upload your first track to make the most of your SoundSwap experience. The community is here to support your musical growth!
            </div>
        </div>

        <div class="footer">
            <div class="social-links">
                <a href="https://twitter.com/soundswap" title="Follow us on Twitter">🐦</a>
                <a href="https://facebook.com/soundswap" title="Like us on Facebook">📘</a>
                <a href="https://instagram.com/soundswap_official" title="Follow us on Instagram">📸</a>
            </div>
            
            <p>
                Questions? We're here to help! Reply to this email or visit our 
                <a href="${getClientURL()}/support">Help Center</a>.
            </p>
            
            <p>
                <a href="${getClientURL()}/dashboard">Dashboard</a> | 
                <a href="${getClientURL()}/settings">Account Settings</a> | 
                <a href="${getClientURL()}/unsubscribe">Unsubscribe</a>
            </p>
            
            <p style="margin-top: 20px; color: #999; font-size: 12px;">
                © ${new Date().getFullYear()} SoundSwap. All rights reserved.<br>
                You're receiving this email because you signed up for SoundSwap.
            </p>
        </div>
    </div>
</body>
</html>
    `;

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
 * @param {string} resetUrl - Password reset URL with token
 * @param {string} name - User name (optional)
 */
export const sendPasswordResetEmail = async (email, resetUrl, name = '') => {
  try {
    // Use inline HTML template instead of file template for reliability
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset - SoundSwap</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: #f8f9fa;
            color: #333;
            line-height: 1.6;
        }
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            padding: 40px 30px;
            text-align: center;
            color: white;
        }
        .header h1 {
            margin: 0;
            font-size: 32px;
            font-weight: bold;
        }
        .content {
            padding: 40px 30px;
        }
        .greeting {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 20px;
            color: #333;
        }
        .message {
            font-size: 16px;
            margin-bottom: 30px;
            color: #555;
        }
        .reset-button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 14px 30px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
            text-align: center;
            margin: 20px 0;
            transition: background-color 0.3s ease;
        }
        .reset-button:hover {
            background: #5a6fd8;
        }
        .footer {
            background: #f8f9fa;
            padding: 30px;
            text-align: center;
            font-size: 14px;
            color: #666;
            border-top: 1px solid #eee;
        }
        .footer a {
            color: #667eea;
            text-decoration: none;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        @media (max-width: 600px) {
            .email-container {
                margin: 0;
                border-radius: 0;
            }
            .header, .content, .footer {
                padding: 20px;
            }
            .header h1 {
                font-size: 28px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <div class="header">
            <h1>Password Reset</h1>
            <p>We got a request to reset your password</p>
        </div>
        
        <div class="content">
            <div class="greeting">
                Hi ${name || 'there'},
            </div>
            
            <div class="message">
                You recently requested to reset your password for your SoundSwap account. Click the button below to reset it.
            </div>

            <div style="text-align: center;">
                <a href="${resetUrl}" class="reset-button">
                    Reset Your Password
                </a>
            </div>

            <div class="message">
                If you did not request a password reset, please ignore this email. This password reset link is only valid for the next 60 minutes.
            </div>

            <div class="message">
                <strong>Note:</strong> If the button above doesn't work, copy and paste the following link into your browser:
                <br>
                <a href="${resetUrl}">${resetUrl}</a>
            </div>
        </div>

        <div class="footer">
            <p>
                Questions? We're here to help! Reply to this email or visit our 
                <a href="${getClientURL()}/support">Help Center</a>.
            </p>
            
            <p style="margin-top: 20px; color: #999; font-size: 12px;">
                © ${new Date().getFullYear()} SoundSwap. All rights reserved.<br>
                You're receiving this email because you requested a password reset for your SoundSwap account.
            </p>
        </div>
    </div>
</body>
</html>
    `;

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
      message: 'Email service is operational'
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