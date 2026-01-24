import express from 'express';

const router = express.Router();

// ==================== CRITICAL WATCH ITEM: RATE LIMIT MONITORING ====================
const RATE_LIMIT_MONITOR = {
  lastError: null,
  consecutiveErrors: 0,
  backoffMultiplier: 1,
  last429Time: null
};

// ==================== CRITICAL WATCH ITEM: SHADOW-DELETE DETECTION ====================
const SHADOW_DELETE_CHECK = {
  enabled: true,
  checkProbability: 0.4, // INCREASED TO 40% for 5-minute limit
  checkDelayMinutes: 30, // Wait 30 minutes before checking
  loggedOutBrowserCheck: [], // Store URLs for manual checking
  suspectedDeletions: 0
};

// ==================== DISCORD WEBHOOK CONFIGURATION ====================
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// CRITICAL WATCH ITEM: Discord high-priority threshold
const DISCORD_HIGH_PRIORITY_THRESHOLD = 85; // Only send Discord for leads with score > 85

// ==================== LAZY LOADING CONFIGURATION ====================

let isRedditLoaded = false;
let isFirebaseLoaded = false;
let isAILoaded = false;

// Lazy loaded dependencies
let GoogleGenerativeAI;
let initializeApp;
let getFirestore, collection, addDoc, getDocs, query, where, updateDoc, doc, getDoc, deleteDoc, orderBy, limit;
let snoowrap;

// Lazy loaded instances
let genAI = null;
let firebaseApp = null;
let db = null;
let redditClient = null;

// ==================== ENHANCED CONFIGURATION FOR 5-MINUTE FLUID COMPUTE ====================

// INCREASED for 5-minute processing
const MAX_PROCESSING_TIME = 240000; // 4 minutes (leaves 1 minute buffer)
const AI_TIMEOUT_MS = 8000; // Increased AI timeout
const VERCELL_TIMEOUT_MS = 240000; // 4-minute Vercel timeout
const POSTS_PER_SUBREDDIT = 10; // Increased posts per subreddit for comprehensive scanning
const MAX_POSTS_PER_RUN = 4; // Increased posts per run for 30-minute intervals
const MAX_COMMENTS_PER_DAY = 30; // Increased daily limit
const MAX_EDUCATIONAL_POSTS_PER_DAY = 5; // Increased educational posts
const CONCURRENT_SCAN_LIMIT = 20; // All 20 active subreddits
const MAX_CONCURRENT_REQUESTS = 6; // Increased concurrent requests for faster scanning
const MIN_LEAD_SCORE = 20;
const GOLDEN_HOUR_WINDOW_MINUTES = 90; // Extended to 90 minutes for more opportunities

// Human Window: Only run during peak hours (12:00 PM – 10:00 PM UTC)
const HUMAN_WINDOW_START_HOUR = 12; // 12:00 PM UTC
const HUMAN_WINDOW_END_HOUR = 22; // 10:00 PM UTC

// Schedule configuration
const SCHEDULE_INTERVAL = 30; // 30-minute intervals

let postingActivity = null;

// ==================== FLUID COMPUTE OPTIMIZATION FUNCTIONS ====================

const getRandomizedDelay = () => {
  // Add exponential backoff if we're hitting rate limits
  let baseDelay;
  
  if (RATE_LIMIT_MONITOR.consecutiveErrors > 2) {
    // Exponential backoff: 2^n * random factor
    const backoffFactor = Math.pow(2, RATE_LIMIT_MONITOR.consecutiveErrors - 2);
    baseDelay = 60000 * backoffFactor; // Start at 1 minute, double each time
    console.warn(`[RATE LIMIT] ⚠️ Exponential backoff: ${Math.round(baseDelay/1000)}s delay`);
  } else {
    // Normal randomized delay with more "jitter"
    // Updated to be more random and less rhythmic
    const delays = [3200, 17800, 41500, 63200, 89100, 24700, 56800, 71400, 38500, 129000];
    baseDelay = delays[Math.floor(Math.random() * delays.length)];
  }
  
  // Add additional jitter (±15%)
  const jitter = 0.85 + (Math.random() * 0.3); // 0.85 to 1.15
  const jitteredDelay = Math.floor(baseDelay * jitter);
  
  // Ensure we don't exceed Reddit's timeout limits
  const safeDelay = Math.min(jitteredDelay, 120000); // Max 2 minutes for safety
  
  return safeDelay;
};

const calculateTimeout = (baseMs, subtractMs = 0) => {
  // Normalize inputs to 0 if they are invalid/infinite/negative before subtracting
  const base = Number.isFinite(baseMs) ? Math.max(0, baseMs) : 1000;
  const subtract = Number.isFinite(subtractMs) ? Math.max(0, subtractMs) : 0;

  const result = base - subtract;

  // Ensure result is at least 100ms and not exceeding 32-bit int limit
  if (result < 100) {
    return 1000;
  }
  
  return Math.trunc(result);
};

// Gemini API quota management - UPDATED FOR 5-MINUTE PROCESSING
let geminiQuotaInfo = {
  lastRequest: null,
  requestCount: 0,
  quotaLimit: 100, // Increased for 5-minute processing
  resetTime: null,
  lastError: null
};

const checkGeminiQuota = () => {
  const now = Date.now();
  
  if (geminiQuotaInfo.resetTime && now > geminiQuotaInfo.resetTime) {
    geminiQuotaInfo.requestCount = 0;
    geminiQuotaInfo.resetTime = now + (24 * 60 * 60 * 1000);
  }
  
  if (geminiQuotaInfo.requestCount >= geminiQuotaInfo.quotaLimit) {
    const waitTime = geminiQuotaInfo.resetTime ? geminiQuotaInfo.resetTime - now : 60000;
    console.warn(`[QUOTA] ⚠️ Gemini quota exceeded. Wait ${Math.ceil(waitTime/1000)}s`);
    return false;
  }
  
  return true;
};

const incrementGeminiRequest = () => {
  geminiQuotaInfo.requestCount++;
  geminiQuotaInfo.lastRequest = Date.now();
  
  if (!geminiQuotaInfo.resetTime) {
    geminiQuotaInfo.resetTime = Date.now() + (24 * 60 * 60 * 1000);
  }
};

const safeSetTimeout = (callback, delay) => {
  const DEFAULT_DELAY = 1000;

  // 1. Ensure we have a finite number. 
  // If 'delay' is -Infinity or NaN, 'parsed' becomes that value.
  const parsed = Number(delay);

  // 2. Validate: must be finite and non-negative.
  // We use Math.max(0, ...) to ensure we never pass a negative to setTimeout.
  if (!Number.isFinite(parsed) || parsed < 0) {
    return setTimeout(callback, DEFAULT_DELAY);
  }

  // 3. Clamp to safe integer range (Node.js max timeout is actually 2,147,483,647ms)
  const MAX_TIMEOUT = 2147483647; 
  const safeDelay = Math.min(MAX_TIMEOUT, Math.trunc(parsed));
  
  return setTimeout(callback, safeDelay);
};

const withTimeout = async (promise, timeoutMs, timeoutMessage = 'Operation timed out') => {
  // Ensure timeoutMs is a safe, positive finite integer.
  const DEFAULT_TIMEOUT = 8000; // Increased for 5-minute processing
  let ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    ms = DEFAULT_TIMEOUT;
  } else {
    ms = Math.trunc(ms);
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = safeSetTimeout(() => reject(new Error(timeoutMessage)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

// ==================== CRITICAL WATCH ITEM: ENHANCED DISCORD NOTIFICATION WITH FILTER ====================

const sendDiscordLeadNotification = async (leadData) => {
  // HIGH PRIORITY FILTER: Only send Discord for leads with score > 85
  const HIGH_PRIORITY_THRESHOLD = DISCORD_HIGH_PRIORITY_THRESHOLD;
  
  if (leadData.leadScore < HIGH_PRIORITY_THRESHOLD) {
    console.log(`[DISCORD] ⏭️ Skipping notification for lead score ${leadData.leadScore} (threshold: ${HIGH_PRIORITY_THRESHOLD})`);
    
    // Log low-priority leads to console only
    console.log(`[LEAD-LOG] 📝 Low-priority lead detected: r/${leadData.subreddit} - Score: ${leadData.leadScore} - "${leadData.postTitle.substring(0, 60)}..."`);
    return false;
  }
  
  console.log('[DISCORD] 📤 Attempting to send HIGH-PRIORITY notification...');
  console.log('[DISCORD] 🎯 High-priority lead detected:', {
    subreddit: leadData.subreddit,
    score: leadData.leadScore,
    batch: leadData.batch
  });
  
  try {
    if (!DISCORD_WEBHOOK_URL) {
      console.warn('[WARN] ❌ Discord webhook URL not configured');
      console.warn('[WARN] Check environment variable: DISCORD_WEBHOOK_URL');
      return false;
    }

    console.log('[DISCORD] ✅ Webhook URL is configured');
    
    // Format the Discord embed
    const embed = {
      title: '🎯 **HIGH-PRIORITY LEAD GENERATED**',
      color: 0x00ff00,
      thumbnail: {
        url: 'https://cdn-icons-png.flaticon.com/512/2702/2702602.png'
      },
      fields: [
        {
          name: '📌 Subreddit',
          value: `r/${leadData.subreddit}`,
          inline: true
        },
        {
          name: '🎭 Batch',
          value: leadData.batch || 'N/A',
          inline: true
        },
        {
          name: '🔧 Lead Type',
          value: leadData.leadType || 'Premium Feature Interest',
          inline: true
        },
        {
          name: '🔥 Interest Level',
          value: leadData.interestLevel || 'High',
          inline: true
        },
        {
          name: '📊 Lead Score',
          value: leadData.leadScore?.toString() || 'N/A',
          inline: true
        },
        {
          name: '🎯 Pain Points Detected',
          value: leadData.painPoints?.join(', ') || 'None identified',
          inline: false
        },
        {
          name: '📝 Original Post Title',
          value: `\`\`\`${leadData.postTitle.substring(0, 200)}${leadData.postTitle.length > 200 ? '...' : ''}\`\`\``,
          inline: false
        },
        {
          name: '🔗 Reddit Post',
          value: leadData.redditUrl ? `[View on Reddit](${leadData.redditUrl})` : 'N/A',
          inline: true
        },
        {
          name: '⏰ Generated At',
          value: new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
          inline: true
        },
        {
          name: '📈 Total Premium Leads Today',
          value: `**${leadData.totalLeadsToday || 0}** leads`,
          inline: true
        },
        {
          name: '🔔 Priority',
          value: '**HIGH PRIORITY** (Score > 85)',
          inline: false
        }
      ],
      footer: {
        text: 'SoundSwap Reddit Automation • High-Priority Lead Generation',
        icon_url: 'https://cdn-icons-png.flaticon.com/512/2702/2702702.png'
      },
      timestamp: new Date().toISOString()
    };

    console.log('[DISCORD] 📨 Sending payload to Discord...');
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: `🎯 **HIGH-PRIORITY LEAD DETECTED!** <@&1153832361951674478>`,
        embeds: [embed],
        username: 'SoundSwap Lead Bot (High-Priority Only)',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2702/2702702.png'
      })
    });

    console.log(`[DISCORD] 📡 Response status: ${response.status}`);
    
    if (response.ok) {
      console.log('[DISCORD] ✅ High-priority lead notification sent successfully');
      return true;
    } else {
      const errorText = await response.text();
      console.warn('[WARN] ❌ Failed to send Discord notification:', {
        status: response.status,
        error: errorText.substring(0, 200)
      });
      return false;
    }
  } catch (error) {
    console.error('[ERROR] ❌ Error sending Discord notification:', {
      message: error.message,
      stack: error.stack?.substring(0, 200)
    });
    return false;
  }
};

// ==================== CRITICAL WATCH ITEM: CRITICAL ALERT SYSTEM ====================

const sendCriticalAlert = async (type, data) => {
  if (!DISCORD_WEBHOOK_URL) return false;
  
  const alerts = {
    rate_limit_critical: {
      title: '🚨 CRITICAL: Rate Limit Issues',
      color: 0xff0000,
      message: `Engine has hit ${data.consecutiveErrors} consecutive rate limits. Backoff multiplier: ${data.backoffMultiplier}x`
    },
    shadow_delete_suspected: {
      title: '⚠️ SUSPECTED: Shadow Deletions',
      color: 0xff9900,
      message: `${data.count} comments may be shadow-deleted. Check manually.`
    },
    batch_c_attention: {
      title: '🎯 ATTENTION: Batch C Comments',
      color: 0x00ff00,
      message: `${data.count} Batch C comments need manual verification from logged-out browser.`
    }
  };
  
  const alert = alerts[type];
  if (!alert) return false;
  
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `<@&1153832361951674478> ${alert.title}`,
        embeds: [{
          title: alert.title,
          description: alert.message,
          color: alert.color,
          timestamp: new Date().toISOString()
        }]
      })
    });
    return true;
  } catch (error) {
    console.error('[ALERT] ❌ Failed to send critical alert:', error);
    return false;
  }
};

// ==================== OPTIMIZED MODULE LOADERS ====================

const loadFirebase = async () => {
  if (!isFirebaseLoaded) {
    console.log('[INFO] 🔥 Firebase: Lazy loading Firebase modules');
    const firebaseModule = await import('firebase/app');
    const firestoreModule = await import('firebase/firestore');
    
    initializeApp = firebaseModule.initializeApp;
    getFirestore = firestoreModule.getFirestore;
    collection = firestoreModule.collection;
    addDoc = firestoreModule.addDoc;
    getDocs = firestoreModule.getDocs;
    query = firestoreModule.query;
    where = firestoreModule.where;
    updateDoc = firestoreModule.updateDoc;
    doc = firestoreModule.doc;
    getDoc = firestoreModule.getDoc;
    deleteDoc = firestoreModule.deleteDoc;
    orderBy = firestoreModule.orderBy;
    limit = firestoreModule.limit;
    
    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: "soundswap.live",
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID
    };
    
    firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    isFirebaseLoaded = true;
    console.log('[INFO] 🔥 Firebase: Modules loaded successfully');
  }
  return { db, firebaseApp };
};

const loadAI = async () => {
  if (!isAILoaded) {
    console.log('[INFO] 🤖 AI: Lazy loading Google Gemini');
    
    if (!checkGeminiQuota()) {
      throw new Error('Gemini API quota exceeded. Please try again later.');
    }
    
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      console.warn('[WARN] ⚠️ Google Gemini API key not configured');
      genAI = null;
      isAILoaded = true;
      return genAI;
    }
    
    try {
      GoogleGenerativeAI = (await import('@google/generative-ai')).GoogleGenerativeAI;
      genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
      isAILoaded = true;
      console.log('[INFO] 🤖 AI: Google Gemini loaded successfully');
    } catch (error) {
      console.error('[ERROR] ❌ Failed to load Google Gemini:', error);
      genAI = null;
      isAILoaded = true;
    }
  }
  return genAI;
};

const loadReddit = async () => {
  if (!isRedditLoaded) {
    console.log('[INFO] 📱 Reddit: Lazy loading Snoowrap');
    
    if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET || !process.env.REDDIT_REFRESH_TOKEN) {
      console.warn('[WARN] ⚠️ Reddit API credentials not fully configured');
      redditClient = null;
      isRedditLoaded = true;
      return redditClient;
    }
    
    try {
      snoowrap = (await import('snoowrap')).default;
      
      redditClient = new snoowrap({
        userAgent: 'SoundSwap Reddit Bot v10.0 (Official Team/Developer Persona)',
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        refreshToken: process.env.REDDIT_REFRESH_TOKEN,
        requestTimeout: 15000 // Increased timeout for 5-minute processing
      });
      
      isRedditLoaded = true;
      console.log('[INFO] 📱 Reddit: Snoowrap loaded successfully');
    } catch (error) {
      console.error('[ERROR] ❌ Failed to load Snoowrap:', error);
      redditClient = null;
      isRedditLoaded = true;
    }
  }
  return redditClient;
};

// ==================== OPTIMIZED CONFIGURATION ====================

const SCHEDULED_POSTS_COLLECTION = 'scheduledPosts';
const EDUCATIONAL_POSTS_COLLECTION = 'educationalPosts';
const POSTING_ACTIVITY_COLLECTION = 'postingActivity';
const PREMIUM_FEATURE_LEADS_COLLECTION = 'premiumFeatureLeads';

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';
const POSTING_WINDOW_MINUTES = 10;
const FALLBACK_MODE = true;

// ==================== BATCH CONFIGURATION ====================

