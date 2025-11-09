import express from 'express';
import nodemailer from 'nodemailer';

const router = express.Router();

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

    // Check if email credentials are available
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();

    // Email content
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
                <a href="https://soundswap.live/dashboard" class="cta-button">
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
                <a href="https://soundswap.live/support">Help Center</a>.
            </p>
            
            <p>
                <a href="https://soundswap.live/dashboard">Dashboard</a> | 
                <a href="https://soundswap.live/settings">Account Settings</a> | 
                <a href="https://soundswap.live/unsubscribe">Unsubscribe</a>
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

    const textContent = `
Welcome to SoundSwap, ${name}!

Welcome to SoundSwap - the community where musicians connect, collaborate, and grow together! We're thrilled to have you join our vibrant community of artists, producers, and music lovers.

${subscription && subscription !== 'Free' ? `
🎉 ${subscription} Plan Activated!
You now have access to all ${subscription} features. Start exploring your enhanced music experience!
` : ''}

What you can do now:
✓ Upload and share your tracks with the community
✓ Give and receive valuable feedback from fellow musicians
✓ Discover new music across all genres
✓ Connect with artists who share your passion
✓ Track your musical journey with detailed analytics
${isFounder ? `
✓ Access exclusive Founder Circle benefits
✓ Enjoy unlimited uploads and premium features
` : ''}

Start Your Musical Journey:
https://soundswap.live/dashboard

Pro tip: Complete your profile and upload your first track to make the most of your SoundSwap experience. The community is here to support your musical growth!

Questions? We're here to help! Reply to this email or visit our Help Center:
https://soundswap.live/support

Useful Links:
- Dashboard: https://soundswap.live/dashboard
- Account Settings: https://soundswap.live/settings
- Unsubscribe: https://soundswap.live/unsubscribe

Follow us:
- Twitter: https://twitter.com/soundswap
- Facebook: https://facebook.com/soundswap  
- Instagram: https://instagram.com/soundswap_official

© ${new Date().getFullYear()} SoundSwap. All rights reserved.
You're receiving this email because you signed up for SoundSwap.
    `;

    const mailOptions = {
      from: {
        name: 'SoundSwap',
        address: process.env.GMAIL_USER
      },
      to: email,
      subject: subject,
      text: textContent,
      html: htmlContent
    };

    console.log('📤 Sending email with options:', {
      to: email,
      subject: subject,
      from: process.env.GMAIL_USER
    });

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

    // Check if email credentials are available
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();

    // Generate reset URL
    const clientURL = process.env.NODE_ENV === 'production'
      ? 'https://soundswap.live'
      : (process.env.CLIENT_URL || 'https://soundswap.live');
    
    const resetUrl = `${clientURL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    const subject = `🔐 Reset Your SoundSwap Password`;

    const htmlContent = `
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
                <a href="https://soundswap.live/support">Help Center</a>.
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

    const textContent = `
Password Reset Request - SoundSwap

Hi ${name || 'there'},

You recently requested to reset your password for your SoundSwap account. Use the link below to reset it.

Reset Your Password:
${resetUrl}

If you did not request a password reset, please ignore this email. This password reset link is only valid for the next 60 minutes.

Note: If the link above doesn't work, copy and paste the following URL into your browser:
${resetUrl}

Questions? We're here to help! Reply to this email or visit our Help Center: https://soundswap.live/support

© ${new Date().getFullYear()} SoundSwap. All rights reserved.
You're receiving this email because you requested a password reset for your SoundSwap account.
    `;

    const mailOptions = {
      from: {
        name: 'SoundSwap',
        address: process.env.GMAIL_USER
      },
      to: email,
      subject: subject,
      text: textContent,
      html: htmlContent
    };

    console.log('📤 Sending password reset email with options:', {
      to: email,
      subject: subject,
      from: process.env.GMAIL_USER
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset email sent successfully:', result.messageId);
    
    return result;
  } catch (error) {
    console.error('❌ Error sending password reset email:', error);
    throw error;
  }
};

