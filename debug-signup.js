import axios from 'axios';

const BASE_URL = 'http://localhost:3001';

// Test with the exact same data structure your frontend might be sending
const testSignup = async () => {
  console.log('🧪 Testing signup endpoint directly...\n');

  const testData = {
    name: 'Test User',
    email: `test${Date.now()}@example.com`,
    genre: 'Electronic',
    phone: '+1234567890'
    // Intentionally not including captchaToken
  };

  console.log('📤 Sending data:', testData);

  try {
    const response = await axios.post(`${BASE_URL}/api/points?action=signup`, testData, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    console.log('✅ Success!');
    console.log('Status:', response.status);
    console.log('Response:', response.data);
  } catch (error) {
    console.log('❌ Error!');
    console.log('Status:', error.response?.status);
    console.log('Error data:', error.response?.data);
    console.log('Full error:', error.message);
  }
};

// Test with different data variations
const testVariations = async () => {
  const variations = [
    { name: 'Test', email: 'test@example.com', genre: 'Rock' },
    { name: 'Test User', email: 'invalid-email', genre: 'Jazz' },
    { name: '', email: 'test2@example.com', genre: 'Pop' },
    { name: 'Test User', email: 'test3@example.com', genre: '' },
  ];

  for (let i = 0; i < variations.length; i++) {
    console.log(`\n🧪 Test ${i + 1}:`, variations[i]);
    try {
      const response = await axios.post(`${BASE_URL}/api/points?action=signup`, variations[i], {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('✅ Success:', response.status, response.data);
    } catch (error) {
      console.log('❌ Expected error:', error.response?.status, error.response?.data);
    }
  }
};

console.log('🚀 Starting signup debug tests...\n');
await testSignup();
await testVariations();