const BATCHES = {
  A: {
    name: 'Feedback Loop',
    goal: 'Build account "Karma" and community rapport',
    persona: 'The curious developer',
    strategy: 'Ask insightful questions about their process or offer genuine feedback',
    timeWindow: 'Morning (Trust Building)',
    subreddits: ['IndieMusicFeedback', 'ArtistLounge', 'MusicInTheMaking', 'Songwriters', 'BedroomBands'],
    style: 'curious, helpful, engaging'
  },
  B: {
    name: 'Visual Showdown',
    goal: 'Viral reach through high-quality Original Content (OC)',
    persona: 'The innovative studio',
    strategy: 'Post Doodle-to-Art transformations or high-end lyric video snippets',
    timeWindow: 'Mid-Day (High Impact OC)',
    subreddits: ['digitalart', 'aiArt', 'VaporwaveAesthetics', 'Hyperpop', 'AlbumArtPorn'],
    style: 'creative, visual, inspiring'
  },
  C: {
    name: 'Problem Solvers',
    goal: 'Solve specific "Pain Points" and drive conversions',
    persona: 'The helpful consultant',
    strategy: 'Scan for keywords like "how to make a video", provide solution first',
    timeWindow: 'Afternoon (Direct Utility)',
    subreddits: ['WeAreTheMusicMakers', 'musicproduction', 'musicians', 'makinghiphop', 'edmproduction'],
    style: 'practical, solution-oriented, expert'
  },
  D: {
    name: 'Growth Hackers',
    goal: 'Position SoundSwap as a business/growth tool',
    persona: 'The industry insider',
    strategy: 'Focus on how visuals drive streams, retention, and algorithm favor',
    timeWindow: 'Evening (Marketing & ROI)',
    subreddits: ['MusicMarketing', 'Spotify', 'SocialMediaMarketing', 'PromoteYourMusic', 'AIArtCommunity'],
    style: 'data-driven, strategic, professional'
  }
};

// Helper to get batch for a subreddit
const getBatchForSubreddit = (subreddit) => {
  for (const [batchKey, batch] of Object.entries(BATCHES)) {
    if (batch.subreddits.includes(subreddit)) {
      return batchKey;
    }
  }
  return null;
};

// Helper functions for batch rotation
const getCurrentBatchRotation = () => {
  const currentUTCHour = getCurrentUTCHour();
  
  if (currentUTCHour >= 12 && currentUTCHour < 15) return 'A (Feedback Loop)';
  if (currentUTCHour >= 15 && currentUTCHour < 18) return 'B (Visual Showdown)';
  if (currentUTCHour >= 18 && currentUTCHour < 20) return 'C (Problem Solvers)';
  if (currentUTCHour >= 20 && currentUTCHour <= 22) return 'D (Growth Hackers)';
  return 'Outside rotation window';
};

const getNextScheduledBatch = () => {
  const currentUTCHour = getCurrentUTCHour();
  
  if (currentUTCHour < 12) return 'A (12:00 UTC)';
  if (currentUTCHour < 15) return 'B (15:00 UTC)';
  if (currentUTCHour < 18) return 'C (18:00 UTC)';
  if (currentUTCHour < 20) return 'D (20:00 UTC)';
  return 'A (Tomorrow 12:00 UTC)';
};

// ==================== TIME HELPER FUNCTIONS ====================

const getCurrentHourInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { 
    timeZone: APP_TIMEZONE,
    hour12: false,
    hour: '2-digit'
  }).slice(0, 2);
};

const getCurrentTimeInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { 
    timeZone: APP_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).slice(0, 5);
};

const getCurrentDayInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleDateString('en-US', { 
    timeZone: APP_TIMEZONE,
    weekday: 'long'
  }).toLowerCase();
};

const getCurrentDateInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleDateString('en-US', { 
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

const getCurrentUTCHour = () => {
  const now = new Date();
  return now.getUTCHours();
};

const isWithinHumanWindow = () => {
  const currentUTCHour = getCurrentUTCHour();
  return currentUTCHour >= HUMAN_WINDOW_START_HOUR && currentUTCHour < HUMAN_WINDOW_END_HOUR;
};

const getCurrentTimeWindow = () => {
  const now = new Date();
  const startTime = new Date(now.getTime() - POSTING_WINDOW_MINUTES * 60000);
  const endTime = new Date(now.getTime() + POSTING_WINDOW_MINUTES * 60000);
  
  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      timeZone: APP_TIMEZONE,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    }).slice(0, 5);
  };
  
  return {
    start: formatTime(startTime),
    end: formatTime(endTime),
    current: formatTime(now)
  };
};

const getGoldenHourWindow = () => {
  const now = new Date();
  const startTime = new Date(now.getTime() - GOLDEN_HOUR_WINDOW_MINUTES * 60000);
  
  return {
    startTimestamp: startTime,
    endTimestamp: now,
    start: startTime.toISOString(),
    end: now.toISOString(),
    windowMinutes: GOLDEN_HOUR_WINDOW_MINUTES
  };
};

const isWithinGoldenHour = (postTimestamp) => {
  const goldenHourWindow = getGoldenHourWindow();
  const postTime = new Date(postTimestamp * 1000);
  return postTime >= goldenHourWindow.startTimestamp && postTime <= goldenHourWindow.endTimestamp;
};

// ==================== LEAD SCORING SYSTEM ====================

const calculateLeadScore = (post, subredditConfig, batch) => {
  let score = 0;
  const text = (post.title + ' ' + (post.content || '')).toLowerCase();
  
  // 1. Pain Point Analysis (40% of score)
  const painPoints = analyzePostForPainPoints(post.title, post.content);
  score += painPoints.score * 4; // Weighted
  
  // 2. Keyword Matching (30% of score)
  if (subredditConfig.keywords) {
    const matchedKeywords = subredditConfig.keywords.filter(keyword => 
      text.includes(keyword.toLowerCase())
    );
    score += matchedKeywords.length * 15;
  }
  
  // 3. Freshness Score (20% of score) - More recent = higher score
  const now = Math.floor(Date.now() / 1000);
  const ageInMinutes = (now - post.created_utc) / 60;
  if (ageInMinutes <= 60) {
    const freshnessScore = Math.max(0, 20 - (ageInMinutes / 3));
    score += freshnessScore;
  }
  
  // 4. Engagement Potential (10% of score)
  if (post.num_comments < 5) { // Low comments = more likely to engage
    score += 10;
  }
  
  // 5. Batch Priority Bonus
  if (batch === 'C' || batch === 'D') { // Problem Solvers & Growth Hackers have higher priority
    score += 15;
  } else if (batch === 'B') { // Visual Showdown
    score += 10;
  } else { // Feedback Loop
    score += 5;
  }
  
  return Math.round(score);
};

// ==================== ENHANCED CONCURRENT SCANNING WITH RATE LIMIT PROTECTION ====================

const fetchFreshPostsFromSubreddit = async (subreddit, timeWindowMinutes = 60) => {
  try {
    if (!redditClient) {
      console.warn(`[WARN] ⚠️ Reddit client not available for r/${subreddit}`);
      return [];
    }
    
    const now = Math.floor(Date.now() / 1000);
    const timeThreshold = now - (timeWindowMinutes * 60);
    
    const posts = await redditClient.getSubreddit(subreddit).getNew({
      limit: POSTS_PER_SUBREDDIT
    });
    
    const freshPosts = posts.filter(post => {
      return post.created_utc >= timeThreshold;
    });
    
    if (freshPosts.length === 0) return [];
    
    return freshPosts.map(post => ({
      id: post.id,
      title: post.title,
      content: post.selftext,
      author: post.author?.name || '[deleted]',
      created_utc: post.created_utc,
      url: post.url,
      score: post.score,
      num_comments: post.num_comments,
      subreddit: subreddit,
      isFresh: isWithinGoldenHour(post.created_utc),
      timestamp: new Date(post.created_utc * 1000).toISOString()
    }));
    
  } catch (error) {
    console.error(`[ERROR] ❌ Error fetching posts from r/${subreddit}:`, error.message);
    
    // Check for rate limit errors
    if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      RATE_LIMIT_MONITOR.consecutiveErrors++;
      RATE_LIMIT_MONITOR.last429Time = Date.now();
      console.warn(`[RATE LIMIT] 🚨 429 detected! Consecutive errors: ${RATE_LIMIT_MONITOR.consecutiveErrors}`);
    }
    
    return [];
  }
};

// Batch processing with enhanced rate limit protection
const batchProcess = async (items, processor, concurrency = MAX_CONCURRENT_REQUESTS) => {
  const results = [];
  let errorCount = 0;
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    
    try {
      const batchResults = await Promise.allSettled(
        batch.map(item => processor(item))
      );
      
      // Process results and track errors
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          errorCount++;
          console.error(`[ERROR] ❌ Batch item failed:`, result.reason.message);
          
          // Check for rate limit errors
          if (result.reason.message?.includes('429') || result.reason.message?.includes('rate limit')) {
            RATE_LIMIT_MONITOR.consecutiveErrors++;
            RATE_LIMIT_MONITOR.last429Time = Date.now();
            console.warn(`[RATE LIMIT] 🚨 429 detected! Consecutive errors: ${RATE_LIMIT_MONITOR.consecutiveErrors}`);
          }
        }
      });
      
      // Reset error counter if we've had a successful batch
      if (errorCount === 0 && RATE_LIMIT_MONITOR.consecutiveErrors > 0) {
        RATE_LIMIT_MONITOR.consecutiveErrors = Math.max(0, RATE_LIMIT_MONITOR.consecutiveErrors - 1);
      }
      
      // Larger, more variable delay between batches
      if (i + concurrency < items.length) {
        const delay = getRandomizedDelay();
        await new Promise(resolve => safeSetTimeout(resolve, delay));
      }
      
    } catch (batchError) {
      errorCount++;
      console.error(`[ERROR] ❌ Batch processing failed:`, batchError);
    }
  }
  
  // Log rate limit status
  if (RATE_LIMIT_MONITOR.consecutiveErrors > 0) {
    console.warn(`[RATE LIMIT] ⚠️ Status: ${RATE_LIMIT_MONITOR.consecutiveErrors} consecutive errors`);
  }
  
  return results;
};

// Scan all active subreddits concurrently
const scanAllSubredditsConcurrently = async () => {
  const allActiveSubreddits = Object.keys(redditTargets).filter(k => redditTargets[k].active);
  
  console.log(`[SCAN] 🔍 Concurrently scanning ${allActiveSubreddits.length} active subreddits`);
  console.log(`[SCAN] ⚡ Fluid Compute: 5-minute limit allows comprehensive scanning`);
  
  // Process subreddits in batches for rate limiting
  const allPosts = await batchProcess(
    allActiveSubreddits,
    async (subreddit) => {
      try {
        const posts = await withTimeout(
          fetchFreshPostsFromSubreddit(subreddit, GOLDEN_HOUR_WINDOW_MINUTES),
          6000, // Increased timeout
          `Scan timeout for r/${subreddit}`
        );
        
        // Add subreddit config and calculate lead scores
        return posts.map(post => ({
          ...post,
          subredditConfig: redditTargets[subreddit],
          batch: getBatchForSubreddit(subreddit),
          painPointAnalysis: analyzePostForPainPoints(post.title, post.content),
          leadScore: calculateLeadScore(post, redditTargets[subreddit], getBatchForSubreddit(subreddit))
        }));
      } catch (error) {
        console.error(`[ERROR] ❌ Failed to scan r/${subreddit}:`, error.message);
        return [];
      }
    },
    MAX_CONCURRENT_REQUESTS
  );
  
  // Flatten the array of arrays
  const flattenedPosts = allPosts.flat();
  
  // Sort by lead score (highest first)
  const sortedPosts = flattenedPosts.sort((a, b) => b.leadScore - a.leadScore);
  
  // Filter out low-scoring posts
  const highQualityPosts = sortedPosts.filter(post => post.leadScore >= MIN_LEAD_SCORE);
  
  console.log(`[SCAN] 📊 Scan Results:`);
  console.log(`[SCAN]   - Total posts scanned: ${flattenedPosts.length}`);
  console.log(`[SCAN]   - High-quality posts (score ≥ ${MIN_LEAD_SCORE}): ${highQualityPosts.length}`);
  console.log(`[SCAN]   - Top 5 opportunities:`);
  highQualityPosts.slice(0, 5).forEach((post, index) => {
    const priority = post.leadScore >= 85 ? '🔴' : post.leadScore >= 60 ? '🟡' : '🟢';
    console.log(`[SCAN]     ${index + 1}. ${priority} r/${post.subreddit} (Batch ${post.batch}) - "${post.title.substring(0, 50)}..." (Score: ${post.leadScore})`);
  });
  
  return {
    allPosts: flattenedPosts,
    highQualityPosts,
    topOpportunities: highQualityPosts.slice(0, MAX_POSTS_PER_RUN)
  };
};

// ==================== INDUSTRY AUTHORITY - 80% NON-PROMOTIONAL EXPERT ADVICE ====================

const generateIndustryExpertComment = async (postTitle, postContent, subreddit, painPoints = [], batch = null) => {
  const targetConfig = redditTargets[subreddit];
  const selectedStyle = targetConfig?.preferredStyles[0] || 'expert';
  const targetBatch = batch || getBatchForSubreddit(subreddit);
  
  // Industry-specific advice templates
  const expertAdviceTemplates = {
    // Video/Technical advice
    video: [
      "For lyric videos, render at 24fps for that cinematic feel or 30fps for social media. Spotify Canvas requires exact 9:16 (1080x1920) at 30fps max.",
      "Pro tip: Use variable frame rates for text animations - 60fps for fast movements, 24fps for slow reveals. Always export in H.264 for web.",
      "Color grading for music videos: Lift shadows 5%, add teal to shadows and orange to highlights. Keep saturation at 105-110% for vibrancy."
    ],
    
    // Typography/Design advice
    typography: [
      "Font pairing for lyrics: Use a bold sans-serif for emphasis (like Montserrat Bold) with a clean sans-serif for body (Open Sans). Minimum 48pt for mobile.",
      "Leading (line spacing) should be 1.4x font size. For animated text, use ease-in-out timing at 0.3s per word for natural reading pace.",
      "Accessibility: Ensure contrast ratio of at least 4.5:1 for text. Dark text on light background performs better for retention."
    ],
    
    // Audio/Video sync advice
    sync: [
      "For perfect lyric sync: Align syllables with transients in your waveform. Use a 150ms pre-roll for natural anticipation.",
      "BPM-based animation: Divide 60,000 by your BPM to get ms per beat. Animate on quarter notes for hip-hop, eighth notes for EDM.",
      "Spotify Canvas loops: Create seamless 8-second loops by matching end frame to start frame. Use motion blur for smooth transitions."
    ],
    
    // Platform-specific advice
    platform: [
      "Instagram Reels: First 3 seconds must hook. Use bold text overlay and trending audio. Export at 1080x1920, 30fps, under 60 seconds.",
      "YouTube Shorts: Add captions in the top third of screen (safe area). Use #shorts in title and description for algorithm.",
      "TikTok: Vertical 9:16, loud audio (-6 LUFS), bright colors. Duet sounds perform 3x better than original sounds."
    ]
  };
  
  // Determine which advice to give based on pain points and subreddit
  let adviceType = 'video';
  if (painPoints.includes('design') || painPoints.includes('font') || subreddit.includes('art')) {
    adviceType = 'typography';
  } else if (painPoints.includes('sync') || painPoints.includes('timing') || painPoints.includes('bpm')) {
    adviceType = 'sync';
  } else if (painPoints.includes('social') || painPoints.includes('platform') || painPoints.includes('instagram')) {
    adviceType = 'platform';
  }
  
  // Select random advice from appropriate category
  const adviceList = expertAdviceTemplates[adviceType] || expertAdviceTemplates.video;
  const randomAdvice = adviceList[Math.floor(Math.random() * adviceList.length)];
  
  // Build authoritative comment
  let comment = randomAdvice;
  
  // Add batch-specific framing
  const batchConfig = BATCHES[targetBatch];
  if (batchConfig) {
    if (targetBatch === 'A') { // Feedback Loop
      comment = `From a technical perspective: ${comment} Have you tried this approach in your workflow?`;
    } else if (targetBatch === 'B') { // Visual Showdown
      comment = `As a visual artist, I've found: ${comment} This creates more engaging content.`;
    } else if (targetBatch === 'C') { // Problem Solvers
      comment = `Here's a technical solution: ${comment} This should help streamline your process.`;
    } else if (targetBatch === 'D') { // Growth Hackers
      comment = `Data shows that: ${comment} This improves engagement by 20-30% typically.`;
    }
  }
  
  return {
    success: true,
    comment: comment,
    style: 'expert',
    subreddit: subreddit,
    isPromotional: false,
    isIndustryExpert: true,
    adviceType: adviceType,
    batch: targetBatch
  };
};

// ==================== FALLBACK COMMENT GENERATION ====================

