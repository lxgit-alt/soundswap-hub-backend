// testBasicAccess.js
import axios from 'axios';

async function testBasicAccess() {
  const clientId = 'JM2psbmhT_TnliyRNSLK0A';
  const clientSecret = 'v5MKeSGA297TmMbq9kUhIAPOck4ehA';
  const refreshToken = 'YOUR_REFRESH_TOKEN'; // Use the one that worked in quickExchange.js

  console.log('🔍 Testing basic token refresh...');

  try {
    // First, just test if we can get a new access token
    const tokenResponse = await axios.post('https://www.reddit.com/api/v1/access_token', 
      `grant_type=refresh_token&refresh_token=${refreshToken}`,
      {
        auth: {
          username: clientId,
          password: clientSecret
        },
        headers: {
          'User-Agent': 'SoundSwapBot/2.0 by lcy_Gas_949',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    console.log('✅ Token refresh successful!');
    console.log('New Access Token:', tokenResponse.data.access_token);
    console.log('Scope:', tokenResponse.data.scope);
    
    return tokenResponse.data.access_token;
    
  } catch (error) {
    console.log('❌ Token refresh failed:');
    console.log('Status:', error.response?.status);
    console.log('Error:', error.response?.data || error.message);
    return null;
  }
}

testBasicAccess();