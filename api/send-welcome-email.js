import nodemailer from 'nodemailer';
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

  if (process.env.NODE_ENV === 'production') {
    options.pool = true;
    options.maxConnections = 5;
    options.maxMessages = 100;
    options.rateDelta = 1000;
    options.rateLimit = 5;
  }

  return options;
};

// Create reusable transporter object
const transporter = nodemailer.createTransport(getTransportOptions());

// Test the transporter connection
export const testEmailConnection = async () => {
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

/**
 * Send email with Nodemailer
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
 * Send welcome email to new users
 */
export const sendWelcomeEmail = async (email, name = 'Artist', subscription = 'Free', isFounder = false) => {
  try {
    const html = `
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
        .header p { margin: 10px 0 0; font-size: 18px; opacity: 0.9; }
        .content { padding: 40px 30px; }
        .greeting { font-size: 20px; font-weight: 600; margin-bottom: 20px; color: #333; }
        .message { font-size: 16px; margin-bottom: 30px; color: #555; }
        .features { background: #f8f9fa; border-radius: 8px; padding: 25px; margin: 30px 0; }
        .features h3 { margin: 0 0 15px; color: #333; font-size: 18px; }
        .feature-list { list-style: none; padding: 0; margin: 0; }
        .feature-list li { display: flex; align-items: center; margin-bottom: 12px; font-size: 15px; color: #555; }
        .feature-list li:before { content: "✓"; color: #fd4e2f; font-weight: bold; margin-right: 12px; font-size: 16px; }
        .cta-button { display: inline-block; background: #fd4e2f; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; text-align: center; margin: 20px 0; transition: background-color 0.3s ease; }
        .cta-button:hover { background: #e63946; }
        .subscription-info { background: linear-gradient(135deg, #e8f4fd, #f0f8ff); border: 2px solid #0077b6; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: center; }
        .subscription-info h4 { margin: 0 0 10px; color: #0077b6; font-size: 18px; }
        .subscription-info p { margin: 0; color: #333; font-size: 14px; }
        .footer { background: #f8f9fa; padding: 30px; text-align: center; font-size: 14px; color: #666; border-top: 1px solid #eee; }
        .footer a { color: #fd4e2f; text-decoration: none; }
        .footer a:hover { text-decoration: underline; }
        .social-links { margin: 20px 0; }
        .social-links a { display: inline-block; margin: 0 10px; color: #666; font-size: 20px; text-decoration: none; }
        @media (max-width: 600px) {
            .email-container { margin: 0; border-radius: 0; }
            .header, .content, .footer { padding: 20px; }
            .header h1 { font-size: 28px; }
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
            <div class="greeting">Hey ${name}!</div>
            
            <div class="message">
                Welcome to SoundSwap - the community where musicians connect, collaborate, and grow together!
            </div>

            ${subscription && subscription !== 'Free' ? `
            <div class="subscription-info">
                <h4>🎉 ${subscription} Plan Activated!</h4>
                <p>You now have access to all ${subscription} features.</p>
            </div>
            ` : ''}

            <div class="features">
                <h3>What you can do now:</h3>
                <ul class="feature-list">
                    <li>Upload and share your tracks with the community</li>
                    <li>Give and receive valuable feedback</li>
                    <li>Discover new music across all genres</li>
                    <li>Connect with artists who share your passion</li>
                    <li>Track your musical journey with analytics</li>
                    ${isFounder ? `
                    <li>Access exclusive Founder Circle benefits</li>
                    <li>Enjoy unlimited uploads and premium features</li>
                    ` : ''}
                </ul>
            </div>

            <div style="text-align: center;">
                <a href="${getClientURL()}/dashboard" class="cta-button">Start Your Musical Journey</a>
            </div>

            <div class="message">
                <strong>Pro tip:</strong> Complete your profile and upload your first track!
            </div>
        </div>

        <div class="footer">
            <div class="social-links">
                <a href="https://twitter.com/soundswap" title="Twitter">🐦</a>
                <a href="https://facebook.com/soundswap" title="Facebook">📘</a>
                <a href="https://instagram.com/soundswap_official" title="Instagram">📸</a>
            </div>
            
            <p>Questions? We're here to help! Reply to this email or visit our <a href="${getClientURL()}/support">Help Center</a>.</p>
            
            <p style="margin-top: 20px; color: #999; font-size: 12px;">
                © ${new Date().getFullYear()} SoundSwap. All rights reserved.
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
 * Send password reset email
 */
export const sendPasswordResetEmail = async (email, resetUrl, name = '') => {
  try {
    const html = `
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
        .header h1 { margin: 0; font-size: 32px; font-weight: bold; }
        .content { padding: 40px 30px; }
        .greeting { font-size: 20px; font-weight: 600; margin-bottom: 20px; color: #333; }
        .message { font-size: 16px; margin-bottom: 30px; color: #555; }
        .reset-button { display: inline-block; background: #667eea; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; text-align: center; margin: 20px 0; transition: background-color 0.3s ease; }
        .reset-button:hover { background: #5a6fd8; }
        .footer { background: #f8f9fa; padding: 30px; text-align: center; font-size: 14px; color: #666; border-top: 1px solid #eee; }
        .footer a { color: #667eea; text-decoration: none; }
        .footer a:hover { text-decoration: underline; }
        @media (max-width: 600px) {
            .email-container { margin: 0; border-radius: 0; }
            .header, .content, .footer { padding: 20px; }
            .header h1 { font-size: 28px; }
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
            <div class="greeting">Hi ${name || 'there'},</div>
            
            <div class="message">
                You recently requested to reset your password for your SoundSwap account.
            </div>

            <div style="text-align: center;">
                <a href="${resetUrl}" class="reset-button">Reset Your Password</a>
            </div>

            <div class="message">
                If you did not request a password reset, please ignore this email.
            </div>
        </div>

        <div class="footer">
            <p>Questions? We're here to help! Reply to this email or visit our <a href="${getClientURL()}/support">Help Center</a>.</p>
            
            <p style="margin-top: 20px; color: #999; font-size: 12px;">
                © ${new Date().getFullYear()} SoundSwap. All rights reserved.
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

  add(emailOptions, retryCount = 0) {
    this.queue.push({ options: emailOptions, retryCount });
    
    if (!this.processing) {
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const { options, retryCount } = this.queue.shift();

    try {
      await transporter.sendMail(options);
      console.log(`✅ Email sent to ${options.to} (Production Queue)`);
      setTimeout(() => this.processQueue(), 1000);
    } catch (error) {
      console.error(`❌ Failed to send email to ${options.to}:`, error);
      
      if (retryCount < this.maxRetries) {
        console.log(`🔄 Retrying email to ${options.to} (${retryCount + 1}/${this.maxRetries})`);
        this.add(options, retryCount + 1);
      } else {
        console.error(`❌ Failed to send email to ${options.to} after ${this.maxRetries} attempts`);
      }
      
      setTimeout(() => this.processQueue(), 2000);
    }
  }
}

// Create email queue instance for production
const emailQueue = new EmailQueue();