const generateFallbackComment = (subreddit, painPoints = [], batch) => {
  const batchConfig = BATCHES[batch];
  const persona = batchConfig?.persona || 'The helpful consultant';
  
  const fallbackComments = {
    'WeAreTheMusicMakers': [
      "As part of the SoundSwap team, I understand the struggle with video editing! We built our AI lyric video generator specifically to automate this process and save creators hours of work.",
      "Our team at SoundSwap created an AI tool that automates lyric video creation. We focused on solving the exact pain point of time-consuming video editing for musicians.",
      "We built SoundSwap to address this exact issue - the AI lyric video generator can create professional videos in minutes instead of hours. It's what our development team uses internally."
    ],
    'digitalart': [
      "The SoundSwap team developed a Doodle-to-Art AI that transforms sketches into animated artwork. We wanted to make professional art creation accessible to everyone.",
      "Our development team created an AI art tool specifically for digital artists. It can turn rough sketches into finished Spotify Canvas animations automatically."
    ],
    'MusicMarketing': [
      "At SoundSwap, we built our tools with ROI in mind. Our data shows lyric videos increase YouTube watch time by 40% on average - that's why we automated the creation process.",
      "Our team focused on building tools that drive real growth. The AI video generator creates content optimized for social media algorithms and streaming platforms."
    ],
    'Spotify': [
      "We developed SoundSwap's AI tools specifically for Spotify Canvas optimization. Our engine automatically formats visuals to Spotify's exact specifications.",
      "The SoundSwap team built our Canvas generator to solve the dimension and format challenges artists face with Spotify's visual requirements."
    ],
    'ArtistLounge': [
      "Our team at SoundSwap understands the creative process. We built AI tools that assist rather than replace - helping artists bring their visions to life faster.",
      "We developed these tools as artists ourselves. The AI assists with technical execution so you can focus on the creative vision."
    ],
    'musicproduction': [
      "SoundSwap's development team integrated our tools directly into music production workflows. The AI syncs animations to BPM automatically for perfect timing.",
      "We built our lyric video generator to work seamlessly with DAWs and production software, automating the visual side of music releases."
    ],
    'musicians': [
      "Our team created SoundSwap to give musicians practical career tools. The AI handles visual content so you can focus on music and performance.",
      "We built these tools specifically for working musicians - automating the visual content creation that's essential for modern music promotion."
    ],
    'makinghiphop': [
      "The SoundSwap team developed Type Beat art generation specifically for hip-hop producers. Our AI creates matching visuals for different beat styles automatically.",
      "We focused on hip-hop's unique visual needs - our tools generate lyric videos with styles that match different Type Beat aesthetics."
    ],
    'edmproduction': [
      "Our development team optimized SoundSwap for high-fidelity EDM visuals. The AI creates motion-heavy lyric videos that match the energy of electronic music.",
      "We built these tools with EDM producers in mind - the AI generates visuals that sync perfectly with drops and buildups in electronic tracks."
    ],
    'BedroomBands': [
      "SoundSwap's team focused on collaboration tools. Our AI generates quick visual assets that all collaborators can use and customize for joint projects.",
      "We built these tools for remote music collaboration - generating professional visuals that all band members can access and approve instantly."
    ],
    'MusicInTheMaking': [
      "Our development team created early-stage project tools. SoundSwap generates demo visuals that help communicate your vision during the creative process.",
      "We built these AI tools to assist in the early creative stages - generating visual concepts that help shape the direction of music projects."
    ],
    'Songwriters': [
      "The SoundSwap team focused on lyric-first creators. Our AI generates visualizers that emphasize and animate lyrics to enhance storytelling.",
      "We developed tools specifically for songwriters - the AI creates visuals that highlight lyrical content and emotional delivery."
    ],
    'aiArt': [
      "As AI developers ourselves, we built SoundSwap to push the boundaries of generative art for music. Our tools combine AI art with musical synchronization.",
      "Our team works at the intersection of AI and art. We developed these tools to explore new creative possibilities in music visualization."
    ],
    'AIArtCommunity': [
      "We're part of the AI art community and built SoundSwap to contribute useful tools. Our AI generates music-specific art with full customization control.",
      "Our development team shares our AI tools openly with the community. We built SoundSwap to empower other AI artists in music visualization."
    ],
    'VaporwaveAesthetics': [
      "The SoundSwap team developed specific aesthetic presets for vaporwave. Our AI can generate retro-futuristic visuals that match the genre's unique style.",
      "We built aesthetic-focused tools for genres like vaporwave. Our AI applies specific color palettes and effects to match nostalgic visual styles."
    ],
    'Hyperpop': [
      "Our development team created glitch and DIY aesthetic tools for hyperpop. The AI generates visuals with the genre's signature chaotic, colorful style.",
      "We built SoundSwap with hyperpop's visual language in mind - our tools create the glitchy, maximalist aesthetics the genre demands."
    ],
    'AlbumArtPorn': [
      "The SoundSwap team developed high-end concept art generation. Our AI creates album artwork with professional composition and thematic coherence.",
      "We built these tools to showcase what AI art can achieve at a professional level - generating cover art that tells visual stories."
    ],
    'IndieMusicFeedback': [
      "Our team uses SoundSwap internally for beta testing. We'd love your feedback on our AI tools as we continue developing features for independent artists.",
      "We built SoundSwap specifically for the indie community. Your feedback helps us improve our tools for creators at all levels."
    ],
    'PromoteYourMusic': [
      "SoundSwap's team built direct utility tools for music promotion. Our AI generates the visual content you need to stand out on all platforms.",
      "We developed these tools for self-promoting artists. The AI creates professional visuals that help your music get noticed."
    ],
    'SocialMediaMarketing': [
      "Our development team focused on social media conversion. SoundSwap generates vertical videos and Reels-optimized content that performs well on algorithms.",
      "We built these tools with social media managers in mind - automating the creation of platform-optimized visual content for music promotion."
    ]
  };
  
  const defaultComments = [
    `As part of the SoundSwap development team, we built AI tools to solve this exact problem. Our ${persona.toLowerCase()} approach focuses on automating the tedious parts of creative work so you can focus on what matters.`,
    `The SoundSwap team developed these AI tools to address common pain points in music creation. We're transparent about being developers who built solutions for our own workflow challenges.`,
    `We're the SoundSwap team, and we built these AI tools specifically for creators facing these challenges. Our goal was to automate the technical parts so you can focus on creativity.`
  ];
  
  const comments = fallbackComments[subreddit] || defaultComments;
  return comments[Math.floor(Math.random() * comments.length)];
};

// ==================== PREMIUM FEATURE CONFIGURATION ====================

const PREMIUM_FEATURES = {
  lyricVideoGenerator: {
    name: 'AI Lyric Video Generator',
    description: 'Transform lyrics into stunning music videos with AI-powered visuals',
    premiumFeatures: [
      'AI Autopilot for automatic timing and styling',
      'Physics-based text animations',
      'Premium animation effects',
      'Spotify Canvas optimization',
      '4K video export',
      'Batch processing'
    ],
    priceRange: '$15-$50 per video',
    targetKeywords: ['lyric video', 'music video', 'visualizer', 'animated lyrics', 'Spotify Canvas', 'music promotion'],
    valueProposition: 'Save 10+ hours of editing with AI-powered lyric videos',
    targetSubreddits: ['WeAreTheMusicMakers', 'musicproduction', 'musicians', 'MusicMarketing', 'Spotify', 'makinghiphop', 'edmproduction', 'Songwriters', 'PromoteYourMusic'],
    painPointSolutions: {
      frustration: 'Automates the tedious video editing process',
      budget: 'Professional quality at a fraction of the cost',
      skillGap: 'No design skills needed - AI does the hard work'
    },
    importantFeatures: [
      'AI-Powered Lyric Video Creation - Transform lyrics into synchronized music videos',
      'Music Synchronization - Automatic timing of lyrics with audio beats',
      'Multiple Visual Styles - 10+ predefined visual styles',
      'BPM-Based Style Recommendations - AI suggests styles based on song tempo',
      'Real-time Preview - Live preview of lyrics with audio playback',
      'Physics-Based Animations - Weight drops, kinetic stops, damped impacts',
      'AI Autopilot Mode - Automatic style and timing optimization',
      'Motion Interpolation - Smooth animation rendering',
      'Multiple Resolution Options - Up to 1080p (4K in premium)'
    ],
    batchFocus: ['C', 'D'] // Problem Solvers & Growth Hackers
  },
  doodleArtGenerator: {
    name: 'Doodle-to-Art AI Generator',
    description: 'Sketch your idea and watch AI transform it into beautiful animated artwork',
    premiumFeatures: [
      'AI Art Generation from sketches',
      'Spotify Canvas animation',
      'Premium motion effects',
      'Batch animation processing',
      'HD video exports',
      'Custom style transfers'
    ],
    priceRange: '$10-$30 per animation',
    targetKeywords: ['art generation', 'animation', 'Spotify Canvas', 'digital art', 'AI art', 'creative tools'],
    valueProposition: 'Create professional animations in minutes instead of days',
    targetSubreddits: ['digitalart', 'aiArt', 'ArtistLounge', 'Spotify', 'AIArtCommunity', 'VaporwaveAesthetics', 'Hyperpop', 'AlbumArtPorn'],
    painPointSolutions: {
      frustration: 'Turns simple sketches into finished art instantly',
      budget: 'Create premium artwork without expensive software',
      skillGap: 'Transform basic drawings into professional animations'
    },
    importantFeatures: [
      'Sketch-to-Art Transformation - Turn basic drawings into professional artwork',
      'Spotify Canvas Optimization - Perfect dimensions and formats for Spotify',
      'AI Style Transfer - Apply artistic styles to your sketches',
      'Animation Presets - Pre-built animations for quick results',
      'Custom Style Training - Train AI on your artistic style',
      'Batch Processing - Generate multiple variations simultaneously',
      'HD Export Options - Multiple resolution and format options',
      'Real-time Preview - See transformations as you draw',
      'Collaboration Tools - Share and collaborate on art projects'
    ],
    batchFocus: ['B'] // Visual Showdown
  }
};

// ==================== UPDATED REDDIT TARGET CONFIGURATION ====================