// Send song reviewed notification email function
const sendSongReviewedEmail = async (email, name, songTitle, reviewerName, reviewComments, rating, songUrl) => {
  try {
    console.log('📧 Preparing to send song reviewed email:', { 
      email, name, songTitle, reviewerName, reviewComments, rating, songUrl 
    });

    // Check if email credentials are available
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();

    const subject = `🎵 Your Song "${songTitle}" Has Been Reviewed!`;

    // Generate star rating display
    const starRating = '★'.repeat(Math.round(rating || 0)) + '☆'.repeat(5 - Math.round(rating || 0));
    
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Song Reviewed - SoundSwap</title>
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
        .song-info {
            background: linear-gradient(135deg, #e8f4fd, #f0f8ff);
            border: 2px solid #0077b6;
            border-radius: 8px;
            padding: 25px;
            margin: 25px 0;
            text-align: center;
        }
        .song-info h3 {
            margin: 0 0 15px;
            color: #0077b6;
            font-size: 20px;
        }
        .song-info p {
            margin: 8px 0;
            color: #333;
            font-size: 15px;
        }
        .rating {
            font-size: 24px;
            color: #FFD700;
            margin: 15px 0;
        }
        .review-comments {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            margin: 25px 0;
            border-left: 4px solid #667eea;
        }
        .review-comments h4 {
            margin: 0 0 12px;
            color: #333;
            font-size: 16px;
        }
        .review-comments p {
            margin: 0;
            color: #555;
            font-style: italic;
            line-height: 1.5;
        }
        .cta-button {
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
        .cta-button:hover {
            background: #5a6fd8;
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
            color: #667eea;
            font-weight: bold;
            margin-right: 12px;
            font-size: 16px;
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
            <h1>Your Song Got Feedback! 🎵</h1>
            <p>Connect with your audience and grow as an artist</p>
        </div>
        
        <div class="content">
            <div class="greeting">
                Hey ${name}!
            </div>
            
            <div class="message">
                Great news! Your song has been reviewed by another SoundSwap artist. This is your chance to get valuable feedback and connect with the music community.
            </div>

            <div class="song-info">
                <h3>🎵 "${songTitle}"</h3>
                ${reviewerName ? `<p><strong>Reviewed by:</strong> ${reviewerName}</p>` : ''}
                ${rating ? `
                <div class="rating">
                    ${starRating}
                    <p style="font-size: 14px; margin: 5px 0 0; color: #666;">${rating}/5 stars</p>
                </div>
                ` : ''}
            </div>

            ${reviewComments ? `
            <div class="review-comments">
                <h4>💬 Reviewer's Comments:</h4>
                <p>"${reviewComments}"</p>
            </div>
            ` : ''}

            <div style="text-align: center;">
                <a href="${songUrl}" class="cta-button">
                    View Your Song & Response
                </a>
            </div>

            <div class="features">
                <h3>What you can do next:</h3>
                <ul class="feature-list">
                    <li>Respond to the feedback and start a conversation</li>
                    <li>Check out the reviewer's profile and music</li>
                    <li>Use the feedback to improve your next track</li>
                    <li>Review other artists' songs to earn points</li>
                    <li>Build your network in the music community</li>
                </ul>
            </div>

            <div class="message">
                <strong>Pro tip:</strong> Engaging with reviewers not only improves your music but also helps you build valuable connections in the industry. Keep the conversation going!
            </div>
        </div>

        <div class="footer">
            <div class="social-links">
                <a href="https://twitter.com/soundswap" title="Follow us on Twitter">🐦</a>
                <a href="https://facebook.com/soundswap" title="Like us on Facebook">📘</a>
                <a href="https://instagram.com/soundswap_official" title="Follow us on Instagram">📸</a>
            </div>
            
            <p>
                Questions about feedback? We're here to help! Reply to this email or visit our 
                <a href="https://soundswap.live/support">Help Center</a>.
            </p>
            
            <p>
                <a href="https://soundswap.live/dashboard">Dashboard</a> | 
                <a href="https://soundswap.live/settings">Account Settings</a> | 
                <a href="https://soundswap.live/unsubscribe">Unsubscribe</a>
            </p>
            
            <p style="margin-top: 20px; color: #999; font-size: 12px;">
                © ${new Date().getFullYear()} SoundSwap. All rights reserved.<br>
                You're receiving this email because you have song notifications enabled.
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const textContent = `
Song Reviewed Notification - SoundSwap

Hey ${name}!

Great news! Your song has been reviewed by another SoundSwap artist. This is your chance to get valuable feedback and connect with the music community.

Song Details:
🎵 "${songTitle}"
${reviewerName ? `Reviewed by: ${reviewerName}` : ''}
${rating ? `Rating: ${rating}/5 stars` : ''}

${reviewComments ? `
Reviewer's Comments:
"${reviewComments}"
` : ''}

View Your Song & Response:
${songUrl}

What you can do next:
✓ Respond to the feedback and start a conversation
✓ Check out the reviewer's profile and music
✓ Use the feedback to improve your next track
✓ Review other artists' songs to earn points
✓ Build your network in the music community

Pro tip: Engaging with reviewers not only improves your music but also helps you build valuable connections in the industry. Keep the conversation going!

Questions about feedback? We're here to help! Reply to this email or visit our Help Center:
https://soundswap.live/support

Useful Links:
- Dashboard: https://soundswap.live/dashboard
- Account Settings: https://soundswap.live/settings
- Unsubscribe: https://soundswap.live/unsubscribe

Follow us:
- Twitter: https://twitter.com/soundswap
- Facebook: https://facebook.com/soundswap  
- Instagram: https://instagram.com/soundswap_official

© ${new Date().getFullYear()} SoundSwap. All rights reserved.
You're receiving this email because you have song notifications enabled.
    `;

    const mailOptions = {
      from: {
        name: 'SoundSwap',
        address: process.env.GMAIL_USER
      },
      to: email,
      subject: subject,
      text: textContent,
      html: htmlContent
    };

    console.log('📤 Sending song reviewed email with options:', {
      to: email,
      subject: subject,
      from: process.env.GMAIL_USER
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Song reviewed email sent successfully:', result.messageId);
    
    return result;
  } catch (error) {
    console.error('❌ Error sending song reviewed email:', error);
    throw error;
  }
};

// ==================== EMAIL ROUTES ====================

// Send welcome email endpoint
router.post('/send-welcome-email', async (req, res) => {
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
});

// Send password reset email endpoint
router.post('/send-password-reset', async (req, res) => {
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

    // Send the password reset email
    await sendPasswordResetEmail(
      email,
      resetToken,
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
});

// Send song reviewed notification endpoint
router.post('/send-song-reviewed', async (req, res) => {
  try {
    console.log('📨 Received song reviewed notification request:', req.body);
    
    const { email, name, songTitle, reviewerName, reviewComments, rating, songUrl } = req.body;

    // Validate required fields
    if (!email || !songTitle || !songUrl) {
      console.error('❌ Email, songTitle, and songUrl are required');
      return res.status(400).json({
        success: false,
        message: 'Email, songTitle, and songUrl are required'
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

    // Validate rating if provided
    if (rating && (rating < 0 || rating > 5)) {
      console.error('❌ Invalid rating:', rating);
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 0 and 5'
      });
    }

    console.log('🔄 Sending song reviewed notification to:', { 
      email, name, songTitle, reviewerName, rating, songUrl 
    });

    // Send the song reviewed email
    await sendSongReviewedEmail(
      email,
      name || 'Artist',
      songTitle,
      reviewerName,
      reviewComments,
      rating,
      songUrl
    );

    console.log('✅ Song reviewed notification sent successfully to:', email);

    res.json({
      success: true,
      message: 'Song reviewed notification sent successfully'
    });
  } catch (error) {
    console.error('❌ Error sending song reviewed notification:', error);
    
    let errorMessage = 'Failed to send song reviewed notification';
    
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
});

// Test endpoint for email configuration
router.get('/test', async (req, res) => {
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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;