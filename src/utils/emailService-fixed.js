import nodemailer from 'nodemailer';
import { readFile } from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';
import dotenv from 'dotenv';

dotenv.config();

// Create reusable transporter object
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

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
  const templatePath = path.join(process.cwd(), 'templates', `${templateName}.hbs`);
  const source = await readFile(templatePath, 'utf8');
  const template = Handlebars.compile(source);
  return template(data);
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
  try {
    const mailOptions = {
      from: `SoundSwap <${process.env.GMAIL_USER}>`,
      replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER,
      to,
      subject,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('❌ Email send error:', error);
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
    console.log(`📧 Preparing welcome email for ${email} (${subscription} plan)`);
    
    const html = await renderTemplate('welcome', {
      name,
      subscription: subscription.charAt(0).toUpperCase() + subscription.slice(1),
      isFounder,
      dashboardUrl: process.env.CLIENT_URL + '/dashboard',
      supportUrl: process.env.CLIENT_URL + '/support',
      settingsUrl: process.env.CLIENT_URL + '/settings',
      unsubscribeUrl: process.env.CLIENT_URL + '/unsubscribe'
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
 * Send founder activation email
 * @param {string} email - Recipient email
 * @param {string} name - User name
 */
export const sendFounderActivationEmail = async (email, name = 'Artist') => {
  const html = await renderTemplate('founderActivation', {
    name,
    dashboardUrl: process.env.CLIENT_URL + '/dashboard'
  });

  const mailOptions = {
    from: `SoundSwap <${process.env.GMAIL_USER}>`,
    to: email,
    subject: '🎉 Welcome to SoundSwap Founders Circle!',
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
          <a href="${process.env.ADMIN_URL}/users/${encodeURIComponent(founderEmail)}" 
            style="color: #d3a373; font-weight: bold;">
            View User in Admin Dashboard
          </a>
        </div>
      </div>
    </div>
  `;

  return sendEmail({ to: email, subject, html });
};