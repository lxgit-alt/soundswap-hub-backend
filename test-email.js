import { sendWelcomeEmail, sendPasswordResetEmail } from './src/utils/emailService.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Test email address - replace with your email
const TEST_EMAIL = 'youngcky083@gmail.com';

// Function to test welcome email
const testWelcomeEmail = async () => {
  console.log(`🧪 Testing welcome email to ${TEST_EMAIL}...`);
  
  try {
    await sendWelcomeEmail(
      TEST_EMAIL,
      'Test User',
      'Premium',
      true
    );
    console.log('✅ Welcome email sent successfully!');
  } catch (error) {
    console.error('❌ Welcome email test failed:', error);
  }
};

// Function to test password reset email
const testPasswordResetEmail = async () => {
  console.log(`🧪 Testing password reset email to ${TEST_EMAIL}...`);
  
  const resetUrl = 'http://localhost:3000/reset-password?token=test-token-123';
  
  try {
    await sendPasswordResetEmail(
      TEST_EMAIL,
      resetUrl,
      'Test User'
    );
    console.log('✅ Password reset email sent successfully!');
  } catch (error) {
    console.error('❌ Password reset email test failed:', error);
  }
};

// Main function to run tests
const runTests = async () => {
  console.log('🚀 Starting email tests...');
  
  // Test welcome email
  await testWelcomeEmail();
  
  // Test password reset email
  await testPasswordResetEmail();
  
  console.log('🏁 Email tests completed!');
};

// Run the tests
runTests();