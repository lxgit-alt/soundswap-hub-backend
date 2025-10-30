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
    const html = await renderTemplate('welcome', {
      name,
      subscription: subscription.charAt(0).toUpperCase() + subscription.slice(1),
      isFounder,
      dashboardUrl: getClientURL() + '/dashboard',
      supportUrl: getClientURL() + '/support',
      settingsUrl: getClientURL() + '/settings',
      unsubscribeUrl: getClientURL() + '/unsubscribe'
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
    console.log(`Welcome email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Welcome email send error:', error);
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
    const html = await renderTemplate('password-reset', {
      name,
      resetUrl,
      loginUrl: getClientURL() + '/login',
      supportUrl: getClientURL() + '/support',
      settingsUrl: getClientURL() + '/settings'
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
    console.log(`Password reset email sent to ${email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('Password reset email send error:', error);
    throw new Error('Failed to send password reset email');
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