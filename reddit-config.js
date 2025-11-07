// Store this securely - never commit to public repo
const REDDIT_CONFIG = {
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
  userAgent: 'SoundSwapBot/1.0 (by /u/Relevant-Grass-8757)'
};

// Target subreddits
const TARGET_SUBREDDITS = [
  'WeAreTheMusicMakers',
  'IndieMusicFeedback', 
  'musicmarketing',
  'ThisIsOurMusic',
  'promoteyourmusic',
  'musicians'
];

// Keywords to monitor
const KEYWORDS = [
  'stuck on mix',
  'need honest feedback',
  'where to promote music',
  'bot streams',
  'music promotion',
  'grow audience',
  'get more listeners',
  'feedback on my track',
  'how to promote',
  'music marketing'
];

// Response templates
const RESPONSE_TEMPLATES = {
  feedback: `Hey! I saw you're looking for feedback. We built SoundSwap specifically for this - it's a platform where artists give each other constructive feedback in a gamified system. You might find it helpful: https://www.soundswap.live`,

  promotion: `Sounds like you're looking to promote your music! SoundSwap could help - it's designed to help artists grow organically without bot streams. Check it out: https://www.soundswap.live`,

  general: `This is exactly the problem we're solving with SoundSwap! It's a platform for musicians to share, get feedback, and grow their audience authentically. You might find it useful: https://www.soundswap.live`
};

module.exports = {
  REDDIT_CONFIG,
  TARGET_SUBREDDITS, 
  KEYWORDS,
  RESPONSE_TEMPLATES
};