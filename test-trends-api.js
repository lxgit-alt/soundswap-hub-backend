import fetch from 'node-fetch';

const API_BASE_URL = 'http://localhost:3000';

async function testTrendsAPI() {
  console.log('🧪 Testing Trends API Endpoints...\n');

  try {
    // Test health endpoint
    console.log('1. Testing health endpoint...');
    const healthResponse = await fetch(`${API_BASE_URL}/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData);
    console.log('');

    // Test music trends endpoint
    console.log('2. Testing music trends endpoint...');
    const trendsResponse = await fetch(`${API_BASE_URL}/api/trends/music`);
    const trendsData = await trendsResponse.json();
    console.log('✅ Trends data:', JSON.stringify(trendsData, null, 2));
    console.log('');

    // Test content ideas endpoint
    console.log('3. Testing content ideas endpoint...');
    const ideasResponse = await fetch(`${API_BASE_URL}/api/trends/content-ideas`);
    const ideasData = await ideasResponse.json();
    console.log('✅ Content ideas count:', ideasData.count);
    console.log('');

    // Test trends health endpoint
    console.log('4. Testing trends health endpoint...');
    const trendsHealthResponse = await fetch(`${API_BASE_URL}/api/trends/health`);
    const trendsHealthData = await trendsHealthResponse.json();
    console.log('✅ Trends health:', trendsHealthData);
    console.log('');

    console.log('🎉 All tests passed! API is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n💡 Make sure your server is running on port 3000:');
    console.log('   node server.js');
  }
}

testTrendsAPI();