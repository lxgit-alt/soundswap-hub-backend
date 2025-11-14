import axios from 'axios';

// REPLACE THESE WITH YOUR ACTUAL VALUES
const clientId = 'YOUR_ACTUAL_CLIENT_ID_HERE';
const clientSecret = 'YOUR_ACTUAL_CLIENT_SECRET_HERE';
const authCode = 'THE_AUTHORIZATION_CODE_YOU_GOT_FROM_REDDIT';
const redirectUri = 'http://localhost:3000/auth/reddit/callback';

const data = new URLSearchParams({
  grant_type: 'authorization_code',
  code: authCode,
  redirect_uri: redirectUri
});

console.log('🔄 Exchanging authorization code for refresh token...');

axios.post('https://www.reddit.com/api/v1/access_token', data, {
  auth: {
    username: clientId,
    password: clientSecret
  },
  headers: {
    'User-Agent': 'YourMusicBot/1.0',
    'Content-Type': 'application/x-www-form-urlencoded'
  }
}).then(response => {
  console.log('✅ SUCCESS!');
  console.log('Refresh Token:', response.data.refresh_token);
  console.log('Access Token:', response.data.access_token);
  console.log('Expires in:', response.data.expires_in, 'seconds');
  console.log('\n💾 Add this to your .env file:');
  console.log('REDDIT_REFRESH_TOKEN=' + response.data.refresh_token);
}).catch(error => {
  console.log('❌ Error:');
  if (error.response) {
    console.log('Status:', error.response.status);
    console.log('Error data:', JSON.stringify(error.response.data, null, 2));
  } else {
    console.log(error.message);
  }
});