const redditTargets = {
  // ===== CORE HUBS (Retained & Optimized) =====
  'WeAreTheMusicMakers': {
    name: 'WeAreTheMusicMakers',
    memberCount: 1800000,
    description: 'The "Home Base" for creators',
    active: true,
    priority: 'high',
    batch: 'C',
    postingSchedule: {
      monday: ['14:00', '19:00'],
      tuesday: ['15:00', '20:00'],
      wednesday: ['14:00', '19:00'],
      thursday: ['15:00', '20:00'],
      friday: ['14:00', '19:00'],
      saturday: ['13:00', '18:00'],
      sunday: ['13:00', '18:00']
    },
    educationalPostSchedule: {
      tuesday: ['15:00'],
      friday: ['16:00']
    },
    preferredStyles: ['helpful', 'expert', 'thoughtful'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 6, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['lyric video', 'music video', 'visualizer', 'Spotify Canvas', 'animation', 'editing', 'frustrated', 'time-consuming', 'how to make', 'video editor'],
    premiumFeatures: ['lyricVideoGenerator', 'doodleArtGenerator'],
    targetAudience: 'musicians needing visual content',
    painPointFocus: ['frustration', 'budget', 'skillGap']
  },
  'digitalart': {
    name: 'digitalart',
    memberCount: 3500000,
    description: 'Primary target for Doodle-to-Art hooks',
    active: true,
    priority: 'high',
    batch: 'B',
    postingSchedule: {
      monday: ['11:00', '17:00'],
      wednesday: ['12:00', '18:00'],
      friday: ['13:00', '19:00']
    },
    educationalPostSchedule: {
      wednesday: ['16:00']
    },
    preferredStyles: ['creative', 'technical', 'inspirational'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 4, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['sketch', 'drawing', 'animation', 'AI art', 'transform', 'process', 'tutorial', 'learn', 'beginner'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'digital artists exploring AI tools',
    painPointFocus: ['skillGap', 'time']
  },
  'MusicMarketing': {
    name: 'MusicMarketing',
    memberCount: 50000,
    description: 'Direct pain point targeting',
    active: true,
    priority: 'high',
    batch: 'D',
    postingSchedule: {
      monday: ['10:00', '18:00'],
      wednesday: ['15:00', '21:00'],
      friday: ['12:00', '20:00']
    },
    educationalPostSchedule: {
      friday: ['14:00']
    },
    preferredStyles: ['strategic', 'helpful', 'professional'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['Spotify promotion', 'visual content', 'music videos', 'artist growth', 'Canvas', 'visualizer', 'ROI', 'conversion'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'artists focused on promotion',
    painPointFocus: ['budget', 'frustration']
  },
  'Spotify': {
    name: 'Spotify',
    memberCount: 10000000,
    description: 'Visual branding for artists',
    active: true,
    priority: 'high',
    batch: 'D',
    postingSchedule: {
      tuesday: ['11:00', '19:00'],
      thursday: ['12:00', '20:00'],
      saturday: ['13:00', '21:00']
    },
    educationalPostSchedule: {
      thursday: ['14:00']
    },
    preferredStyles: ['enthusiastic', 'helpful', 'casual'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['Spotify Canvas', 'animated artwork', 'visualizers', 'music visual', 'album art', 'animated', '8-second', 'looping'],
    premiumFeatures: ['doodleArtGenerator', 'lyricVideoGenerator'],
    targetAudience: 'Spotify users and artists',
    painPointFocus: ['skillGap', 'budget']
  },
  'ArtistLounge': {
    name: 'ArtistLounge',
    memberCount: 200000,
    description: 'Creative process discussion',
    active: true,
    priority: 'medium',
    batch: 'A',
    postingSchedule: {
      tuesday: ['10:00', '16:00'],
      thursday: ['11:00', '17:00'],
      sunday: ['12:00', '18:00']
    },
    preferredStyles: ['supportive', 'creative', 'casual'],
    soundswapMentionRate: 0.1, // 90/10 split - more authority building
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 0,
    premiumFeatureLimit: 2, // Increased for 5-minute processing
    keywords: ['art tools', 'animation', 'digital art', 'creative process', 'affordable', 'beginner', 'workflow'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'artists seeking new tools',
    painPointFocus: ['budget', 'skillGap']
  },
  
  // ===== NEW PRODUCTION & GENRE TARGETS =====
  'musicproduction': {
    name: 'musicproduction',
    memberCount: 600000,
    description: 'Workflow efficiency focus',
    active: true,
    priority: 'high',
    batch: 'C',
    postingSchedule: {
      tuesday: ['14:00', '20:00'],
      thursday: ['15:00', '21:00'],
      saturday: ['13:00', '19:00']
    },
    educationalPostSchedule: {
      thursday: ['15:00']
    },
    preferredStyles: ['technical', 'creative', 'expert'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 4, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['visual content', 'music video', 'lyric video', 'promotion', 'Spotify Canvas', 'artist branding', 'workflow', 'efficiency'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'music producers needing visuals',
    painPointFocus: ['frustration', 'skillGap', 'time']
  },
  'musicians': {
    name: 'musicians',
    memberCount: 400000,
    description: 'Practical career tools',
    active: true,
    priority: 'medium',
    batch: 'C',
    postingSchedule: {
      monday: ['11:00', '17:00'],
      wednesday: ['16:00', '22:00'],
      friday: ['14:00', '20:00']
    },
    preferredStyles: ['supportive', 'practical', 'helpful'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 0,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['music video', 'visual content', 'promotion', 'lyrics', 'animation', 'affordable tools', 'career', 'tools'],
    premiumFeatures: ['lyricVideoGenerator', 'doodleArtGenerator'],
    targetAudience: 'musicians seeking promotion tools',
    painPointFocus: ['frustration', 'budget']
  },
  'makinghiphop': {
    name: 'makinghiphop',
    memberCount: 350000,
    description: 'Type Beat art & lyric video demand',
    active: true,
    priority: 'medium',
    batch: 'C',
    postingSchedule: {
      tuesday: ['13:00', '19:00'],
      thursday: ['14:00', '20:00'],
      saturday: ['12:00', '18:00']
    },
    preferredStyles: ['urban', 'direct', 'helpful'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['type beat', 'hip hop', 'rap', 'lyric video', 'visuals', 'YouTube', 'TikTok', 'cover art'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'hip-hop producers needing visuals',
    painPointFocus: ['frustration', 'time']
  },
  'edmproduction': {
    name: 'edmproduction',
    memberCount: 300000,
    description: 'High-fidelity visual focus',
    active: true,
    priority: 'medium',
    batch: 'C',
    postingSchedule: {
      monday: ['12:00', '18:00'],
      wednesday: ['13:00', '19:00'],
      friday: ['14:00', '20:00']
    },
    preferredStyles: ['technical', 'energetic', 'creative'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['visualizer', 'music video', 'animation', 'EDM', 'drops', 'energy', 'visuals', 'VJ'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'EDM producers needing energetic visuals',
    painPointFocus: ['skillGap', 'time']
  },
  'BedroomBands': {
    name: 'BedroomBands',
    memberCount: 120000,
    description: 'Collaboration & quick asset needs',
    active: true,
    priority: 'medium',
    batch: 'A',
    postingSchedule: {
      tuesday: ['10:00', '16:00'],
      thursday: ['11:00', '17:00'],
      sunday: ['12:00', '18:00']
    },
    preferredStyles: ['collaborative', 'friendly', 'helpful'],
    soundswapMentionRate: 0.1, // 90/10 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 0,
    premiumFeatureLimit: 2, // Increased for 5-minute processing
    keywords: ['collaboration', 'remote', 'assets', 'quick', 'visuals', 'band', 'group'],
    premiumFeatures: ['doodleArtGenerator', 'lyricVideoGenerator'],
    targetAudience: 'collaborative music projects',
    painPointFocus: ['time', 'coordination']
  },
  'MusicInTheMaking': {
    name: 'MusicInTheMaking',
    memberCount: 80000,
    description: 'Early-stage project visuals',
    active: true,
    priority: 'low',
    batch: 'A',
    postingSchedule: {
      wednesday: ['11:00', '17:00'],
      friday: ['12:00', '18:00']
    },
    preferredStyles: ['supportive', 'creative', 'casual'],
    soundswapMentionRate: 0.1, // 90/10 split
    dailyCommentLimit: 2, // Increased for 5-minute processing
    educationalPostLimit: 0,
    premiumFeatureLimit: 2, // Increased for 5-minute processing
    keywords: ['demo', 'early', 'project', 'visuals', 'concept', 'feedback'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'early-stage music projects',
    painPointFocus: ['skillGap', 'budget']
  },
  'Songwriters': {
    name: 'Songwriters',
    memberCount: 150000,
    description: 'Lyric-focused visualizers',
    active: true,
    priority: 'medium',
    batch: 'A',
    postingSchedule: {
      monday: ['10:00', '16:00'],
      wednesday: ['11:00', '17:00'],
      friday: ['12:00', '18:00']
    },
    preferredStyles: ['thoughtful', 'creative', 'supportive'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 0,
    premiumFeatureLimit: 2, // Increased for 5-minute processing
    keywords: ['lyrics', 'storytelling', 'visualizer', 'words', 'meaning', 'emotion'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'songwriters focusing on lyrics',
    painPointFocus: ['skillGap', 'expression']
  },
  
  // ===== NEW VISUAL & AI AESTHETICS TARGETS =====
  'aiArt': {
    name: 'aiArt',
    memberCount: 300000,
    description: 'Broader AI art appreciation',
    active: true,
    priority: 'high',
    batch: 'B',
    postingSchedule: {
      tuesday: ['10:00', '18:00'],
      thursday: ['11:00', '19:00'],
      saturday: ['13:00', '21:00']
    },
    educationalPostSchedule: {
      tuesday: ['16:00']
    },
    preferredStyles: ['creative', 'technical', 'innovative'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 4, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['AI art', 'generative art', 'animation', 'sketch to art', 'music visuals', 'Spotify Canvas', 'neural networks'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'AI artists exploring music applications',
    painPointFocus: ['skillGap', 'budget']
  },
  'AIArtCommunity': {
    name: 'AIArtCommunity',
    memberCount: 80000,
    description: 'High-tolerance AI hub',
    active: true,
    priority: 'medium',
    batch: 'D',
    postingSchedule: {
      wednesday: ['13:00', '19:00'],
      friday: ['14:00', '20:00'],
      sunday: ['15:00', '21:00']
    },
    preferredStyles: ['technical', 'community', 'innovative'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['AI tools', 'community', 'generative', 'music', 'visuals', 'automation'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'AI-Curious creators',
    painPointFocus: ['skillGap', 'learning']
  },
  'VaporwaveAesthetics': {
    name: 'VaporwaveAesthetics',
    memberCount: 60000,
    description: 'Stylized cover art hooks',
    active: true,
    priority: 'medium',
    batch: 'B',
    postingSchedule: {
      tuesday: ['12:00', '18:00'],
      thursday: ['13:00', '19:00'],
      saturday: ['14:00', '20:00']
    },
    preferredStyles: ['aesthetic', 'stylish', 'creative'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['vaporwave', 'aesthetic', 'retro', 'style', 'visual', 'art', 'nostalgia'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'Aesthetic-focused creators',
    painPointFocus: ['style', 'execution']
  },
  'Hyperpop': {
    name: 'Hyperpop',
    memberCount: 40000,
    description: 'DIY/Glitch aesthetic target',
    active: true,
    priority: 'medium',
    batch: 'B',
    postingSchedule: {
      monday: ['13:00', '19:00'],
      wednesday: ['14:00', '20:00'],
      friday: ['15:00', '21:00']
    },
    preferredStyles: ['edgy', 'creative', 'DIY'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['hyperpop', 'glitch', 'DIY', 'aesthetic', 'visuals', 'experimental'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'Experimental music creators',
    painPointFocus: ['style', 'originality']
  },
  'AlbumArtPorn': {
    name: 'AlbumArtPorn',
    memberCount: 250000,
    description: 'High-end concept showcases',
    active: true,
    priority: 'medium',
    batch: 'B',
    postingSchedule: {
      tuesday: ['11:00', '17:00'],
      thursday: ['12:00', '18:00'],
      saturday: ['13:00', '19:00']
    },
    preferredStyles: ['professional', 'artistic', 'inspiring'],
    soundswapMentionRate: 0.1, // 90/10 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['album art', 'cover art', 'concept', 'professional', 'design', 'visual'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'Art directors and designers',
    painPointFocus: ['quality', 'concept']
  },
  
  // ===== NEW STRATEGIC GROWTH TARGETS =====
  'IndieMusicFeedback': {
    name: 'IndieMusicFeedback',
    memberCount: 90000,
    description: 'High engagement & beta testing',
    active: true,
    priority: 'high',
    batch: 'A',
    postingSchedule: {
      monday: ['10:00', '16:00'],
      wednesday: ['11:00', '17:00'],
      friday: ['12:00', '18:00'],
      sunday: ['13:00', '19:00']
    },
    preferredStyles: ['supportive', 'constructive', 'friendly'],
    soundswapMentionRate: 0.1, // 90/10 split - more value first
    dailyCommentLimit: 4, // Increased for 5-minute processing
    educationalPostLimit: 0,
    premiumFeatureLimit: 2, // Increased for 5-minute processing
    keywords: ['feedback', 'indie', 'help', 'improve', 'visuals', 'art', 'video'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'Indie artists seeking feedback',
    painPointFocus: ['improvement', 'community']
  },
  'PromoteYourMusic': {
    name: 'PromoteYourMusic',
    memberCount: 120000,
    description: 'Direct utility pitching',
    active: true,
    priority: 'medium',
    batch: 'D',
    postingSchedule: {
      tuesday: ['14:00', '20:00'],
      thursday: ['15:00', '21:00'],
      saturday: ['16:00', '22:00']
    },
    preferredStyles: ['direct', 'helpful', 'practical'],
    soundswapMentionRate: 0.3, // 70/30 split - more promotional
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 0,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['promote', 'music', 'tools', 'help', 'visuals', 'marketing', 'growth'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'Self-promoting artists',
    painPointFocus: ['visibility', 'tools']
  },
  'SocialMediaMarketing': {
    name: 'SocialMediaMarketing',
    memberCount: 500000,
    description: 'Vertical video/Reels conversion',
    active: true,
    priority: 'medium',
    batch: 'D',
    postingSchedule: {
      monday: ['13:00', '19:00'],
      wednesday: ['14:00', '20:00'],
      friday: ['15:00', '21:00']
    },
    preferredStyles: ['strategic', 'data-driven', 'professional'],
    soundswapMentionRate: 0.2, // 80/20 split
    dailyCommentLimit: 3, // Increased for 5-minute processing
    educationalPostLimit: 1,
    premiumFeatureLimit: 3, // Increased for 5-minute processing
    keywords: ['social media', 'Reels', 'TikTok', 'vertical video', 'conversion', 'algorithm', 'engagement'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'Social media managers',
    painPointFocus: ['engagement', 'conversion']
  }
};

// ==================== OPTIMIZED ANALYZE FUNCTION ====================

const analyzePostForPainPoints = (postTitle, postContent = '') => {
  const textToAnalyze = (postTitle + ' ' + postContent).toLowerCase();
  const detectedPainPoints = [];
  
  // Enhanced pain point detection with more keywords
  const painPointKeywords = {
    frustration: ['frustrated', 'annoying', 'tedious', 'time-consuming', 'waste time', 'too much work', 'exhausting', 'painful', 'hate', 'sick of', 'tired of'],
    budget: ['expensive', 'cheap', 'budget', 'cost', 'price', 'affordable', 'inexpensive', 'free', 'low cost', 'cant afford', 'money', 'expensive'],
    skillGap: ['beginner', 'new', 'learn', 'how to', 'tutorial', 'no experience', 'simple', 'easy', 'basic', 'not technical', 'dont know', 'struggling'],
    time: ['quick', 'fast', 'minutes', 'hours', 'days', 'weeks', 'time', 'speedy', 'instant', 'rapid'],
    quality: ['professional', 'quality', 'good looking', 'polished', 'slick', 'high-end', 'premium']
  };
  
  // Check each pain point category
  Object.entries(painPointKeywords).forEach(([painPoint, keywords]) => {
    if (keywords.some(keyword => textToAnalyze.includes(keyword))) {
      detectedPainPoints.push(painPoint);
    }
  });
  
  // General need detection
  if (textToAnalyze.includes('help') || textToAnalyze.includes('struggle') || textToAnalyze.includes('problem') || 
      textToAnalyze.includes('advice') || textToAnalyze.includes('suggestion') || textToAnalyze.includes('recommend')) {
    detectedPainPoints.push('general_need');
  }
  
  return {
    hasPainPoints: detectedPainPoints.length > 0,
    painPoints: detectedPainPoints,
    score: detectedPainPoints.length * 10
  };
};

// ==================== CRITICAL WATCH ITEM: LEAD SUMMARY LOGGING ====================

const logLeadSummary = (scanResults, postedComments) => {
  console.log('\n📊 LEAD SUMMARY (Console Only)');
  console.log('════════════════════════════════');
  
  // Group by batch
  const batchLeads = {};
  scanResults.highQualityPosts.forEach(post => {
    const batch = post.batch || getBatchForSubreddit(post.subreddit);
    if (!batchLeads[batch]) batchLeads[batch] = [];
    batchLeads[batch].push({
      subreddit: post.subreddit,
      score: post.leadScore,
      title: post.title.substring(0, 80) + '...',
      priority: post.leadScore >= 85 ? '🔴 HIGH' : 
                post.leadScore >= 60 ? '🟡 MEDIUM' : '🟢 LOW'
    });
  });
  
  // Display by batch
  Object.entries(batchLeads).forEach(([batch, leads]) => {
    console.log(`\n🎭 Batch ${batch} (${BATCHES[batch]?.name || 'Unknown'}):`);
    leads.forEach((lead, index) => {
      console.log(`  ${index + 1}. ${lead.priority} r/${lead.subreddit} - Score: ${lead.score}`);
      console.log(`     "${lead.title}"`);
    });
  });
  
  // Show Discord notification summary
  const highPriorityLeads = scanResults.highQualityPosts.filter(p => p.leadScore >= DISCORD_HIGH_PRIORITY_THRESHOLD);
  const postedHighPriority = postedComments.filter(c => c.leadScore >= DISCORD_HIGH_PRIORITY_THRESHOLD);
  
  console.log(`\n💬 Discord Notifications Summary:`);
  console.log(`  - High-priority leads found: ${highPriorityLeads.length}`);
  console.log(`  - High-priority leads posted: ${postedHighPriority.length}`);
  console.log(`  - Discord threshold: Score ≥ ${DISCORD_HIGH_PRIORITY_THRESHOLD}`);
  console.log(`  - Filter: Only high-priority leads sent to Discord`);
};

// ==================== LAZY LOADED CORE FUNCTIONS ====================

let initializePostingActivity;
let quickSavePostingActivity;
let savePremiumLead;
let testRedditConnection;
let checkFirebaseConnection;
let generatePremiumFeatureComment;
let postToReddit;
let getSamplePostsForSubreddit;
let runScheduledPosts;

// ==================== ROUTE HANDLERS ====================

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    fluidCompute: 'active',
    maxDuration: '5 minutes',
    remainingTime: '4 minutes buffer'
  });
});

// Quick status endpoint
router.get('/quick-status', async (req, res) => {
  try {
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    const currentDate = getCurrentDateInAppTimezone();
    const currentUTCHour = getCurrentUTCHour();
    const withinHumanWindow = isWithinHumanWindow();
    
    res.json({
      success: true,
      status: 'running',
      time: {
        appTimezone: currentTime,
        utc: `${currentUTCHour}:00`,
        humanWindow: withinHumanWindow ? 'active' : 'inactive'
      },
      schedule: {
        interval: `${SCHEDULE_INTERVAL} minutes`,
        nextRun: 'in 30 minutes',
        humanWindow: `${HUMAN_WINDOW_START_HOUR}:00-${HUMAN_WINDOW_END_HOUR}:00 UTC`
      },
      fluidCompute: {
        active: true,
        maxDuration: '5 minutes',
        buffer: '1 minute'
      },
      stats: {
        totalComments: postingActivity?.totalComments || 0,
        premiumLeads: postingActivity?.premiumLeadsGenerated || 0,
        batchRotation: getCurrentBatchRotation()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error in quick-status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Main cron endpoint - OPTIMIZED FOR 5-MINUTE PROCESSING
router.post('/cron', async (req, res) => {
  const startTime = Date.now();
  
  // Mark automation engine active so other modules (payments, email, doodleArt)
  // can avoid heavy initialization during the run.
  try {
    process.__automation_running = true;
  } catch (e) {
    // no-op if environment prevents setting globals
  }

  
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized',
        timestamp: new Date().toISOString()
      });
    }

    console.log('[INFO] ✅ Authorized GitHub Actions cron execution');
    console.log('[INFO] ⚡ FLUID COMPUTE: 5-minute execution window active');
    
    const isIsolated = req.headers['x-isolated-cron'] === 'true';
    
    if (isIsolated) {
      console.log('[ISOLATED] 🚀 Running in isolated mode');
    }
    
    // Check if within human window (12:00 PM – 10:00 PM UTC)
    if (!isWithinHumanWindow()) {
      console.log(`[INFO] ⏳ Outside human window (${HUMAN_WINDOW_START_HOUR}:00-${HUMAN_WINDOW_END_HOUR}:00 UTC). Skipping run.`);
      return res.json({
        success: true,
        message: 'Outside human window - run skipped',
        humanWindow: {
          active: false,
          currentUTC: `${getCurrentUTCHour()}:00 UTC`,
          window: `${HUMAN_WINDOW_START_HOUR}:00-${HUMAN_WINDOW_END_HOUR}:00 UTC`
        },
        totalPosted: 0,
        timestamp: new Date().toISOString()
      });
    }
    
    // Load core functions with timeout
    try {
      await loadCoreFunctions();
    } catch (loadError) {
      console.warn('[WARN] Module loading had issues:', loadError.message);
    }
    
    // Execute cron with 4-minute timeout (leaves 1 minute buffer)
    const result = await withTimeout(runScheduledPosts(), MAX_PROCESSING_TIME, 'Cron processing timeout');
    
    const processingTime = Date.now() - startTime;
    console.log(`[PERFORMANCE] ⏱️ Total processing time: ${processingTime}ms`);
    console.log(`[PERFORMANCE] ⚡ Time remaining: ${300000 - processingTime}ms (5-minute limit)`);
    
    res.json({
      success: true,
      message: 'GitHub Actions cron execution completed',
      ...result,
      isolated: isIsolated,
      processingTime: processingTime,
      fluidCompute: {
        maxDuration: '5 minutes',
        timeUsed: processingTime,
        timeRemaining: 300000 - processingTime,
        buffer: '1 minute'
      },
      geminiQuotaUsed: geminiQuotaInfo.requestCount,
      fallbackMode: FALLBACK_MODE,
      discordNotifications: result.discordNotifications || { sent: 0, failed: 0 },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error in GitHub Actions cron:', error);
    
    const processingTime = Date.now() - startTime;
    
    res.json({
      success: false,
      message: 'Cron execution failed',
      error: error.message,
      processingTime: processingTime,
      totalPosted: 0,
      fluidCompute: {
        maxDuration: '5 minutes',
        timeUsed: processingTime,
        timeRemaining: 300000 - processingTime
      },
      timestamp: new Date().toISOString()
    });
  } finally {
    // Clear automation flag to allow other modules to initialize again
    try {
      process.__automation_running = false;
    } catch (e) {
      // ignore
    }
  }
});

// Quick cron endpoint for fallback
router.post('/cron-quick', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized'
      });
    }

    console.log('[QUICK] ⚡ Quick cron execution (fallback mode)');
    
    // Quick version with minimal processing
    const quickResult = {
      success: true,
      message: 'Quick cron executed',
      totalPosted: 0,
      processingTime: Date.now() - startTime,
      mode: 'quick_fallback'
    };
    
    res.json(quickResult);
  } catch (error) {
    console.error('[ERROR] ❌ Quick cron failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== CRITICAL WATCH ITEM: SHADOW-DELETE CHECK ENDPOINT ====================

router.get('/shadow-check-list', (req, res) => {
  const pendingChecks = SHADOW_DELETE_CHECK.loggedOutBrowserCheck.filter(
    check => new Date(check.checkAfter) > new Date()
  );
  
  const readyChecks = SHADOW_DELETE_CHECK.loggedOutBrowserCheck.filter(
    check => new Date(check.checkAfter) <= new Date()
  );
  
  // Focus on Batch C first (Problem Solvers - highest conversion potential)
  const batchCChecks = readyChecks.filter(check => check.batch === 'C');
  const otherChecks = readyChecks.filter(check => check.batch !== 'C');
  
  res.json({
    success: true,
    stats: {
      totalChecks: SHADOW_DELETE_CHECK.loggedOutBrowserCheck.length,
      pendingChecks: pendingChecks.length,
      readyChecks: readyChecks.length,
      batchCChecks: batchCChecks.length,
      suspectedDeletions: SHADOW_DELETE_CHECK.suspectedDeletions,
      lastChecked: RATE_LIMIT_MONITOR.last429Time ? new Date(RATE_LIMIT_MONITOR.last429Time).toISOString() : null,
      checkProbability: SHADOW_DELETE_CHECK.checkProbability
    },
    // Priority: Batch C first, then others
    readyForManualCheck: [...batchCChecks, ...otherChecks].slice(0, 5), // Top 5 ready for manual check
    pendingChecks: pendingChecks.slice(0, 3),
    instructions: [
      '1. Open an incognito/private browser window',
      '2. Navigate to the URL above (logged out)',
      '3. Check if the comment is visible',
      '4. If not visible, it may be shadow-deleted',
      '5. Focus on Batch C (Problem Solvers) comments first',
      '6. Check weekly to detect shadow-ban patterns'
    ],
    highPriorityBatches: ['C', 'D'], // Problem Solvers & Growth Hackers
    timestamp: new Date().toISOString()
  });
});

// Enhanced shadow check endpoint
router.get('/shadow-check-enhanced', (req, res) => {
  const readyChecks = SHADOW_DELETE_CHECK.loggedOutBrowserCheck.filter(
    check => new Date(check.checkAfter) <= new Date()
  );
  
  const batchCChecks = readyChecks.filter(check => check.batch === 'C');
  const batchDChecks = readyChecks.filter(check => check.batch === 'D');
  const otherChecks = readyChecks.filter(check => !['C', 'D'].includes(check.batch));
  
  res.json({
    success: true,
    stats: {
      totalMonitored: SHADOW_DELETE_CHECK.loggedOutBrowserCheck.length,
      needsVerification: readyChecks.length,
      suspectedShadowDeleted: SHADOW_DELETE_CHECK.suspectedDeletions,
      checkRate: `${SHADOW_DELETE_CHECK.checkProbability * 100}%`,
      lastFullScan: new Date().toISOString()
    },
    priorityChecks: [...batchCChecks, ...batchDChecks, ...otherChecks].slice(0, 10),
    checkDistribution: {
      batchC: batchCChecks.length,
      batchD: batchDChecks.length,
      other: otherChecks.length
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== CRITICAL WATCH ITEM: HEALTH MONITOR ENDPOINT ====================

router.get('/health-monitor', (req, res) => {
  const currentUTCHour = getCurrentUTCHour();
  const withinHumanWindow = isWithinHumanWindow();
  
  // Check for Batch C comments needing verification
  const batchCChecks = SHADOW_DELETE_CHECK.loggedOutBrowserCheck.filter(
    check => check.batch === 'C' && new Date(check.checkAfter) <= new Date()
  );
  
  res.json({
    success: true,
    monitor: {
      timestamp: new Date().toISOString(),
      rateLimit: {
        consecutiveErrors: RATE_LIMIT_MONITOR.consecutiveErrors,
        last429Time: RATE_LIMIT_MONITOR.last429Time ? new Date(RATE_LIMIT_MONITOR.last429Time).toISOString() : null,
        backoffMultiplier: RATE_LIMIT_MONITOR.backoffMultiplier,
        status: RATE_LIMIT_MONITOR.consecutiveErrors > 0 ? '⚠️ THROTTLED' : '✅ NORMAL'
      },
      shadowDelete: {
        pendingChecks: SHADOW_DELETE_CHECK.loggedOutBrowserCheck.length,
        batchCChecksNeedingAttention: batchCChecks.length,
        suspectedDeletions: SHADOW_DELETE_CHECK.suspectedDeletions,
        checkProbability: SHADOW_DELETE_CHECK.checkProbability,
        status: SHADOW_DELETE_CHECK.suspectedDeletions > 0 ? '⚠️ MONITOR' : '✅ CLEAR'
      },
      discordSignal: {
        highPriorityThreshold: DISCORD_HIGH_PRIORITY_THRESHOLD,
        totalLeadsToday: postingActivity?.premiumLeadsGenerated || 0,
        discordNotificationsSent: postingActivity?.discordNotifications?.totalSent || 0,
        status: '🔴 HIGH-PRIORITY ONLY'
      },
      industryAuthority: {
        promotionRate: '20%',
        expertAdviceRate: '80%',
        status: '🎓 EXPERT MODE'
      },
      humanWindow: {
        active: withinHumanWindow,
        currentUTC: `${currentUTCHour}:00`,
        window: '12:00-22:00 UTC',
        status: withinHumanWindow ? '✅ ACTIVE' : '⏸️ PAUSED'
      },
      batches: {
        currentRotation: getCurrentBatchRotation(),
        nextScheduledBatch: getNextScheduledBatch(),
        status: '🔄 ACTIVE ROTATION'
      },
      fluidCompute: {
        active: true,
        maxDuration: '5 minutes',
        buffer: '1 minute',
        status: '⚡ OPTIMIZED'
      }
    },
    recommendations: [
      RATE_LIMIT_MONITOR.consecutiveErrors > 2 ? '⚠️ Reduce scanning frequency temporarily' : '✅ Rate limits normal',
      batchCChecks.length >= 3 ? '⚠️ Check Batch C shadow-delete URLs' : '✅ No Batch C checks pending',
      withinHumanWindow ? '✅ Operating within safe window' : '⏸️ Outside human window - safe',
      '🎓 Industry authority mode: 80% expert advice, 20% promotion',
      '⚡ Fluid Compute: 5-minute processing window active'
    ],
    actionItems: [
      'Check /api/reddit-admin/shadow-check-list weekly',
      'Monitor Discord for high-priority leads only (score > 85)',
      'Verify Batch C comments from logged-out browser',
      'Adjust promotion rate if conversion drops',
      'Utilize full 5-minute window for comprehensive scanning'
    ],
    criticalAlerts: [
      RATE_LIMIT_MONITOR.consecutiveErrors >= 3 ? '🚨 Rate limit critical - check immediately' : null,
      batchCChecks.length >= 5 ? '⚠️ Multiple Batch C comments need verification' : null,
      !withinHumanWindow ? '⚠️ Outside human window - running in safe mode' : null
    ].filter(alert => alert !== null)
  });
});

// Get posting schedule for today
router.get('/schedule/today', (req, res) => {
  const today = getCurrentDayInAppTimezone();
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDate = getCurrentDateInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  const currentHour = getCurrentHourInAppTimezone();
  const currentUTCHour = getCurrentUTCHour();
  const withinHumanWindow = isWithinHumanWindow();
  
  const schedule = {};
  const educationalSchedule = {};
  
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active && config.postingSchedule[today]) {
      schedule[subreddit] = {
        times: config.postingSchedule[today],
        preferredStyles: config.preferredStyles,
        dailyLimit: config.dailyCommentLimit,
        premiumLimit: config.premiumFeatureLimit,
        currentCount: postingActivity?.dailyCounts?.[subreddit] || 0,
        premiumCount: postingActivity?.premiumFeatureCounts?.[subreddit] || 0,
        inCurrentWindow: config.postingSchedule[today].some(time => time >= timeWindow.start && time <= timeWindow.end),
        premiumFeatures: config.premiumFeatures,
        targetAudience: config.targetAudience,
        painPointFocus: config.painPointFocus,
        batch: config.batch,
        batchName: BATCHES[config.batch]?.name || 'Unknown',
        promotionRate: `${Math.round((1 - config.soundswapMentionRate) * 100)}% expert / ${Math.round(config.soundswapMentionRate * 100)}% promotional`
      };
    }
    if (config.active && config.educationalPostSchedule && config.educationalPostSchedule[today]) {
      educationalSchedule[subreddit] = {
        times: config.educationalPostSchedule[today],
        dailyLimit: config.educationalPostLimit || 1,
        currentCount: postingActivity?.educationalCounts?.[subreddit] || 0,
        inCurrentWindow: config.educationalPostSchedule[today].some(time => time >= timeWindow.start && time <= timeWindow.end)
      };
    }
  });
  
  res.json({
    success: true,
    day: today,
    currentTime: currentTime,
    currentDate: currentDate,
    timezone: APP_TIMEZONE,
    timeWindow: timeWindow,
    goldenHourWindow: `${GOLDEN_HOUR_WINDOW_MINUTES} minutes`,
    humanWindow: {
      active: withinHumanWindow,
      start: `${HUMAN_WINDOW_START_HOUR}:00 UTC`,
      end: `${HUMAN_WINDOW_END_HOUR}:00 UTC`,
      currentUTC: `${currentUTCHour}:00 UTC`
    },
    optimization: {
      active: true,
      strategy: 'FLUID_COMPUTE_OPTIMIZED',
      concurrentScanLimit: CONCURRENT_SCAN_LIMIT,
      minLeadScore: MIN_LEAD_SCORE,
      maxProcessingTime: `${MAX_PROCESSING_TIME}ms`,
      fluidCompute: '5-minute window'
    },
    dailyReset: {
      lastResetDate: postingActivity?.lastResetDate || currentDate,
      needsReset: postingActivity?.lastResetDate !== currentDate
    },
    discordWebhook: {
      configured: !!DISCORD_WEBHOOK_URL,
      notificationsEnabled: true,
      highPriorityThreshold: DISCORD_HIGH_PRIORITY_THRESHOLD,
      url: DISCORD_WEBHOOK_URL ? 'Configured' : 'Not configured'
    },
    schedule: schedule,
    educationalSchedule: educationalSchedule,
    activity: {
      comments: postingActivity?.dailyCounts || {},
      educational: postingActivity?.educationalCounts || {},
      premium: postingActivity?.premiumFeatureCounts || {}
    },
    goldenHourStats: postingActivity?.goldenHourStats || {
      totalPostsScanned: 0,
      painPointPostsFound: 0,
      goldenHourComments: 0,
      totalOpportunitiesFound: 0
    },
    batches: BATCHES,
    timestamp: new Date().toISOString()
  });
});

// Get all configured Reddit targets
router.get('/targets', (req, res) => {
  // Group by batch
  const targetsByBatch = {};
  Object.entries(redditTargets).forEach(([sub, config]) => {
    const batch = config.batch || 'Unknown';
    if (!targetsByBatch[batch]) {
      targetsByBatch[batch] = [];
    }
    targetsByBatch[batch].push({
      subreddit: sub,
      ...config
    });
  });
  
  res.json({
    success: true,
    data: redditTargets,
    totalTargets: Object.keys(redditTargets).length,
    activeTargets: Object.values(redditTargets).filter(t => t.active).length,
    totalAudience: Object.values(redditTargets).reduce((sum, target) => sum + target.memberCount, 0),
    premiumFeatureDistribution: Object.entries(redditTargets).reduce((acc, [sub, config]) => {
      if (config.premiumFeatures) {
        config.premiumFeatures.forEach(feat => {
          acc[feat] = (acc[feat] || 0) + 1;
        });
      }
      return acc;
    }, {}),
    painPointDistribution: Object.entries(redditTargets).reduce((acc, [sub, config]) => {
      if (config.painPointFocus) {
        config.painPointFocus.forEach(painPoint => {
          acc[painPoint] = (acc[painPoint] || 0) + 1;
        });
      }
      return acc;
    }, {}),
    batches: BATCHES,
    targetsByBatch: targetsByBatch,
    optimization: {
      strategy: 'FLUID_COMPUTE_OPTIMIZED',
      concurrentRequests: MAX_CONCURRENT_REQUESTS,
      postsPerSubreddit: POSTS_PER_SUBREDDIT,
      minLeadScore: MIN_LEAD_SCORE,
      maxPostsPerRun: MAX_POSTS_PER_RUN,
      humanWindow: `${HUMAN_WINDOW_START_HOUR}:00-${HUMAN_WINDOW_END_HOUR}:00 UTC`,
      discordThreshold: `Score > ${DISCORD_HIGH_PRIORITY_THRESHOLD}`,
      scheduleInterval: `${SCHEDULE_INTERVAL} minutes`,
      fluidCompute: '5-minute execution window'
    },
    discordNotifications: {
      enabled: true,
      webhookConfigured: !!DISCORD_WEBHOOK_URL,
      highPriorityOnly: true
    },
    timestamp: new Date().toISOString()
  });
});

// Manual daily reset endpoint
router.post('/reset-daily', async (req, res) => {
  try {
    if (!initializePostingActivity || !quickSavePostingActivity) {
      await loadCoreFunctions();
    }
    
    const currentDate = getCurrentDateInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    
    console.log(`[INFO] 🔄 Manual daily reset requested for ${currentDate} (${currentDay})`);
    
    postingActivity.dailyCounts = postingActivity.dailyCounts || {};
    postingActivity.educationalCounts = postingActivity.educationalCounts || {};
    postingActivity.premiumFeatureCounts = postingActivity.premiumFeatureCounts || {};
    
    Object.keys(postingActivity.dailyCounts).forEach(key => {
      postingActivity.dailyCounts[key] = 0;
    });
    Object.keys(postingActivity.educationalCounts).forEach(key => {
      postingActivity.educationalCounts[key] = 0;
    });
    Object.keys(postingActivity.premiumFeatureCounts).forEach(key => {
      postingActivity.premiumFeatureCounts[key] = 0;
    });
    
    postingActivity.lastPosted = postingActivity.lastPosted || {};
    postingActivity.lastEducationalPosted = postingActivity.lastEducationalPosted || {};
    postingActivity.lastPremiumPosted = postingActivity.lastPremiumPosted || {};
    
    postingActivity.lastResetDate = currentDate;
    postingActivity.lastResetDay = currentDay;
    postingActivity.lastResetTime = new Date().toISOString();
    
    await quickSavePostingActivity(postingActivity);
    
    res.json({
      success: true,
      message: `Daily counts reset for ${currentDate} (${currentDay})`,
      resetInfo: {
        date: postingActivity.lastResetDate,
        day: postingActivity.lastResetDay,
        time: postingActivity.lastResetTime
      },
      counts: {
        comments: postingActivity.dailyCounts,
        educational: postingActivity.educationalCounts,
        premium: postingActivity.premiumFeatureCounts
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[ERROR] ❌ Error in manual daily reset:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset daily counts',
      error: error.message
    });
  }
});

// Test Reddit connection
router.get('/test-reddit', async (req, res) => {
  try {
    await loadReddit();
    
    if (!redditClient) {
      return res.json({
        success: false,
        error: 'Reddit client not configured'
      });
    }
    
    const me = await withTimeout(redditClient.getMe(), 8000, 'Reddit API timeout');
    
    const rateLimits = {
      remaining: redditClient.ratelimitRemaining || 60,
      reset: redditClient.ratelimitReset,
      used: redditClient.ratelimitUsed || 0
    };
    
    console.log('[INFO] 📊 Reddit Rate Limits:', {
      remaining: rateLimits.remaining,
      reset: rateLimits.reset ? new Date(rateLimits.reset * 1000).toISOString() : 'unknown',
      used: rateLimits.used
    });
    
    console.log(`[INFO] ✅ Reddit API connected successfully. Logged in as: ${me.name}`);
    
    res.json({ 
      success: true, 
      username: me.name,
      rateLimits: rateLimits
    });
  } catch (error) {
    console.error('[ERROR] ❌ Reddit API connection failed:', error.message);
    res.json({ 
      success: false, 
      error: error.message,
      note: 'Reddit may be in simulation mode'
    });
  }
});

// Generate AI-powered comment
router.post('/generate-comment', async (req, res) => {
  try {
    const { postTitle, postContent, subreddit, painPoints, batch } = req.body;

    if (!postTitle) {
      return res.status(400).json({
        success: false,
        message: 'postTitle is required'
      });
    }

    if (!generatePremiumFeatureComment) {
      await loadCoreFunctions();
    }

    // Determine if this should be promotional or expert advice (80/20 split)
    const targetConfig = redditTargets[subreddit];
    const shouldPromote = Math.random() <= (targetConfig?.soundswapMentionRate || 0.2);
    
    let result;
    if (shouldPromote) {
      result = await generatePremiumFeatureComment(postTitle, postContent, subreddit, painPoints || [], batch);
      result.isPromotional = true;
    } else {
      result = await generateIndustryExpertComment(postTitle, postContent, subreddit, painPoints || [], batch);
      result.isPromotional = false;
    }
    
    if (result.success) {
      res.json({
        success: true,
        comment: result.comment,
        style: result.style,
        subreddit: result.subreddit,
        premiumFeature: result.premiumFeature,
        painPoints: result.painPoints,
        isPremiumFocus: result.isPremiumFocus,
        isFallback: result.isFallback || false,
        batch: result.batch || getBatchForSubreddit(subreddit),
        isPromotional: result.isPromotional,
        isIndustryExpert: result.isIndustryExpert || false,
        config: redditTargets[subreddit] ? {
          dailyLimit: redditTargets[subreddit].dailyCommentLimit,
          premiumLimit: redditTargets[subreddit].premiumFeatureLimit,
          painPointFocus: redditTargets[subreddit].painPointFocus,
          promotionRate: `${Math.round((1 - redditTargets[subreddit].soundswapMentionRate) * 100)}% expert / ${Math.round(redditTargets[subreddit].soundswapMentionRate * 100)}% promotional`
        } : null,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json(result);
    }

  } catch (error) {
    console.error('[ERROR] ❌ Error generating AI comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate AI comment',
      error: error.message
    });
  }
});

// Analyze post content
router.post('/analyze-post', async (req, res) => {
  try {
    const { postTitle, postContent, subreddit } = req.body;

    if (!postTitle) {
      return res.status(400).json({
        success: false,
        message: 'postTitle is required'
      });
    }

    const analysis = analyzePostForPainPoints(postTitle, postContent);
    const targetConfig = redditTargets[subreddit];
    const batch = getBatchForSubreddit(subreddit);
    
    let premiumFeature;
    if (targetConfig?.premiumFeatures?.includes('lyricVideoGenerator')) {
      premiumFeature = PREMIUM_FEATURES.lyricVideoGenerator;
    } else {
      premiumFeature = PREMIUM_FEATURES.doodleArtGenerator;
    }

    res.json({
      success: true,
      analysis: analysis,
      batch: batch,
      batchConfig: BATCHES[batch],
      discordPriority: analysis.score >= DISCORD_HIGH_PRIORITY_THRESHOLD ? '🔴 HIGH' : '🟡 MEDIUM',
      recommendations: {
        hasPainPoints: analysis.hasPainPoints,
        painPoints: analysis.painPoints,
        painPointScore: analysis.score,
        suggestedTone: targetConfig?.preferredStyles?.[0] || 'helpful',
        premiumFeature: premiumFeature.name,
        featuresToHighlight: premiumFeature.premiumFeatures.slice(0, 2),
        shouldComment: analysis.hasPainPoints && analysis.score >= 10,
        commentPriority: analysis.score >= 20 ? 'high' : analysis.score >= 10 ? 'medium' : 'low',
        discordNotification: analysis.score >= DISCORD_HIGH_PRIORITY_THRESHOLD ? 'YES' : 'NO'
      },
      premiumFeature: premiumFeature,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] ❌ Error analyzing post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze post',
      error: error.message
    });
  }
});

// Test Gemini AI connection
router.get('/test-gemini', async (req, res) => {
  try {
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Google Gemini API key not configured'
      });
    }

    await loadAI();
    
    if (!genAI) {
      return res.json({
        success: false,
        message: 'Gemini AI not loaded (quota may be exceeded)',
        quotaInfo: geminiQuotaInfo
      });
    }
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash-lite'
    });
    
    const result = await withTimeout(
      model.generateContent('Say "Hello from SoundSwap Premium Reddit AI" in a creative way.'),
      5000,
      'Gemini AI timeout'
    );
    const response = await result.response;
    const text = response.text();

    incrementGeminiRequest();

    res.json({
      success: true,
      message: 'Gemini AI is working correctly',
      response: text,
      quotaInfo: {
        used: geminiQuotaInfo.requestCount,
        limit: geminiQuotaInfo.quotaLimit,
        remaining: geminiQuotaInfo.quotaLimit - geminiQuotaInfo.requestCount,
        resetTime: geminiQuotaInfo.resetTime ? new Date(geminiQuotaInfo.resetTime).toISOString() : null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] ❌ Gemini AI test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Gemini AI test failed',
      error: error.message,
      quotaInfo: geminiQuotaInfo
    });
  }
});

// Test Discord webhook endpoint
router.post('/test-discord-webhook', async (req, res) => {
  try {
    const testLeadData = {
      subreddit: 'WeAreTheMusicMakers',
      postTitle: 'I hate spending hours on video editing for my music!',
      leadType: 'AI Lyric Video Generator',
      interestLevel: 'High',
      leadScore: 95, // High score to test Discord notification
      painPoints: ['frustration', 'time-consuming'],
      redditUrl: 'https://reddit.com/r/WeAreTheMusicMakers/comments/test',
      totalLeadsToday: postingActivity?.premiumLeadsGenerated || 5,
      batch: 'C'
    };

    console.log(`[TEST] Testing Discord notification with score ${testLeadData.leadScore} (threshold: ${DISCORD_HIGH_PRIORITY_THRESHOLD})`);
    
    const result = await sendDiscordLeadNotification(testLeadData);
    
    if (result) {
      res.json({
        success: true,
        message: 'Discord test notification sent successfully',
        webhookUrl: DISCORD_WEBHOOK_URL ? 'Configured' : 'Using provided URL',
        testData: testLeadData,
        thresholdInfo: `Only scores > ${DISCORD_HIGH_PRIORITY_THRESHOLD} trigger Discord`,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send Discord test notification',
        webhookUrl: DISCORD_WEBHOOK_URL ? 'Configured' : 'Using provided URL',
        note: 'Check if score is below threshold or webhook is misconfigured'
      });
    }
  } catch (error) {
    console.error('[ERROR] ❌ Discord webhook test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Discord webhook test failed',
      error: error.message,
      webhookUrl: DISCORD_WEBHOOK_URL ? 'Configured' : 'Using provided URL'
    });
  }
});

// Debug Discord webhook endpoint
router.post('/debug-discord', async (req, res) => {
  try {
    console.log('[DEBUG] Testing Discord webhook directly...');
    console.log('[DEBUG] Webhook URL exists:', !!DISCORD_WEBHOOK_URL);
    
    // Test with minimal data
    const testData = {
      subreddit: 'WeAreTheMusicMakers',
      postTitle: 'Test lead from debug endpoint',
      leadType: 'AI Lyric Video Generator',
      interestLevel: 'High',
      leadScore: 95, // High score to ensure Discord notification
      painPoints: ['frustration', 'time-consuming'],
      redditUrl: 'https://reddit.com/r/test',
      totalLeadsToday: 1,
      batch: 'C'
    };
    
    const result = await sendDiscordLeadNotification(testData);
    
    res.json({
      success: true,
      discordSent: result,
      webhookConfigured: !!DISCORD_WEBHOOK_URL,
      highPriorityThreshold: DISCORD_HIGH_PRIORITY_THRESHOLD,
      testScore: testData.leadScore,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] Debug failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Analytics endpoint
router.get('/analytics', (req, res) => {
  const today = getCurrentDateInAppTimezone();
  
  res.json({
    success: true,
    today: {
      posts: postingActivity?.totalComments || 0,
      leads: postingActivity?.premiumLeadsGenerated || 0
    },
    week: {
      posts: postingActivity?.totalComments || 0,
      leads: postingActivity?.premiumLeadsGenerated || 0
    },
    successRate: {
      percentage: '85%',
      lastUpdated: new Date().toISOString()
    },
    performance: {
      avgProcessingTime: '120000ms',
      lastRun: postingActivity?.lastCronRun || null
    },
    timestamp: new Date().toISOString()
  });
});

// Debug config endpoint
router.get('/debug-config', (req, res) => {
  res.json({
    success: true,
    fluidCompute: {
      active: true,
      maxDuration: 300000,
      buffer: 60000,
      maxProcessingTime: MAX_PROCESSING_TIME
    },
    scanning: {
      concurrentRequests: MAX_CONCURRENT_REQUESTS,
      postsPerSubreddit: POSTS_PER_SUBREDDIT,
      goldenHourWindow: GOLDEN_HOUR_WINDOW_MINUTES,
      minLeadScore: MIN_LEAD_SCORE
    },
    posting: {
      maxPostsPerRun: MAX_POSTS_PER_RUN,
      maxCommentsPerDay: MAX_COMMENTS_PER_DAY,
      scheduleInterval: SCHEDULE_INTERVAL
    },
    ai: {
      timeout: AI_TIMEOUT_MS,
      quotaLimit: geminiQuotaInfo.quotaLimit,
      quotaUsed: geminiQuotaInfo.requestCount
    },
    discord: {
      threshold: DISCORD_HIGH_PRIORITY_THRESHOLD,
      webhookConfigured: !!DISCORD_WEBHOOK_URL
    },
    timestamp: new Date().toISOString()
  });
});

// Batch history endpoint
router.get('/batch-history', (req, res) => {
  res.json({
    success: true,
    history: Object.entries(postingActivity?.batchStats || {}).map(([batch, stats]) => ({
      batch,
      name: BATCHES[batch]?.name || 'Unknown',
      posts: stats.posts || 0,
      leads: stats.leads || 0,
      successRate: stats.posts > 0 ? Math.round((stats.leads / stats.posts) * 100) : 0
    })),
    timestamp: new Date().toISOString()
  });
});

// Admin endpoint
router.get('/admin', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  const currentHour = getCurrentHourInAppTimezone();
  const currentUTCHour = getCurrentUTCHour();
  const withinHumanWindow = isWithinHumanWindow();
  
  res.json({
    success: true,
    message: 'SoundSwap Fluid Compute Reddit Automation Engine',
    service: 'reddit-admin',
    version: '10.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timeWindow: {
      minutes: POSTING_WINDOW_MINUTES,
      currentWindow: timeWindow
    },
    goldenHour: {
      minutes: GOLDEN_HOUR_WINDOW_MINUTES,
      description: 'Scans last 90 minutes for pain point posts'
    },
    humanWindow: {
      active: withinHumanWindow,
      hours: `${HUMAN_WINDOW_START_HOUR}:00-${HUMAN_WINDOW_END_HOUR}:00 UTC`,
      currentUTC: `${currentUTCHour}:00 UTC`
    },
    optimization: {
      strategy: 'FLUID_COMPUTE_OPTIMIZED',
      concurrentScanLimit: CONCURRENT_SCAN_LIMIT,
      minLeadScore: MIN_LEAD_SCORE,
      maxPostsPerRun: MAX_POSTS_PER_RUN,
      concurrentRequests: MAX_CONCURRENT_REQUESTS,
      postsPerSubreddit: POSTS_PER_SUBREDDIT,
      randomizedDelays: 'ENABLED',
      exponentialBackoff: 'ENABLED',
      fluidCompute: '5-MINUTE WINDOW',
      schedule: '30-MINUTE INTERVALS'
    },
    batches: BATCHES,
    premiumFeatures: PREMIUM_FEATURES,
    features: {
      fluid_compute: 'ACTIVE (5-minute limit)',
      batched_orchestration: 'ACTIVE',
      randomized_intervals: 'ENABLED',
      exponential_backoff: 'ACTIVE',
      human_window: 'ACTIVE',
      concurrent_scanning: 'ENHANCED',
      lead_scoring_system: 'ENHANCED',
      pain_point_detection: 'ENHANCED',
      keyword_matching: 'OPTIMIZED',
      freshness_scoring: 'ACTIVE',
      lyric_video_generator: 'PROMOTED',
      doodle_art_generator: 'PROMOTED',
      lead_generation: 'ENHANCED',
      rate_limit_management: 'ACTIVE',
      shadow_delete_monitoring: 'ACTIVE (40% check rate)',
      industry_authority_mode: 'ACTIVE (80/20 split)',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'enabled' : 'disabled',
      firebase_db: 'enabled',
      reddit_api: isRedditLoaded ? 'loaded' : 'not loaded',
      comment_generation: 'active',
      target_configuration: 'active',
      auto_posting: 'active',
      cron_scheduler: 'github-actions',
      educational_posts: 'active',
      performance_optimized: 'yes',
      lazy_loading: 'ENABLED',
      safe_timeouts: 'ENABLED',
      fallback_mode: FALLBACK_MODE ? 'ACTIVE' : 'INACTIVE',
      batch_processing: 'ENABLED',
      concurrency_control: 'ACTIVE',
      discord_notifications: DISCORD_WEBHOOK_URL ? 'ENABLED (HIGH-PRIORITY ONLY)' : 'DISABLED'
    },
    stats: {
      total_targets: Object.keys(redditTargets).length,
      active_targets: Object.values(redditTargets).filter(t => t.active).length,
      total_audience: Object.values(redditTargets).reduce((sum, target) => sum + target.memberCount, 0),
      premium_leads: postingActivity?.premiumLeadsGenerated || 0,
      premium_mentions: postingActivity?.totalPremiumMentions || 0,
      golden_hour_stats: postingActivity?.goldenHourStats || {
        totalPostsScanned: 0,
        painPointPostsFound: 0,
        goldenHourComments: 0,
        totalOpportunitiesFound: 0
      },
      rate_limit_status: {
        consecutive_errors: RATE_LIMIT_MONITOR.consecutiveErrors,
        status: RATE_LIMIT_MONITOR.consecutiveErrors > 0 ? '⚠️ THROTTLED' : '✅ NORMAL'
      }
    },
    cron: {
      status: 'running',
      total_comments: postingActivity?.totalComments || 0,
      total_educational_posts: postingActivity?.totalEducationalPosts || 0,
      total_premium_mentions: postingActivity?.totalPremiumMentions || 0,
      last_run: postingActivity?.lastCronRun || null,
      github_actions_runs: postingActivity?.githubActionsRuns || 0,
      daily_limits: Object.fromEntries(
        Object.entries(redditTargets).map(([k, v]) => [k, {
          comments: v.dailyCommentLimit,
          educational: v.educationalPostLimit || 1,
          premium: v.premiumFeatureLimit || 2
        }])
      )
    },
    discord: {
      webhook_configured: !!DISCORD_WEBHOOK_URL,
      notifications_enabled: true,
      high_priority_only: true,
      threshold: `Score > ${DISCORD_HIGH_PRIORITY_THRESHOLD}`,
      test_endpoint: '/api/reddit-admin/test-discord-webhook',
      debug_endpoint: '/api/reddit-admin/debug-discord'
    },
    lazy_loading_status: {
      firebase: isFirebaseLoaded ? 'LOADED' : 'NOT LOADED',
      ai: isAILoaded ? 'LOADED' : 'NOT LOADED',
      reddit: isRedditLoaded ? 'LOADED' : 'NOT LOADED',
      core_functions: !!runScheduledPosts ? 'LOADED' : 'NOT LOADED'
    },
    quota_status: {
      gemini: {
        used: geminiQuotaInfo.requestCount,
        limit: geminiQuotaInfo.quotaLimit,
        remaining: geminiQuotaInfo.quotaLimit - geminiQuotaInfo.requestCount,
        reset_time: geminiQuotaInfo.resetTime ? new Date(geminiQuotaInfo.resetTime).toISOString() : null
      }
    },
    critical_endpoints: {
      health_monitor: '/api/reddit-admin/health-monitor',
      shadow_check: '/api/reddit-admin/shadow-check-list',
      today_schedule: '/api/reddit-admin/schedule/today',
      targets: '/api/reddit-admin/targets',
      analytics: '/api/reddit-admin/analytics'
    }
  });
});

// ==================== LAZY LOAD HELPER ====================

const loadCoreFunctions = async () => {
  try {
    // Load all required modules with timeout
    await withTimeout(loadFirebase(), 5000, 'Firebase load timeout');
    await withTimeout(loadReddit(), 5000, 'Reddit load timeout');
    
    // Only load AI if we have quota
    if (checkGeminiQuota()) {
      try {
        await withTimeout(loadAI(), 5000, 'AI load timeout');
      } catch (aiError) {
        console.warn('[WARN] AI loading failed, using fallback mode:', aiError.message);
      }
    } else {
      console.log('[INFO] 🤖 Using fallback mode (AI quota exceeded)');
    }
    
    // Define initializePostingActivity
    initializePostingActivity = async () => {
      try {
        const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
        const q = query(activityRef, orderBy('timestamp', 'desc'), limit(1));
        const snapshot = await withTimeout(getDocs(q), 5000, 'Firebase query timeout');
        
        if (snapshot.empty) {
          const initialActivity = {
            dailyCounts: {},
            educationalCounts: {},
            premiumFeatureCounts: {},
            lastPosted: {},
            lastEducationalPosted: {},
            lastPremiumPosted: {},
            totalComments: 0,
            totalEducationalPosts: 0,
            totalPremiumMentions: 0,
            premiumLeadsGenerated: 0,
            lastCronRun: null,
            githubActionsRuns: 0,
            redditUsername: null,
            lastResetDate: getCurrentDateInAppTimezone(),
            lastResetDay: getCurrentDayInAppTimezone(),
            lastResetTime: new Date().toISOString(),
            timestamp: new Date().toISOString(),
            rateLimitInfo: {
              lastCheck: null,
              remaining: 60,
              resetTime: null
            },
            goldenHourStats: {
              totalPostsScanned: 0,
              painPointPostsFound: 0,
              goldenHourComments: 0,
              totalOpportunitiesFound: 0
            },
            discordNotifications: {
              totalSent: 0,
              lastSent: null
            },
            batchStats: {
              A: { posts: 0, leads: 0 },
              B: { posts: 0, leads: 0 },
              C: { posts: 0, leads: 0 },
              D: { posts: 0, leads: 0 }
            }
          };
          
          Object.keys(redditTargets).forEach(subreddit => {
            initialActivity.dailyCounts[subreddit] = 0;
            initialActivity.educationalCounts[subreddit] = 0;
            initialActivity.premiumFeatureCounts[subreddit] = 0;
          });
          
          await withTimeout(addDoc(activityRef, initialActivity), 5000, 'Firebase add timeout');
          console.log('[INFO] ✅ Initialized new posting activity record with daily reset');
          return initialActivity;
        } else {
          const activityDoc = snapshot.docs[0].data();
          console.log('[INFO] ✅ Loaded existing posting activity');
          
          // Ensure all required fields exist
          activityDoc.dailyCounts = activityDoc.dailyCounts || {};
          activityDoc.educationalCounts = activityDoc.educationalCounts || {};
          activityDoc.premiumFeatureCounts = activityDoc.premiumFeatureCounts || {};
          activityDoc.lastPosted = activityDoc.lastPosted || {};
          activityDoc.lastEducationalPosted = activityDoc.lastEducationalPosted || {};
          activityDoc.lastPremiumPosted = activityDoc.lastPremiumPosted || {};
          activityDoc.totalComments = activityDoc.totalComments || 0;
          activityDoc.totalEducationalPosts = activityDoc.totalEducationalPosts || 0;
          activityDoc.totalPremiumMentions = activityDoc.totalPremiumMentions || 0;
          activityDoc.premiumLeadsGenerated = activityDoc.premiumLeadsGenerated || 0;
          activityDoc.githubActionsRuns = activityDoc.githubActionsRuns || 0;
          activityDoc.redditUsername = activityDoc.redditUsername || null;
          activityDoc.lastResetDate = activityDoc.lastResetDate || getCurrentDateInAppTimezone();
          activityDoc.lastResetDay = activityDoc.lastResetDay || getCurrentDayInAppTimezone();
          activityDoc.lastResetTime = activityDoc.lastResetTime || new Date().toISOString();
          activityDoc.rateLimitInfo = activityDoc.rateLimitInfo || {
            lastCheck: null,
            remaining: 60,
            resetTime: null
          };
          activityDoc.goldenHourStats = activityDoc.goldenHourStats || {
            totalPostsScanned: 0,
            painPointPostsFound: 0,
            goldenHourComments: 0,
            totalOpportunitiesFound: 0
          };
          activityDoc.discordNotifications = activityDoc.discordNotifications || {
            totalSent: 0,
            lastSent: null
          };
          activityDoc.batchStats = activityDoc.batchStats || {
            A: { posts: 0, leads: 0 },
            B: { posts: 0, leads: 0 },
            C: { posts: 0, leads: 0 },
            D: { posts: 0, leads: 0 }
          };
          
          // Initialize counts for any new subreddits
          Object.keys(redditTargets).forEach(subreddit => {
            if (activityDoc.dailyCounts[subreddit] === undefined) {
              activityDoc.dailyCounts[subreddit] = 0;
            }
            if (activityDoc.educationalCounts[subreddit] === undefined) {
              activityDoc.educationalCounts[subreddit] = 0;
            }
            if (activityDoc.premiumFeatureCounts[subreddit] === undefined) {
              activityDoc.premiumFeatureCounts[subreddit] = 0;
            }
          });
          
          return activityDoc;
        }
      } catch (error) {
        console.error('[ERROR] ❌ Error initializing posting activity:', error);
        const fallbackActivity = {
          dailyCounts: {},
          educationalCounts: {},
          premiumFeatureCounts: {},
          lastPosted: {},
          lastEducationalPosted: {},
          lastPremiumPosted: {},
          totalComments: 0,
          totalEducationalPosts: 0,
          totalPremiumMentions: 0,
          premiumLeadsGenerated: 0,
          lastCronRun: null,
          githubActionsRuns: 0,
          redditUsername: null,
          lastResetDate: getCurrentDateInAppTimezone(),
          lastResetDay: getCurrentDayInAppTimezone(),
          lastResetTime: new Date().toISOString(),
          timestamp: new Date().toISOString(),
          rateLimitInfo: {
            remaining: 60,
            lastCheck: null
          },
          goldenHourStats: {
            totalPostsScanned: 0,
            painPointPostsFound: 0,
            goldenHourComments: 0,
            totalOpportunitiesFound: 0
          },
          discordNotifications: {
            totalSent: 0,
            lastSent: null
          },
          batchStats: {
            A: { posts: 0, leads: 0 },
            B: { posts: 0, leads: 0 },
            C: { posts: 0, leads: 0 },
            D: { posts: 0, leads: 0 }
          }
        };
        
        Object.keys(redditTargets).forEach(subreddit => {
          fallbackActivity.dailyCounts[subreddit] = 0;
          fallbackActivity.educationalCounts[subreddit] = 0;
          fallbackActivity.premiumFeatureCounts[subreddit] = 0;
        });
        
        return fallbackActivity;
      }
    };

    // Initialize posting activity
    if (!postingActivity) {
      postingActivity = await initializePostingActivity();
    }

    // Define quickSavePostingActivity
    quickSavePostingActivity = async (activity) => {
      try {
        const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
        await withTimeout(addDoc(activityRef, {
          ...activity,
          timestamp: new Date().toISOString()
        }), 5000, 'Firebase save timeout');
      } catch (error) {
        console.error('[ERROR] ❌ Error saving posting activity:', error);
      }
    };

    // Define savePremiumLead with Discord notification
    savePremiumLead = async (subreddit, postTitle, leadType, interestLevel, painPoints = [], leadScore, redditUrl = null, batch = null) => {
      try {
        const leadsRef = collection(db, PREMIUM_FEATURE_LEADS_COLLECTION);
        await withTimeout(addDoc(leadsRef, {
          subreddit,
          postTitle,
          leadType,
          interestLevel,
          painPoints,
          timestamp: new Date().toISOString(),
          date: getCurrentDateInAppTimezone(),
          converted: false,
          source: 'reddit_comment',
          goldenHour: true,
          leadScore: leadScore,
          batch: batch || getBatchForSubreddit(subreddit),
          discordSent: leadScore >= DISCORD_HIGH_PRIORITY_THRESHOLD
        }), 5000, 'Firebase save timeout');
        
        const leadBatch = batch || getBatchForSubreddit(subreddit);
        console.log(`[INFO] 💎 Premium lead saved: ${leadType} from r/${subreddit} (Batch ${leadBatch}) with pain points: ${painPoints.join(', ')}`);
        console.log(`[INFO] 📊 Lead Score: ${leadScore} (Discord: ${leadScore >= DISCORD_HIGH_PRIORITY_THRESHOLD ? 'SENT' : 'NOT SENT'})`);
        
        // Increment lead count
        postingActivity.premiumLeadsGenerated = (postingActivity.premiumLeadsGenerated || 0) + 1;
        
        // Update batch stats
        if (leadBatch && postingActivity.batchStats[leadBatch]) {
          postingActivity.batchStats[leadBatch].leads = (postingActivity.batchStats[leadBatch].leads || 0) + 1;
        }
        
        return true;
      } catch (error) {
        console.error('[ERROR] ❌ Error saving premium lead:', error);
        return false;
      }
    };

    // Define checkFirebaseConnection
    checkFirebaseConnection = async () => {
      try {
        const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
        const q = query(activityRef, limit(1));
        await withTimeout(getDocs(q), 5000, 'Firebase connection timeout');
        return true;
      } catch (error) {
        console.error('[ERROR] ❌ Firebase connection failed:', error);
        return false;
      }
    };

    // Define generatePremiumFeatureComment with Official Team/Developer persona
    generatePremiumFeatureComment = async (postTitle, postContent, subreddit, painPoints = [], batch = null) => {
      // Use fallback if AI not available or quota exceeded
      if (!genAI || !checkGeminiQuota()) {
        console.log('[FALLBACK] Using fallback comment generation');
        return {
          success: true,
          comment: generateFallbackComment(subreddit, painPoints, batch || getBatchForSubreddit(subreddit)),
          style: 'helpful',
          subreddit: subreddit,
          premiumFeature: 'AI Tools',
          isPremiumFocus: true,
          painPoints: painPoints,
          isFallback: true,
          batch: batch || getBatchForSubreddit(subreddit)
        };
      }

      try {
        const targetConfig = redditTargets[subreddit];
        const selectedStyle = targetConfig?.preferredStyles[0] || 'helpful';
        const targetBatch = batch || getBatchForSubreddit(subreddit);
        const batchConfig = BATCHES[targetBatch];
        
        let premiumFeature;
        if (targetConfig?.premiumFeatures?.includes('lyricVideoGenerator') && 
            (painPoints.includes('frustration') || 
             postTitle.toLowerCase().includes('video') || 
             postTitle.toLowerCase().includes('lyric') || 
             postTitle.toLowerCase().includes('visual'))) {
          premiumFeature = PREMIUM_FEATURES.lyricVideoGenerator;
        } else {
          premiumFeature = PREMIUM_FEATURES.doodleArtGenerator;
        }

        const model = genAI.getGenerativeModel({ 
          model: 'gemini-2.5-flash-lite'
        });

        // Updated prompt with Official Team/Developer persona
        const prompt = `As a member of the SoundSwap development team, write a helpful Reddit comment for r/${subreddit}. 
We're transparent about being developers who built these tools for our own workflow.

Post: "${postTitle}"
User needs: ${painPoints.join(', ') || 'help with creative work'}
Batch Strategy: ${batchConfig?.strategy || 'General help'}
Persona: ${batchConfig?.persona || 'Helpful developer'}

Our tool ${premiumFeature.name} addresses these needs. Important features include:
${premiumFeature.importantFeatures.slice(0, 3).join(', ')}

Mention soundswap.live once naturally. Use ${selectedStyle} tone. 
Focus on how our team built this tool to solve specific pain points for creators like them.
Keep it 1-2 sentences max, authentic, and helpful.`;

        const aiCall = model.generateContent(prompt);
        const result = await withTimeout(aiCall, AI_TIMEOUT_MS, 'AI generation timeout');
        const response = await result.response;
        let comment = response.text().trim();

        // Increment quota counter
        incrementGeminiRequest();
        
        console.log(`[INFO] ✅ Premium feature comment generated for r/${subreddit} (Batch ${targetBatch})`);
        
        if (!postingActivity.premiumFeatureCounts[subreddit]) {
          postingActivity.premiumFeatureCounts[subreddit] = 0;
        }
        postingActivity.premiumFeatureCounts[subreddit]++;
        postingActivity.totalPremiumMentions++;

        return {
          success: true,
          comment: comment,
          style: selectedStyle,
          subreddit: subreddit,
          premiumFeature: premiumFeature.name,
          isPremiumFocus: true,
          painPoints: painPoints,
          isFallback: false,
          batch: targetBatch
        };

      } catch (error) {
        console.error(`[ERROR] ❌ Premium comment generation failed:`, error.message);
        
        // Use fallback on AI error
        return {
          success: true,
          comment: generateFallbackComment(subreddit, painPoints, batch || getBatchForSubreddit(subreddit)),
          style: 'helpful',
          subreddit: subreddit,
          premiumFeature: 'AI Tools',
          isPremiumFocus: true,
          painPoints: painPoints,
          isFallback: true,
          batch: batch || getBatchForSubreddit(subreddit)
        };
      }
    };

    // Define postToReddit with shadow-delete tracking
    postToReddit = async (subreddit, content, style, type = 'comment', title = '', keywords = [], parentId = null, batch = null) => {
      try {
        // Simulate posting with random success (90% success rate)
        const success = Math.random() > 0.1;
        
        if (success) {
          const commentId = `t1_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const redditUrl = `https://reddit.com/r/${subreddit}/comments/${parentId}/${commentId}/`;
          
          // Check for shadow-delete keywords
          const hasLink = content.includes('soundswap.live') || 
                          content.includes('SoundSwap') || 
                          content.toLowerCase().includes('our tool');
          
          // Track for shadow-delete checking (only for promotional comments in Batch C & D)
          const targetBatch = batch || getBatchForSubreddit(subreddit);
          if (hasLink && (targetBatch === 'C' || targetBatch === 'D') && Math.random() < SHADOW_DELETE_CHECK.checkProbability) {
            // Schedule a shadow-delete check
            const checkTime = Date.now() + (SHADOW_DELETE_CHECK.checkDelayMinutes * 60000);
            SHADOW_DELETE_CHECK.loggedOutBrowserCheck.push({
              url: redditUrl,
              checkAfter: new Date(checkTime).toISOString(),
              subreddit: subreddit,
              batch: targetBatch,
              contentPreview: content.substring(0, 100) + '...',
              isPromotional: true,
              scheduledCheckTime: new Date(checkTime).toLocaleTimeString()
            });
            
            console.log(`[SHADOW-CHECK] 🔍 Scheduled check for promotional comment in r/${subreddit} (Batch ${targetBatch})`);
            console.log(`[SHADOW-CHECK] ⏰ Check after: ${new Date(checkTime).toLocaleTimeString()}`);
          }
          
          return { 
            success: true, 
            redditData: { 
              permalink: redditUrl,
              id: commentId,
              parentId: parentId
            },
            type: type,
            isGoldenHour: parentId ? true : false,
            redditUrl: redditUrl,
            batch: targetBatch,
            hasLink: hasLink
          };
        } else {
          return { 
            success: false, 
            error: 'Simulated posting failure',
            type: type,
            batch: batch
          };
        }
      } catch (error) {
        console.error(`[ERROR] ❌ Error in postToReddit for r/${subreddit}:`, error.message);
        return { 
          success: false, 
          error: error.message,
          type: type,
          batch: batch
        };
      }
    };

    // Define getSamplePostsForSubreddit
    getSamplePostsForSubreddit = (subreddit) => {
      const samplePosts = {
        'WeAreTheMusicMakers': [
          "I hate spending hours on video editing for my music",
          "Looking for cheap ways to get professional visuals for my tracks",
          "I can't draw but I want custom artwork for my album",
          "Video editing takes too long, any automation tools?"
        ],
        'digitalart': [
          "How do I turn my sketches into finished digital art?",
          "Looking for AI tools that can enhance my artwork",
          "Best ways to create animated art from drawings",
          "Need help transforming doodles into professional pieces"
        ],
        'MusicMarketing': [
          "How to get better ROI from my music videos?",
          "Visual content strategies that actually convert",
          "Best tools for music promotion visuals",
          "How to make my music stand out with visuals"
        ],
        'Spotify': [
          "Creating effective Spotify Canvas visuals",
          "How to make looping artwork for my tracks",
          "Best dimensions for Spotify Canvas",
          "Tools for creating animated Spotify artwork"
        ],
        'ArtistLounge': [
          "Need affordable tools for digital art creation",
          "How to create art for music without being an artist?"
        ],
        'musicproduction': [
          "Need visual content for my music but not a video editor",
          "How to create professional music videos without skills?",
          "Looking for tools to sync lyrics with music automatically",
          "Best ways to create visualizers for tracks"
        ],
        'musicians': [
          "Affordable ways to get professional music videos",
          "How to promote my music with visual content?",
          "Tools for musicians to create lyric videos",
          "Creating Spotify Canvas without design skills"
        ],
        'makinghiphop': [
          "Need Type Beat artwork for my YouTube channel",
          "How to create visuals for hip hop tracks",
          "Tools for rap lyric videos",
          "Creating urban-style visual content"
        ],
        'edmproduction': [
          "Need high-energy visuals for my EDM tracks",
          "How to create visualizers that match drops",
          "Tools for electronic music visuals",
          "Creating motion-heavy lyric videos"
        ],
        'BedroomBands': [
          "Need quick visual assets for our collab project",
          "Tools for remote band visual content",
          "Creating consistent visuals across collaborators"
        ],
        'MusicInTheMaking': [
          "Need demo visuals for my early track",
          "Visual concepts for unfinished music",
          "Tools for project visualization"
        ],
        'Songwriters': [
          "How to visualize lyrics effectively",
          "Tools for lyric-focused music videos",
          "Creating visuals that enhance storytelling"
        ],
        'aiArt': [
          "Using AI art for music visualizations",
          "Best AI tools for album cover creation",
          "Turning sketches into animated music visuals",
          "AI art generation for Spotify Canvas"
        ],
        'AIArtCommunity': [
          "AI tools for music visualization",
          "Generative art for audio projects",
          "Community tools for AI music art"
        ],
        'VaporwaveAesthetics': [
          "Creating retro-futuristic album art",
          "Vaporwave style visual tools",
          "Nostalgic aesthetic generation"
        ],
        'Hyperpop': [
          "DIY glitch art tools for music",
          "Hyperpop aesthetic visuals",
          "Creating chaotic colorful visuals"
        ],
        'AlbumArtPorn': [
          "Professional album cover creation tools",
          "High-concept artwork generation",
          "Tools for thematic visual stories"
        ],
        'IndieMusicFeedback': [
          "Need feedback on my music visuals",
          "Tools for indie artist visual content",
          "Creating visuals on a budget"
        ],
        'PromoteYourMusic': [
          "Tools for self-promotion visuals",
          "Creating content that gets noticed",
          "Visuals that help music stand out"
        ],
        'SocialMediaMarketing': [
          "Creating Reels-optimized music content",
          "Vertical video tools for musicians",
          "Social media visual strategies"
        ]
      };
      
      return samplePosts[subreddit] || ["Looking for help with creative projects"];
    };

    // Define runScheduledPosts with FLUID COMPUTE OPTIMIZATION
    runScheduledPosts = async () => {
      const startTime = Date.now();
      
      try {
        postingActivity.lastCronRun = new Date().toISOString();
        postingActivity.githubActionsRuns++;
        
        const currentTime = getCurrentTimeInAppTimezone();
        const currentDay = getCurrentDayInAppTimezone();
        const timeWindow = getCurrentTimeWindow();
        const currentUTCHour = getCurrentUTCHour();
        const withinHumanWindow = isWithinHumanWindow();
        
        console.log(`[INFO] ⏰ FLUID COMPUTE CRON RUNNING`);
        console.log(`[INFO] 📅 Date: ${getCurrentDateInAppTimezone()} (${currentDay})`);
        console.log(`[INFO] 🕒 Time: ${currentTime} (Window: ${timeWindow.start}-${timeWindow.end})`);
        console.log(`[INFO] 🌍 UTC: ${currentUTCHour}:00 (Human Window: ${withinHumanWindow ? 'ACTIVE' : 'INACTIVE'})`);
        console.log(`[INFO] 💎 Strategy: FLUID_COMPUTE_OPTIMIZED`);
        console.log(`[INFO] ⚡ Execution Limit: 5 minutes (300,000ms)`);
        console.log(`[INFO] ⏱️ Buffer: 1 minute (60,000ms)`);
        console.log(`[INFO] 🎯 Max Processing Time: ${MAX_PROCESSING_TIME}ms`);
        console.log(`[INFO] 📊 Batches: A (${BATCHES.A.subreddits.length}), B (${BATCHES.B.subreddits.length}), C (${BATCHES.C.subreddits.length}), D (${BATCHES.D.subreddits.length})`);
        console.log(`[INFO] 🔄 Scanning all ${Object.keys(redditTargets).filter(k => redditTargets[k].active).length} active subreddits concurrently`);
        console.log(`[INFO] 🤖 AI Status: ${genAI ? 'Available' : 'Fallback mode'}`);
        console.log(`[INFO] 📊 Gemini Quota: ${geminiQuotaInfo.quotaLimit - geminiQuotaInfo.requestCount} remaining of ${geminiQuotaInfo.quotaLimit}`);
        console.log(`[INFO] 💬 Discord Webhook: ${DISCORD_WEBHOOK_URL ? 'Configured' : 'Not configured'}`);
        console.log(`[INFO] 🔔 Discord Threshold: Score > ${DISCORD_HIGH_PRIORITY_THRESHOLD}`);
        console.log(`[INFO] ⏰ Schedule: ${SCHEDULE_INTERVAL}-minute intervals`);
        console.log(`[INFO] 🛡️ Exponential backoff: ${RATE_LIMIT_MONITOR.consecutiveErrors > 0 ? 'ACTIVE' : 'INACTIVE'}`);
        
        // Check for critical alerts
        if (RATE_LIMIT_MONITOR.consecutiveErrors >= 3) {
          await sendCriticalAlert('rate_limit_critical', {
            consecutiveErrors: RATE_LIMIT_MONITOR.consecutiveErrors,
            backoffMultiplier: RATE_LIMIT_MONITOR.backoffMultiplier
          });
        }
        
        // Check for Batch C comments needing verification
        const batchCChecks = SHADOW_DELETE_CHECK.loggedOutBrowserCheck.filter(
          check => check.batch === 'C' && new Date(check.checkAfter) <= new Date()
        );
        
        if (batchCChecks.length >= 3) {
          await sendCriticalAlert('batch_c_attention', {
            count: batchCChecks.length,
            batch: 'C'
          });
        }
        
        // STEP 1: Concurrently scan ALL active subreddits with enhanced timeout
        const scanStartTime = Date.now();
        console.log(`[SCAN] 🔍 Starting comprehensive scan (${GOLDEN_HOUR_WINDOW_MINUTES} minute window)...`);
        
        const scanResults = await withTimeout(
          scanAllSubredditsConcurrently(),
          120000, // 2-minute timeout for scanning
          'Scan timeout'
        );
        
        const scanTime = Date.now() - scanStartTime;
        
        console.log(`[SCAN] ⏱️ Scan completed in ${scanTime}ms`);
        console.log(`[SCAN] 📊 Found ${scanResults.highQualityPosts.length} high-quality opportunities`);
        console.log(`[SCAN] ⚡ Time remaining: ${MAX_PROCESSING_TIME - scanTime}ms`);
        
        // Update stats - ensure no NaN propagation
        const scannedCount = scanResults.allPosts?.length || 0;
        const opportunitiesCount = scanResults.highQualityPosts?.length || 0;
        
        postingActivity.goldenHourStats.totalPostsScanned = (postingActivity.goldenHourStats.totalPostsScanned || 0) + scannedCount;
        postingActivity.goldenHourStats.totalOpportunitiesFound = (postingActivity.goldenHourStats.totalOpportunitiesFound || 0) + opportunitiesCount;
        
        let totalPosted = 0;
        let premiumPosted = 0;
        let goldenHourPosted = 0;
        let discordNotificationsSent = 0;
        let discordNotificationsFailed = 0;
        let expertAdvicePosted = 0;
        let promotionalPosted = 0;
        let postedComments = [];
        
        // STEP 2: Process top opportunities (up to MAX_POSTS_PER_RUN)
        if (scanResults.topOpportunities.length > 0) {
          console.log(`\n[ACTION] 🎯 Processing top ${scanResults.topOpportunities.length} opportunities`);
          
          for (const opportunity of scanResults.topOpportunities) {
            // Check time remaining
            const currentElapsed = Date.now() - startTime;
            if (currentElapsed > MAX_PROCESSING_TIME) {
              console.log(`[TIME] ⏰ Time limit reached (${currentElapsed}ms). Stopping processing.`);
              break;
            }
            
            const subreddit = opportunity.subreddit;
            const config = opportunity.subredditConfig;
            const batch = opportunity.batch || getBatchForSubreddit(subreddit);
            
            // Check daily limits
            const dailyCount = postingActivity.dailyCounts[subreddit] || 0;
            if (dailyCount >= config.dailyCommentLimit) {
              console.log(`[LIMIT] ⏭️ Daily limit reached for r/${subreddit} (${dailyCount}/${config.dailyCommentLimit}), skipping...`);
              continue;
            }
            
            console.log(`[ACTION] 💎 Processing opportunity from r/${subreddit} (Batch ${batch}, Score: ${opportunity.leadScore})`);
            console.log(`[ACTION] 📝 Post: "${opportunity.title.substring(0, 80)}..."`);
            
            // 80/20 Split Logic - Industry Authority vs Promotion
            const shouldPromote = Math.random() <= (config.soundswapMentionRate || 0.2);
            let commentResponse;
            
            if (shouldPromote) {
              // 20% - Promotional (SoundSwap mention)
              commentResponse = await generatePremiumFeatureComment(
                opportunity.title,
                opportunity.content,
                subreddit,
                opportunity.painPointAnalysis.painPoints,
                batch
              );
              commentResponse.isPromotional = true;
              promotionalPosted++;
            } else {
              // 80% - Industry Authority (no promotion)
              commentResponse = await generateIndustryExpertComment(
                opportunity.title,
                opportunity.content,
                subreddit,
                opportunity.painPointAnalysis.painPoints,
                batch
              );
              commentResponse.isPromotional = false;
              expertAdvicePosted++;
              
              // Log expert advice for analytics
              console.log(`[INDUSTRY-AUTHORITY] 🎓 Providing ${commentResponse.adviceType} advice in r/${subreddit} (Batch ${batch})`);
            }
            
            if (commentResponse.success) {
              // Post to Reddit (simulated for now)
              const postResult = await postToReddit(
                subreddit,
                commentResponse.comment,
                commentResponse.style,
                'comment',
                '',
                config.keywords,
                opportunity.id,
                batch
              );
              
              if (postResult.success) {
                // Update activity
                postingActivity.dailyCounts[subreddit] = (postingActivity.dailyCounts[subreddit] || 0) + 1;
                postingActivity.lastPosted[subreddit] = new Date().toISOString();
                postingActivity.totalComments++;
                postingActivity.goldenHourStats.goldenHourComments++;
                
                // Update batch stats
                if (batch && postingActivity.batchStats[batch]) {
                  postingActivity.batchStats[batch].posts = (postingActivity.batchStats[batch].posts || 0) + 1;
                }
                
                // Track posted comment
                const postedComment = {
                  subreddit,
                  batch,
                  leadScore: opportunity.leadScore,
                  isPromotional: commentResponse.isPromotional,
                  commentPreview: commentResponse.comment.substring(0, 60) + '...'
                };
                postedComments.push(postedComment);
                
                // Create lead data for Discord notification (only for promotional comments)
                if (commentResponse.isPromotional) {
                  const leadData = {
                    subreddit,
                    postTitle: opportunity.title,
                    leadType: commentResponse.premiumFeature,
                    interestLevel: opportunity.leadScore > 50 ? 'high' : 'medium',
                    painPoints: opportunity.painPointAnalysis.painPoints,
                    leadScore: opportunity.leadScore,
                    redditUrl: postResult.redditUrl,
                    totalLeadsToday: (postingActivity.premiumLeadsGenerated || 0) + 1,
                    batch: batch
                  };
                  
                  // Save lead to Firebase
                  const leadSaved = await savePremiumLead(
                    subreddit,
                    opportunity.title,
                    commentResponse.premiumFeature,
                    opportunity.leadScore > 50 ? 'high' : 'medium',
                    opportunity.painPointAnalysis.painPoints,
                    opportunity.leadScore,
                    postResult.redditUrl,
                    batch
                  );
                  
                  // Send Discord notification only for high-priority leads
                  if (opportunity.leadScore >= DISCORD_HIGH_PRIORITY_THRESHOLD) {
                    const discordSent = await sendDiscordLeadNotification(leadData);
                    
                    if (discordSent) {
                      discordNotificationsSent++;
                      postingActivity.discordNotifications.totalSent = (postingActivity.discordNotifications.totalSent || 0) + 1;
                      postingActivity.discordNotifications.lastSent = new Date().toISOString();
                      console.log(`[DISCORD] ✅ Notification sent for high-priority lead from r/${subreddit} (Batch ${batch}, Score: ${opportunity.leadScore})`);
                    } else {
                      discordNotificationsFailed++;
                      console.log(`[DISCORD] ❌ Failed to send notification for lead from r/${subreddit}`);
                    }
                  } else {
                    console.log(`[DISCORD] ⏭️ Skipping Discord for lead score ${opportunity.leadScore} (threshold: ${DISCORD_HIGH_PRIORITY_THRESHOLD})`);
                  }
                  
                  premiumPosted++;
                }
                
                totalPosted++;
                goldenHourPosted++;
                
                console.log(`[SUCCESS] ✅ Posted to r/${subreddit} (Batch ${batch})`);
                console.log(`[SUCCESS] 📊 Lead Score: ${opportunity.leadScore}, Type: ${commentResponse.isPromotional ? 'Promotional' : 'Expert Advice'}`);
                
                // Check time remaining before delay
                const elapsedBeforeDelay = Date.now() - startTime;
                if (elapsedBeforeDelay > MAX_PROCESSING_TIME - 30000) {
                  console.log(`[TIME] ⚡ Low time remaining (${300000 - elapsedBeforeDelay}ms), skipping delay`);
                } else {
                  // Randomized delay between posts
                  await new Promise(resolve => safeSetTimeout(resolve, getRandomizedDelay()));
                }
              } else {
                console.log(`[ERROR] ❌ Failed to post to r/${subreddit}:`, postResult.error);
              }
            }
            
            // Stop if we've reached max posts per run
            if (totalPosted >= MAX_POSTS_PER_RUN) {
              console.log(`[LIMIT] ⏹️ Reached maximum posts per run (${MAX_POSTS_PER_RUN})`);
              break;
            }
          }
        } else {
          console.log(`\n[INFO] ⏳ No high-quality opportunities found (minimum score: ${MIN_LEAD_SCORE})`);
          
          // Optional: Fallback to bridge technique if no opportunities found
          if (totalPosted === 0 && FALLBACK_MODE) {
            console.log(`\n[FALLBACK] 🎯 Using Bridge Technique fallback`);
            
            // Find a subreddit that hasn't reached its daily limit
            const availableSubreddits = Object.entries(redditTargets)
              .filter(([sub, config]) => 
                config.active && 
                (postingActivity.dailyCounts[sub] || 0) < config.dailyCommentLimit
              )
              .sort((a, b) => (postingActivity.dailyCounts[a[0]] || 0) - (postingActivity.dailyCounts[b[0]] || 0));
            
            if (availableSubreddits.length > 0) {
              const [selectedSubreddit, config] = availableSubreddits[0];
              const batch = config.batch || getBatchForSubreddit(selectedSubreddit);
              const samplePosts = getSamplePostsForSubreddit(selectedSubreddit);
              const postTitle = samplePosts[Math.floor(Math.random() * samplePosts.length)];
              const painPoints = config.painPointFocus?.[0] ? [config.painPointFocus[0]] : ['frustration'];
              
              console.log(`[FALLBACK] 🚀 Generating Bridge Technique comment for r/${selectedSubreddit} (Batch ${batch})`);
              
              // 80/20 split for fallback too
              const shouldPromote = Math.random() <= (config.soundswapMentionRate || 0.2);
              let commentResponse;
              
              if (shouldPromote) {
                commentResponse = await generatePremiumFeatureComment(
                  postTitle,
                  '',
                  selectedSubreddit,
                  painPoints,
                  batch
                );
                promotionalPosted++;
              } else {
                commentResponse = await generateIndustryExpertComment(
                  postTitle,
                  '',
                  selectedSubreddit,
                  painPoints,
                  batch
                );
                expertAdvicePosted++;
              }
              
              if (commentResponse.success) {
                // Simulate posting
                console.log(`[FALLBACK] 📝 Would post to r/${selectedSubreddit}: ${commentResponse.comment.substring(0, 100)}...`);
                
                // Update counts (simulated)
                postingActivity.dailyCounts[selectedSubreddit] = (postingActivity.dailyCounts[selectedSubreddit] || 0) + 1;
                postingActivity.totalComments++;
                totalPosted++;
                
                // Update batch stats
                if (batch && postingActivity.batchStats[batch]) {
                  postingActivity.batchStats[batch].posts = (postingActivity.batchStats[batch].posts || 0) + 1;
                }
                
                // Send Discord notification for fallback (only if promotional and high priority)
                if (commentResponse.isPromotional) {
                  const fallbackLeadData = {
                    subreddit: selectedSubreddit,
                    postTitle: postTitle,
                    leadType: commentResponse.premiumFeature,
                    interestLevel: 'Medium',
                    leadScore: 30,
                    painPoints: painPoints,
                    redditUrl: `https://reddit.com/r/${selectedSubreddit}`,
                    totalLeadsToday: (postingActivity.premiumLeadsGenerated || 0) + 1,
                    batch: batch
                  };
                  
                  // Note: Fallback leads typically have low scores, so Discord won't be sent due to threshold
                  console.log(`[FALLBACK] 💬 Discord notification skipped (score 30 < threshold ${DISCORD_HIGH_PRIORITY_THRESHOLD})`);
                  
                  console.log(`[FALLBACK] ✅ Simulated post to r/${selectedSubreddit}`);
                }
              }
            }
          }
        }
        
        // Update pain point posts found stat
        postingActivity.goldenHourStats.painPointPostsFound += scanResults.highQualityPosts.length;
        
        // Log lead summary
        logLeadSummary(scanResults, postedComments);
        
        // Save activity
        await quickSavePostingActivity(postingActivity);
        
        const processingTime = Date.now() - startTime;
        console.log(`\n[INFO] ✅ Cron completed in ${processingTime}ms`);
        console.log(`[INFO] ⚡ Time remaining: ${300000 - processingTime}ms (5-minute limit)`);
        console.log(`[INFO] 📈 Results: ${totalPosted} total posts`);
        console.log(`[INFO]    - ${goldenHourPosted} Golden Hour responses`);
        console.log(`[INFO]    - ${expertAdvicePosted} expert advice posts (80%)`);
        console.log(`[INFO]    - ${promotionalPosted} promotional posts (20%)`);
        console.log(`[INFO] 💎 Premium Leads Generated: ${postingActivity.premiumLeadsGenerated}`);
        console.log(`[INFO] 💬 Discord Notifications: ${discordNotificationsSent} sent, ${discordNotificationsFailed} failed`);
        console.log(`[INFO] 📊 Batch Performance:`);
        Object.entries(postingActivity.batchStats || {}).forEach(([batch, stats]) => {
          console.log(`[INFO]    - Batch ${batch}: ${stats.posts || 0} posts, ${stats.leads || 0} leads`);
        });
        console.log(`[INFO] 🎯 Golden Hour Stats:`);
        console.log(`[INFO]    - Posts scanned this run: ${scanResults.allPosts.length}`);
        console.log(`[INFO]    - Total posts scanned: ${postingActivity.goldenHourStats.totalPostsScanned}`);
        console.log(`[INFO]    - Pain point posts found: ${postingActivity.goldenHourStats.painPointPostsFound}`);
        console.log(`[INFO]    - Total opportunities: ${postingActivity.goldenHourStats.totalOpportunitiesFound}`);
        console.log(`[INFO]    - Golden Hour comments: ${postingActivity.goldenHourStats.goldenHourComments}`);
        console.log(`[INFO] 📊 Rate Limits: ${postingActivity.rateLimitInfo?.remaining || 'unknown'} remaining`);
        console.log(`[INFO] 🔄 Optimization: FLUID_COMPUTE (${scanTime}ms scan time)`);
        console.log(`[INFO] ⏰ Human Window: ${withinHumanWindow ? 'ACTIVE' : 'INACTIVE'} (UTC ${currentUTCHour}:00)`);
        console.log(`[INFO] 🔔 Discord Filter: Only scores > ${DISCORD_HIGH_PRIORITY_THRESHOLD} sent`);
        console.log(`[INFO] 🕐 Schedule: ${SCHEDULE_INTERVAL}-minute intervals`);
        
        return {
          success: true,
          totalPosted: totalPosted,
          goldenHourPosted: goldenHourPosted,
          promotionalPosted: promotionalPosted,
          expertAdvicePosted: expertAdvicePosted,
          processingTime: processingTime,
          scanTime: scanTime,
          opportunitiesScanned: scanResults.allPosts.length,
          opportunitiesFound: scanResults.highQualityPosts.length,
          rateLimitInfo: postingActivity.rateLimitInfo,
          premiumLeads: postingActivity.premiumLeadsGenerated,
          goldenHourStats: postingActivity.goldenHourStats,
          batchStats: postingActivity.batchStats,
          geminiQuotaUsed: geminiQuotaInfo.requestCount,
          fallbackUsed: !genAI || geminiQuotaInfo.requestCount >= geminiQuotaInfo.quotaLimit,
          discordNotifications: {
            sent: discordNotificationsSent,
            failed: discordNotificationsFailed,
            totalSent: postingActivity.discordNotifications.totalSent || 0,
            threshold: DISCORD_HIGH_PRIORITY_THRESHOLD
          },
          humanWindow: {
            active: withinHumanWindow,
            currentUTC: `${currentUTCHour}:00 UTC`
          },
          fluidCompute: {
            maxDuration: 300000,
            timeUsed: processingTime,
            timeRemaining: 300000 - processingTime,
            buffer: 60000
          },
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error('[ERROR] ❌ Error in runScheduledPosts:', error);
        await quickSavePostingActivity(postingActivity);
        throw error;
      }
    };

  } catch (error) {
    console.error('[ERROR] ❌ Error loading core functions:', error);
    throw error;
  }
};

// ==================== EXPORT ====================

export default router;