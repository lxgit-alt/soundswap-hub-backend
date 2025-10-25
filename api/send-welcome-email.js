import express from 'express';
import nodemailer from 'nodemailer';

const router = express.Router();

// Add CORS middleware
router.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://soundswap.onrender.com',
    'https://sound-swap-frontend.onrender.com'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Create email transporter
const createTransporter = () => {
  // Use environment variables for email configuration
  return nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER || 'soundswaphub@gmail.com',
      pass: process.env.GMAIL_PASS, // Use app password
    },
  });
};

// Send welcome email function
const sendWelcomeEmail = async (email, name, subscription, isFounder = false) => {
  try {
    console.log('📧 Preparing to send welcome email:', { email, name, subscription, isFounder });

    // Validate email configuration
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();

    // Verify transporter configuration
    await transporter.verify();
    console.log('✅ Email transporter verified');

    // Email content with your custom styles
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
                <a href="https://soundswap.onrender.com/dashboard" class="cta-button">
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
                <a href="https://instagram.com/soundswap" title="Follow us on Instagram">📸</a>
                <a href="https://youtube.com/soundswap" title="Subscribe to our YouTube">📺</a>
            </div>
            
            <p>
                Questions? We're here to help! Reply to this email or visit our 
                <a href="https://soundswap.onrender.com/support">Help Center</a>.
            </p>
            
            <p>
                <a href="https://soundswap.onrender.com/dashboard">Dashboard</a> | 
                <a href="https://soundswap.onrender.com/settings">Account Settings</a> | 
                <a href="https://soundswap.onrender.com/unsubscribe">Unsubscribe</a>
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
https://soundswap.onrender.com/dashboard

Pro tip: Complete your profile and upload your first track to make the most of your SoundSwap experience. The community is here to support your musical growth!

Questions? We're here to help! Reply to this email or visit our Help Center:
https://soundswap.onrender.com/support

Useful Links:
- Dashboard: https://soundswap.onrender.com/dashboard
- Account Settings: https://soundswap.onrender.com/settings
- Unsubscribe: https://soundswap.onrender.com/unsubscribe

Follow us:
- Twitter: https://twitter.com/soundswap
- Facebook: https://facebook.com/soundswap  
- Instagram: https://instagram.com/soundswap
- YouTube: https://youtube.com/soundswap

© ${new Date().getFullYear()} SoundSwap. All rights reserved.
You're receiving this email because you signed up for SoundSwap.
    `;

    const mailOptions = {
      from: {
        name: 'SoundSwap',
        address: process.env.EMAIL_USER
      },
      to: email,
      subject: subject,
      text: textContent,
      html: htmlContent
    };

    console.log('📤 Sending email with options:', {
      to: email,
      subject: subject,
      from: process.env.EMAIL_USER
    });

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', result.messageId);
    
    return result;
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    throw error;
  }
};

// Send welcome email endpoint
router.post('/api/send-welcome-email', async (req, res) => {
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
    
    // Provide more specific error messages
    let errorMessage = 'Failed to send welcome email';
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Please check email credentials.';
    } else if (error.code === 'EENVELOPE') {
      errorMessage = 'Invalid email address.';
    } else if (error.message.includes('ENOTFOUND')) {
      errorMessage = 'Network error. Please try again.';
    } else if (error.message.includes('credentials not configured')) {
      errorMessage = 'Email service not configured on server.';
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Test endpoint
router.get('/api/send-welcome-email/test', async (req, res) => {
  try {
    const hasEmailConfig = !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);
    
    res.json({
      success: true,
      email_configured: hasEmailConfig,
      email_user: process.env.EMAIL_USER ? 'Set' : 'Not set',
      node_env: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
      message: 'Welcome email API is working'
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a simple health check
router.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'email-api',
    timestamp: new Date().toISOString()
  });
});

export default router;