// verifyAccount.js
import axios from 'axios';

const clientId = 'JM2psbmhT_TnliyRNSLK0A';
const clientSecret = 'v5MKeSGA297TmMbq9kUhIAPOck4ehA';
const refreshToken = ' ';

async function verifyAccount() {
  try {
    // Get access token
    const tokenResponse = await axios.post('https://www.reddit.com/api/v1/access_token', 
      `grant_type=refresh_token&refresh_token=${refreshToken}`,
      {
        auth: { username: clientId, password: clientSecret },
        headers: {
          'User-Agent': 'SoundSwapBot/2.0 by lcy_Gas_949',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const accessToken = tokenResponse.data.access_token;

    // Get user info
    const userResponse = await axios.get('https://oauth.reddit.com/api/v1/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'SoundSwapBot/2.0 by lcy_Gas_949'
      }
    });

    console.log('✅ Current Reddit account:', userResponse.data.name);
    console.log('🆔 Account ID:', userResponse.data.id);
    
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
}

verifyAccount();