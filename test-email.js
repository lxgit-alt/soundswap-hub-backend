import { sendWelcomeEmail } from './src/utils/emailService-fixed.js';
import dotenv from 'dotenv';

dotenv.config();

// Test email function
const testEmail = async () => {
  try {
    console.log('🧪 Testing email service...');
    console.log('📧 GMAIL_USER:', process.env.GMAIL_USER);
    console.log('🔑 GMAIL_PASS:', process.env.GMAIL_PASS ? '***configured***' : '❌ NOT SET');
    console.log('🌐 CLIENT_URL:', process.env.CLIENT_URL);
    
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      console.error('❌ Missing email configuration. Please set GMAIL_USER and GMAIL_PASS in .env file');
      return;
    }
    
    // Test with your own email
    const testEmailAddress = process.env.GMAIL_USER; // Send to yourself for testing
    
    await sendWelcomeEmail(testEmailAddress, 'Test User', 'Free', false);
    console.log('✅ Test email sent successfully!');
    
  } catch (error) {
    console.error('❌ Test email failed:', error);
  }
};

// Run the test
testEmail();