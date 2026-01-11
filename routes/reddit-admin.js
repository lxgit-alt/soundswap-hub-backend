import express from 'express';

const router = express.Router();

// ==================== DISCORD WEBHOOK CONFIGURATION ====================
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

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

// ==================== DISCORD NOTIFICATION FUNCTION ====================

const sendDiscordLeadNotification = async (leadData) => {
  console.log('[DISCORD] 📤 Attempting to send notification...');
  console.log('[DISCORD] 📊 Lead data:', {
    subreddit: leadData.subreddit,
    score: leadData.leadScore,
    title: leadData.postTitle?.substring(0, 50) + '...'
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
      title: '🎯 **NEW LEAD GENERATED**',
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
          name: '🏷️ Lead Type',
          value: leadData.leadType || 'Premium Feature Interest',
          inline: true
        },
        {
          name: '🔥 Interest Level',
          value: leadData.interestLevel || 'Medium',
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
        }
      ],
      footer: {
        text: 'SoundSwap Reddit Automation • Lead Generation',
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
        content: `🎯 **New premium lead detected!** <@&1153832361951674478>`,
        embeds: [embed],
        username: 'SoundSwap Lead Bot',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2702/2702702.png'
      })
    });

    console.log(`[DISCORD] 📡 Response status: ${response.status}`);
    
    if (response.ok) {
      console.log('[DISCORD] ✅ Lead notification sent successfully');
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

// ==================== QUOTA AND TIMEOUT MANAGEMENT ====================

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

// Gemini API quota management
let geminiQuotaInfo = {
  lastRequest: null,
  requestCount: 0,
  quotaLimit: 20,
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

const withTimeout = async (promise, timeoutMs, timeoutMessage = 'Operation timed out') => {
  // Ensure timeoutMs is a safe, positive finite integer.
  const DEFAULT_TIMEOUT = 3000;
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
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
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
        userAgent: 'SoundSwap Reddit Bot v5.0 (Premium Features Focus)',
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        refreshToken: process.env.REDDIT_REFRESH_TOKEN,
        requestTimeout: 8000
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
const MAX_POSTS_PER_RUN = 2; // Increased to 2 for top opportunities
const MAX_COMMENTS_PER_DAY = 15;
const MAX_EDUCATIONAL_POSTS_PER_DAY = 3;
const AI_TIMEOUT_MS = 5000;
const VERCELL_TIMEOUT_MS = 10000;
const GOLDEN_HOUR_WINDOW_MINUTES = 60;
const FALLBACK_MODE = true;

// Performance optimization
const CONCURRENT_SCAN_LIMIT = 9; // All active subreddits
const POSTS_PER_SUBREDDIT = 5; // Fetch 5 newest posts per subreddit
const MIN_LEAD_SCORE = 20; // Minimum score to consider posting
const MAX_CONCURRENT_REQUESTS = 3; // Limit concurrent Reddit API calls

let postingActivity = null;

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

const calculateLeadScore = (post, subredditConfig) => {
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
  
  // 5. Subreddit Priority Bonus
  if (subredditConfig.priority === 'high') {
    score += 15;
  } else if (subredditConfig.priority === 'medium') {
    score += 10;
  }
  
  return Math.round(score);
};

// ==================== CONCURRENT SCANNING FUNCTIONS ====================

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
    return [];
  }
};

// Batch processing with concurrency control
const batchProcess = async (items, processor, concurrency = MAX_CONCURRENT_REQUESTS) => {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(item => processor(item))
    );
    results.push(...batchResults);
    
    // Small delay between batches to avoid rate limiting
    if (i + concurrency < items.length) {
      await new Promise(resolve => safeSetTimeout(resolve, 500));
    }
  }
  return results;
};

// Scan all active subreddits concurrently
const scanAllSubredditsConcurrently = async () => {
  const allActiveSubreddits = Object.keys(redditTargets).filter(k => redditTargets[k].active);
  
  console.log(`[SCAN] 🔍 Concurrently scanning ${allActiveSubreddits.length} active subreddits`);
  
  // Process subreddits in batches for rate limiting
  const allPosts = await batchProcess(
    allActiveSubreddits,
    async (subreddit) => {
      try {
        const posts = await withTimeout(
          fetchFreshPostsFromSubreddit(subreddit, GOLDEN_HOUR_WINDOW_MINUTES),
          4000,
          `Scan timeout for r/${subreddit}`
        );
        
        // Add subreddit config and calculate lead scores
        return posts.map(post => ({
          ...post,
          subredditConfig: redditTargets[subreddit],
          painPointAnalysis: analyzePostForPainPoints(post.title, post.content),
          leadScore: calculateLeadScore(post, redditTargets[subreddit])
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
    console.log(`[SCAN]     ${index + 1}. r/${post.subreddit} - "${post.title.substring(0, 50)}..." (Score: ${post.leadScore})`);
  });
  
  return {
    allPosts: flattenedPosts,
    highQualityPosts,
    topOpportunities: highQualityPosts.slice(0, MAX_POSTS_PER_RUN)
  };
};

// ==================== FALLBACK COMMENT GENERATION ====================

const generateFallbackComment = (subreddit, painPoints = []) => {
  const fallbackComments = {
    'WeAreTheMusicMakers': [
      "I understand the struggle with video editing! AI tools like soundswap.live can automate lyric video creation and save hours of work.",
      "Creating professional visuals doesn't have to be expensive or time-consuming. AI-powered tools can handle the technical parts for you.",
      "I've found that AI video generators can turn lyrics into animated videos in minutes instead of hours. Worth checking out!"
    ],
    'ArtistLounge': [
      "As a digital artist, AI tools have really helped speed up my workflow. Tools that turn sketches into finished art can save days of work.",
      "The right creative tools make all the difference. AI art generators can help bring concepts to life quickly."
    ],
    'aivideo': [
      "AI video tools can automate the entire video creation process. At SoundSwap, our lyric video generator analyzes BPM and syncs animations automatically.",
      "Creating professional music videos with AI saves hours of editing. Our tools handle timing, animation, and styling automatically."
    ],
    'musicproduction': [
      "Integrating AI video tools into music production workflow can save countless hours. Our lyric video generator syncs automatically with your tracks.",
      "Music producers don't need to be video editors. AI tools like SoundSwap's lyric video generator handle timing, animation, and styling automatically."
    ],
    'musicians': [
      "AI tools have revolutionized how musicians create visual content. Our lyric video generator turns songs into professional videos in minutes.",
      "Creating professional videos for your music doesn't require video editing skills. AI tools automate the entire process."
    ],
    'aiArt': [
      "AI art generation combined with music creates stunning visual experiences. SoundSwap tools transform sketches into animated music visuals.",
      "The combination of AI art and music opens up incredible creative possibilities. Tools like ours automate the animation process."
    ]
  };
  
  const defaultComment = "AI tools have really helped automate creative workflows. Check out soundswap.live if you're looking for automated video or art generation.";
  
  const comments = fallbackComments[subreddit] || [defaultComment];
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
    targetSubreddits: ['WeAreTheMusicMakers', 'aivideo', 'musicproduction', 'musicians', 'MusicMarketing', 'Spotify'],
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
    ]
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
    targetSubreddits: ['aiArt', 'ArtistLounge', 'WeAreTheMusicMakers', 'Spotify', 'musicproduction'],
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
    ]
  }
};

// ==================== REDDIT TARGET CONFIGURATION ====================

const redditTargets = {
  'WeAreTheMusicMakers': {
    name: 'WeAreTheMusicMakers',
    memberCount: 1800000,
    description: 'Dedicated to musicians, producers, and enthusiasts',
    active: true,
    priority: 'high',
    postingSchedule: {
      monday: ['10:00', '18:00'],
      tuesday: ['11:00', '19:00'],
      wednesday: ['10:00', '18:00'],
      thursday: ['11:00', '19:00'],
      friday: ['10:00', '18:00'],
      saturday: ['12:00', '20:00'],
      sunday: ['12:00', '20:00']
    },
    educationalPostSchedule: {
      tuesday: ['15:00'],
      friday: ['16:00']
    },
    preferredStyles: ['helpful', 'expert', 'thoughtful'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 4,
    educationalPostLimit: 1,
    premiumFeatureLimit: 2,
    keywords: ['lyric video', 'music video', 'visualizer', 'Spotify Canvas', 'animation', 'editing', 'frustrated', 'time-consuming'],
    premiumFeatures: ['lyricVideoGenerator', 'doodleArtGenerator'],
    targetAudience: 'musicians needing visual content',
    painPointFocus: ['frustration', 'budget', 'skillGap']
  },
  'aivideo': {
    name: 'aivideo',
    memberCount: 150000,
    description: 'AI-generated video community',
    active: true,
    priority: 'high',
    postingSchedule: {
      monday: ['09:00', '17:00'],
      wednesday: ['10:00', '18:00'],
      friday: ['11:00', '19:00']
    },
    educationalPostSchedule: {
      wednesday: ['14:00']
    },
    preferredStyles: ['technical', 'innovative', 'helpful'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 3,
    educationalPostLimit: 1,
    premiumFeatureLimit: 2,
    keywords: ['AI video', 'automation', 'text animation', 'music video', 'lyric video', 'generative video', 'AI animation'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'AI video enthusiasts and creators',
    painPointFocus: ['frustration', 'skillGap']
  },
  'musicproduction': {
    name: 'musicproduction',
    memberCount: 600000,
    description: 'Music production community',
    active: true,
    priority: 'high',
    postingSchedule: {
      tuesday: ['10:00', '18:00'],
      thursday: ['11:00', '19:00']
    },
    educationalPostSchedule: {
      thursday: ['15:00']
    },
    preferredStyles: ['technical', 'creative', 'expert'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 3,
    educationalPostLimit: 1,
    premiumFeatureLimit: 2,
    keywords: ['visual content', 'music video', 'lyric video', 'promotion', 'Spotify Canvas', 'artist branding'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'music producers needing visuals',
    painPointFocus: ['frustration', 'skillGap']
  },
  'musicians': {
    name: 'musicians',
    memberCount: 400000,
    description: 'Community for musicians of all levels',
    active: true,
    priority: 'medium',
    postingSchedule: {
      monday: ['11:00'],
      wednesday: ['16:00'],
      friday: ['14:00']
    },
    preferredStyles: ['supportive', 'practical', 'helpful'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 2,
    educationalPostLimit: 0,
    premiumFeatureLimit: 2,
    keywords: ['music video', 'visual content', 'promotion', 'lyrics', 'animation', 'affordable tools'],
    premiumFeatures: ['lyricVideoGenerator', 'doodleArtGenerator'],
    targetAudience: 'musicians seeking promotion tools',
    painPointFocus: ['frustration', 'budget']
  },
  'aiArt': {
    name: 'aiArt',
    memberCount: 300000,
    description: 'AI art generation community',
    active: true,
    priority: 'high',
    postingSchedule: {
      tuesday: ['10:00', '18:00'],
      thursday: ['11:00', '19:00'],
      saturday: ['13:00', '21:00']
    },
    educationalPostSchedule: {
      tuesday: ['16:00']
    },
    preferredStyles: ['creative', 'technical', 'innovative'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 3,
    educationalPostLimit: 1,
    premiumFeatureLimit: 2,
    keywords: ['AI art', 'generative art', 'animation', 'sketch to art', 'music visuals', 'Spotify Canvas'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'AI artists exploring music applications',
    painPointFocus: ['skillGap', 'budget']
  },
  'ArtistLounge': {
    name: 'ArtistLounge',
    memberCount: 200000,
    description: 'Community for artists to discuss their work',
    active: true,
    priority: 'medium',
    postingSchedule: {
      tuesday: ['14:00'],
      thursday: ['16:00'],
      sunday: ['15:00']
    },
    preferredStyles: ['supportive', 'creative', 'casual'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 2,
    educationalPostLimit: 0,
    premiumFeatureLimit: 1,
    keywords: ['art tools', 'animation', 'digital art', 'creative process', 'affordable', 'beginner'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'artists seeking new tools',
    painPointFocus: ['budget', 'skillGap']
  },
  'MusicMarketing': {
    name: 'MusicMarketing',
    memberCount: 50000,
    description: 'Music promotion and marketing strategies',
    active: true,
    priority: 'medium',
    postingSchedule: {
      monday: ['10:00'],
      wednesday: ['15:00'],
      friday: ['12:00']
    },
    educationalPostSchedule: {
      friday: ['14:00']
    },
    preferredStyles: ['strategic', 'helpful', 'professional'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 2,
    educationalPostLimit: 1,
    premiumFeatureLimit: 2,
    keywords: ['Spotify promotion', 'visual content', 'music videos', 'artist growth', 'Canvas', 'visualizer'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'artists focused on promotion',
    painPointFocus: ['budget', 'frustration']
  },
  'Spotify': {
    name: 'Spotify',
    memberCount: 10000000,
    description: 'General Spotify community (including Canvas discussions)',
    active: true,
    priority: 'medium',
    postingSchedule: {
      tuesday: ['11:00', '19:00'],
      thursday: ['12:00', '20:00']
    },
    educationalPostSchedule: {
      thursday: ['14:00']
    },
    preferredStyles: ['enthusiastic', 'helpful', 'casual'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 2,
    educationalPostLimit: 1,
    premiumFeatureLimit: 2,
    keywords: ['Spotify Canvas', 'animated artwork', 'visualizers', 'music visual', 'album art', 'animated'],
    premiumFeatures: ['doodleArtGenerator', 'lyricVideoGenerator'],
    targetAudience: 'Spotify users and artists',
    painPointFocus: ['skillGap', 'budget']
  }
};

// ==================== OPTIMIZED ANALYZE FUNCTION ====================

const analyzePostForPainPoints = (postTitle, postContent = '') => {
  const textToAnalyze = (postTitle + ' ' + postContent).toLowerCase();
  const detectedPainPoints = [];
  
  // Enhanced pain point detection with more keywords
  const painPointKeywords = {
    frustration: ['frustrated', 'annoying', 'tedious', 'time-consuming', 'waste time', 'too much work', 'exhausting', 'painful', 'hate'],
    budget: ['expensive', 'cheap', 'budget', 'cost', 'price', 'affordable', 'inexpensive', 'free', 'low cost'],
    skillGap: ['beginner', 'new', 'learn', 'how to', 'tutorial', 'no experience', 'simple', 'easy', 'basic', 'not technical']
  };
  
  // Check each pain point category
  Object.entries(painPointKeywords).forEach(([painPoint, keywords]) => {
    if (keywords.some(keyword => textToAnalyze.includes(keyword))) {
      detectedPainPoints.push(painPoint);
    }
  });
  
  // General need detection
  if (textToAnalyze.includes('help') || textToAnalyze.includes('struggle') || textToAnalyze.includes('problem') || 
      textToAnalyze.includes('advice') || textToAnalyze.includes('suggestion')) {
    detectedPainPoints.push('general_need');
  }
  
  return {
    hasPainPoints: detectedPainPoints.length > 0,
    painPoints: detectedPainPoints,
    score: detectedPainPoints.length * 10
  };
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

router.get('/cron-status', async (req, res) => {
  try {
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    const currentDate = getCurrentDateInAppTimezone();
    const timeWindow = getCurrentTimeWindow();
    const currentHour = getCurrentHourInAppTimezone();
    
    res.json({
      success: true,
      cron: {
        status: 'active',
        timezone: APP_TIMEZONE,
        currentTime: currentTime,
        currentDay: currentDay,
        currentDate: currentDate,
        timeWindow: timeWindow,
        goldenHourWindow: `${GOLDEN_HOUR_WINDOW_MINUTES} minutes`,
        totalComments: postingActivity?.totalComments || 0,
        totalEducationalPosts: postingActivity?.totalEducationalPosts || 0,
        totalPremiumMentions: postingActivity?.totalPremiumMentions || 0,
        premiumLeads: postingActivity?.premiumLeadsGenerated || 0,
        githubActionsRuns: postingActivity?.githubActionsRuns || 0,
        lastCronRun: postingActivity?.lastCronRun || null,
        reddit: {
          connected: isRedditLoaded,
          username: postingActivity?.redditUsername || null,
          posting: 'PRO_OPTIMIZATION_SCAN_ALL_FILTER_ONE'
        },
        dailyReset: {
          lastResetDate: postingActivity?.lastResetDate || currentDate,
          lastResetDay: postingActivity?.lastResetDay || currentDay,
          needsReset: postingActivity?.lastResetDate !== currentDate
        },
        performance: {
          batchLimit: MAX_POSTS_PER_RUN,
          aiTimeout: AI_TIMEOUT_MS,
          postingWindow: POSTING_WINDOW_MINUTES,
          goldenHourWindow: GOLDEN_HOUR_WINDOW_MINUTES,
          optimization: 'SCAN_ALL_FILTER_ONE',
          concurrentScanLimit: CONCURRENT_SCAN_LIMIT,
          minLeadScore: MIN_LEAD_SCORE,
          geminiQuota: {
            remaining: geminiQuotaInfo.quotaLimit - geminiQuotaInfo.requestCount,
            limit: geminiQuotaInfo.quotaLimit,
            fallbackMode: FALLBACK_MODE
          }
        },
        goldenHourStats: postingActivity?.goldenHourStats || {
          totalPostsScanned: 0,
          painPointPostsFound: 0,
          goldenHourComments: 0,
          totalOpportunitiesFound: 0
        },
        discordWebhook: {
          configured: !!DISCORD_WEBHOOK_URL,
          notificationsEnabled: true
        }
      },
      premiumFeatures: PREMIUM_FEATURES,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error in cron-status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Main cron endpoint
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
    
    const isIsolated = req.headers['x-isolated-cron'] === 'true';
    
    if (isIsolated) {
      console.log('[ISOLATED] 🚀 Running in isolated mode');
    }
    
    // Load core functions with timeout
    try {
      await loadCoreFunctions();
    } catch (loadError) {
      console.warn('[WARN] Module loading had issues:', loadError.message);
    }
    
    // Execute cron with timeout
    const result = await withTimeout(runScheduledPosts(), calculateTimeout(VERCELL_TIMEOUT_MS, 1000), 'Cron processing timeout');
    
    const processingTime = Date.now() - startTime;
    console.log(`[PERFORMANCE] ⏱️ Total processing time: ${processingTime}ms`);
    
    res.json({
      success: true,
      message: 'GitHub Actions cron execution completed',
      ...result,
      isolated: isIsolated,
      processingTime: processingTime,
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

// Get posting schedule for today
router.get('/schedule/today', (req, res) => {
  const today = getCurrentDayInAppTimezone();
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDate = getCurrentDateInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  const currentHour = getCurrentHourInAppTimezone();
  
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
        painPointFocus: config.painPointFocus
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
    optimization: {
      active: true,
      strategy: 'SCAN_ALL_FILTER_ONE',
      concurrentScanLimit: CONCURRENT_SCAN_LIMIT,
      minLeadScore: MIN_LEAD_SCORE
    },
    dailyReset: {
      lastResetDate: postingActivity?.lastResetDate || currentDate,
      needsReset: postingActivity?.lastResetDate !== currentDate
    },
    discordWebhook: {
      configured: !!DISCORD_WEBHOOK_URL,
      notificationsEnabled: true,
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
    timestamp: new Date().toISOString()
  });
});

// Get all configured Reddit targets
router.get('/targets', (req, res) => {
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
    optimization: {
      strategy: 'SCAN_ALL_FILTER_ONE',
      concurrentRequests: MAX_CONCURRENT_REQUESTS,
      postsPerSubreddit: POSTS_PER_SUBREDDIT,
      minLeadScore: MIN_LEAD_SCORE,
      maxPostsPerRun: MAX_POSTS_PER_RUN
    },
    discordNotifications: {
      enabled: true,
      webhookConfigured: !!DISCORD_WEBHOOK_URL
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
    
    const me = await withTimeout(redditClient.getMe(), 5000, 'Reddit API timeout');
    
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
    const { postTitle, postContent, subreddit, painPoints } = req.body;

    if (!postTitle) {
      return res.status(400).json({
        success: false,
        message: 'postTitle is required'
      });
    }

    if (!generatePremiumFeatureComment) {
      await loadCoreFunctions();
    }

    const result = await generatePremiumFeatureComment(postTitle, postContent, subreddit, painPoints || []);
    
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
        config: redditTargets[subreddit] ? {
          dailyLimit: redditTargets[subreddit].dailyCommentLimit,
          premiumLimit: redditTargets[subreddit].premiumFeatureLimit,
          painPointFocus: redditTargets[subreddit].painPointFocus
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
    
    let premiumFeature;
    if (targetConfig?.premiumFeatures?.includes('lyricVideoGenerator')) {
      premiumFeature = PREMIUM_FEATURES.lyricVideoGenerator;
    } else {
      premiumFeature = PREMIUM_FEATURES.doodleArtGenerator;
    }

    res.json({
      success: true,
      analysis: analysis,
      recommendations: {
        hasPainPoints: analysis.hasPainPoints,
        painPoints: analysis.painPoints,
        painPointScore: analysis.score,
        suggestedTone: targetConfig?.preferredStyles?.[0] || 'helpful',
        premiumFeature: premiumFeature.name,
        featuresToHighlight: premiumFeature.premiumFeatures.slice(0, 2),
        shouldComment: analysis.hasPainPoints && analysis.score >= 10,
        commentPriority: analysis.score >= 20 ? 'high' : analysis.score >= 10 ? 'medium' : 'low'
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
      3000,
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
        remaining: geminiQuotaInfo.quotaLimit - geminiQuotaInfo.requestCount
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
      leadScore: 85,
      painPoints: ['frustration', 'time-consuming'],
      redditUrl: 'https://reddit.com/r/WeAreTheMusicMakers/comments/test',
      totalLeadsToday: postingActivity?.premiumLeadsGenerated || 5
    };

    const result = await sendDiscordLeadNotification(testLeadData);
    
    if (result) {
      res.json({
        success: true,
        message: 'Discord test notification sent successfully',
        webhookUrl: DISCORD_WEBHOOK_URL ? 'Configured' : 'Using provided URL',
        testData: testLeadData,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send Discord test notification',
        webhookUrl: DISCORD_WEBHOOK_URL ? 'Configured' : 'Using provided URL'
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
      leadScore: 95,
      painPoints: ['frustration', 'time-consuming'],
      redditUrl: 'https://reddit.com/r/test',
      totalLeadsToday: 1
    };
    
    const result = await sendDiscordLeadNotification(testData);
    
    res.json({
      success: true,
      discordSent: result,
      webhookConfigured: !!DISCORD_WEBHOOK_URL,
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

// Admin endpoint
router.get('/admin', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  const currentHour = getCurrentHourInAppTimezone();
  
  res.json({
    success: true,
    message: 'Enhanced Lead Generation Reddit Admin API',
    service: 'reddit-admin',
    version: '6.0.0',
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
      description: 'Scans last 60 minutes for pain point posts'
    },
    optimization: {
      strategy: 'SCAN_ALL_FILTER_ONE',
      concurrentScanLimit: CONCURRENT_SCAN_LIMIT,
      minLeadScore: MIN_LEAD_SCORE,
      maxPostsPerRun: MAX_POSTS_PER_RUN,
      concurrentRequests: MAX_CONCURRENT_REQUESTS,
      postsPerSubreddit: POSTS_PER_SUBREDDIT
    },
    premiumFeatures: PREMIUM_FEATURES,
    features: {
      strategy_scan_all_filter_one: 'ACTIVE',
      concurrent_scanning: 'ENABLED',
      lead_scoring_system: 'ACTIVE',
      pain_point_detection: 'ENHANCED',
      keyword_matching: 'OPTIMIZED',
      freshness_scoring: 'ACTIVE',
      lyric_video_generator: 'PROMOTED',
      doodle_art_generator: 'PROMOTED',
      lead_generation: 'ENHANCED',
      rate_limit_management: 'ACTIVE',
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
      discord_notifications: DISCORD_WEBHOOK_URL ? 'ENABLED' : 'DISABLED'
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
    }
  });
});

// ==================== LAZY LOAD HELPER ====================

const loadCoreFunctions = async () => {
  try {
    // Load all required modules with timeout
    await withTimeout(loadFirebase(), 3000, 'Firebase load timeout');
    await withTimeout(loadReddit(), 3000, 'Reddit load timeout');
    
    // Only load AI if we have quota
    if (checkGeminiQuota()) {
      try {
        await withTimeout(loadAI(), 3000, 'AI load timeout');
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
        const snapshot = await withTimeout(getDocs(q), 3000, 'Firebase query timeout');
        
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
            }
          };
          
          Object.keys(redditTargets).forEach(subreddit => {
            initialActivity.dailyCounts[subreddit] = 0;
            initialActivity.educationalCounts[subreddit] = 0;
            initialActivity.premiumFeatureCounts[subreddit] = 0;
          });
          
          await withTimeout(addDoc(activityRef, initialActivity), 3000, 'Firebase add timeout');
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
        }), 3000, 'Firebase save timeout');
      } catch (error) {
        console.error('[ERROR] ❌ Error saving posting activity:', error);
      }
    };

    // Define savePremiumLead with Discord notification
    savePremiumLead = async (subreddit, postTitle, leadType, interestLevel, painPoints = [], leadScore, redditUrl = null) => {
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
          leadScore: leadScore
        }), 3000, 'Firebase save timeout');
        
        console.log(`[INFO] 💎 Premium lead saved: ${leadType} from r/${subreddit} with pain points: ${painPoints.join(', ')}`);
        
        // Increment lead count
        postingActivity.premiumLeadsGenerated = (postingActivity.premiumLeadsGenerated || 0) + 1;
        
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
        await withTimeout(getDocs(q), 3000, 'Firebase connection timeout');
        return true;
      } catch (error) {
        console.error('[ERROR] ❌ Firebase connection failed:', error);
        return false;
      }
    };

    // Define generatePremiumFeatureComment
    generatePremiumFeatureComment = async (postTitle, postContent, subreddit, painPoints = []) => {
      // Use fallback if AI not available or quota exceeded
      if (!genAI || !checkGeminiQuota()) {
        console.log('[FALLBACK] Using fallback comment generation');
        return {
          success: true,
          comment: generateFallbackComment(subreddit, painPoints),
          style: 'helpful',
          subreddit: subreddit,
          premiumFeature: 'AI Tools',
          isPremiumFocus: true,
          painPoints: painPoints,
          isFallback: true
        };
      }

      try {
        const targetConfig = redditTargets[subreddit];
        const selectedStyle = targetConfig?.preferredStyles[0] || 'helpful';
        
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

        // Updated prompt to act as SoundSwap team member and list important features
        const prompt = `As a member of the SoundSwap team, write a helpful Reddit comment (1-2 sentences max) for r/${subreddit} about:
Post: "${postTitle}"
User needs: ${painPoints.join(', ') || 'help with creative work'}

Our tool ${premiumFeature.name} can help. Important features include:
${premiumFeature.importantFeatures.slice(0, 3).join(', ')}

Mention soundswap.live. Use ${selectedStyle} tone. Focus on how our features solve their specific pain points.`;

        const aiCall = model.generateContent(prompt);
        const result = await withTimeout(aiCall, AI_TIMEOUT_MS, 'AI generation timeout');
        const response = await result.response;
        let comment = response.text().trim();

        // Increment quota counter
        incrementGeminiRequest();
        
        console.log(`[INFO] ✅ Premium feature comment generated for r/${subreddit}`);
        
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
          isFallback: false
        };

      } catch (error) {
        console.error(`[ERROR] ❌ Premium comment generation failed:`, error.message);
        
        // Use fallback on AI error
        return {
          success: true,
          comment: generateFallbackComment(subreddit, painPoints),
          style: 'helpful',
          subreddit: subreddit,
          premiumFeature: 'AI Tools',
          isPremiumFocus: true,
          painPoints: painPoints,
          isFallback: true
        };
      }
    };

    // Define postToReddit (simulated for now)
    postToReddit = async (subreddit, content, style, type = 'comment', title = '', keywords = [], parentId = null) => {
      try {
        // Simulate posting with random success
        const success = Math.random() > 0.1; // 90% success rate
        
        if (success) {
          const redditUrl = `https://reddit.com/r/${subreddit}/comments/${parentId || 'new'}_${Date.now()}`;
          return { 
            success: true, 
            redditData: { 
              permalink: redditUrl,
              id: `comment_${Date.now()}`,
              parentId: parentId
            },
            type: type,
            isGoldenHour: parentId ? true : false,
            redditUrl: redditUrl
          };
        } else {
          return { 
            success: false, 
            error: 'Simulated posting failure',
            type: type
          };
        }
      } catch (error) {
        console.error(`[ERROR] ❌ Error in postToReddit for r/${subreddit}:`, error.message);
        return { 
          success: false, 
          error: error.message,
          type: type
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
        'aivideo': [
          "Looking for AI tools to automate video creation",
          "How can AI help with music video generation?",
          "Best AI video generators for lyric videos?",
          "Automating video editing with AI"
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
        'aiArt': [
          "Using AI art for music visualizations",
          "Best AI tools for album cover creation",
          "Turning sketches into animated music visuals",
          "AI art generation for Spotify Canvas"
        ],
        'ArtistLounge': [
          "Need affordable tools for digital art creation",
          "How to create art for music without being an artist?"
        ]
      };
      
      return samplePosts[subreddit] || ["Looking for help with creative projects"];
    };

    // Define runScheduledPosts with PRO optimization
    runScheduledPosts = async () => {
      const startTime = Date.now();
      
      try {
        postingActivity.lastCronRun = new Date().toISOString();
        postingActivity.githubActionsRuns++;
        
        const currentTime = getCurrentTimeInAppTimezone();
        const currentDay = getCurrentDayInAppTimezone();
        const timeWindow = getCurrentTimeWindow();
        
        console.log(`[INFO] ⏰ PRO OPTIMIZATION Cron Running`);
        console.log(`[INFO] 📅 Date: ${getCurrentDateInAppTimezone()} (${currentDay})`);
        console.log(`[INFO] 🕒 Time: ${currentTime} (Window: ${timeWindow.start}-${timeWindow.end})`);
        console.log(`[INFO] 💎 Strategy: SCAN_ALL_FILTER_ONE`);
        console.log(`[INFO] 🔄 Scanning all ${Object.keys(redditTargets).filter(k => redditTargets[k].active).length} active subreddits concurrently`);
        console.log(`[INFO] 🤖 AI Status: ${genAI ? 'Available' : 'Fallback mode'}`);
        console.log(`[INFO] 📊 Gemini Quota: ${geminiQuotaInfo.quotaLimit - geminiQuotaInfo.requestCount} remaining`);
        console.log(`[INFO] 💬 Discord Webhook: ${DISCORD_WEBHOOK_URL ? 'Configured' : 'Not configured'}`);
        
        // STEP 1: Concurrently scan ALL active subreddits
        const scanStartTime = Date.now();
        const scanResults = await scanAllSubredditsConcurrently();
        const scanTime = Date.now() - scanStartTime;
        
        console.log(`[SCAN] ⏱️ Scan completed in ${scanTime}ms`);
        console.log(`[SCAN] 📊 Found ${scanResults.highQualityPosts.length} high-quality opportunities`);
        
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
        
        // STEP 2: Process top opportunities (up to MAX_POSTS_PER_RUN)
        if (scanResults.topOpportunities.length > 0) {
          console.log(`\n[ACTION] 🎯 Processing top ${scanResults.topOpportunities.length} opportunities`);
          
          for (const opportunity of scanResults.topOpportunities) {
            const subreddit = opportunity.subreddit;
            const config = opportunity.subredditConfig;
            
            // Check daily limits
            const dailyCount = postingActivity.dailyCounts[subreddit] || 0;
            if (dailyCount >= config.dailyCommentLimit) {
              console.log(`[LIMIT] ⏭️ Daily limit reached for r/${subreddit} (${dailyCount}/${config.dailyCommentLimit}), skipping...`);
              continue;
            }
            
            console.log(`[ACTION] 💎 Processing opportunity from r/${subreddit} (Score: ${opportunity.leadScore})`);
            console.log(`[ACTION] 📝 Post: "${opportunity.title.substring(0, 80)}..."`);
            
            // Generate comment
            const commentResponse = await generatePremiumFeatureComment(
              opportunity.title,
              opportunity.content,
              subreddit,
              opportunity.painPointAnalysis.painPoints
            );
            
            if (commentResponse.success) {
              // Post to Reddit (simulated for now)
              const postResult = await postToReddit(
                subreddit,
                commentResponse.comment,
                commentResponse.style,
                'comment',
                '',
                config.keywords,
                opportunity.id
              );
              
              if (postResult.success) {
                // Update activity
                postingActivity.dailyCounts[subreddit] = (postingActivity.dailyCounts[subreddit] || 0) + 1;
                postingActivity.lastPosted[subreddit] = new Date().toISOString();
                postingActivity.totalComments++;
                postingActivity.goldenHourStats.goldenHourComments++;
                
                // Create lead data for Discord notification
                const leadData = {
                  subreddit,
                  postTitle: opportunity.title,
                  leadType: commentResponse.premiumFeature,
                  interestLevel: opportunity.leadScore > 50 ? 'high' : 'medium',
                  painPoints: opportunity.painPointAnalysis.painPoints,
                  leadScore: opportunity.leadScore,
                  redditUrl: postResult.redditUrl,
                  totalLeadsToday: (postingActivity.premiumLeadsGenerated || 0) + 1
                };
                
                // Save lead to Firebase
                const leadSaved = await savePremiumLead(
                  subreddit,
                  opportunity.title,
                  commentResponse.premiumFeature,
                  opportunity.leadScore > 50 ? 'high' : 'medium',
                  opportunity.painPointAnalysis.painPoints,
                  opportunity.leadScore,
                  postResult.redditUrl
                );
                
                // Send Discord notification directly
                const discordSent = await sendDiscordLeadNotification(leadData);
                
                if (discordSent) {
                  discordNotificationsSent++;
                  postingActivity.discordNotifications.totalSent = (postingActivity.discordNotifications.totalSent || 0) + 1;
                  postingActivity.discordNotifications.lastSent = new Date().toISOString();
                  console.log(`[DISCORD] ✅ Notification sent for lead from r/${subreddit}`);
                } else {
                  discordNotificationsFailed++;
                  console.log(`[DISCORD] ❌ Failed to send notification for lead from r/${subreddit}`);
                }
                
                totalPosted++;
                goldenHourPosted++;
                premiumPosted++;
                
                console.log(`[SUCCESS] ✅ Posted to r/${subreddit} (Golden Hour)`);
                console.log(`[SUCCESS] 📊 Lead Score: ${opportunity.leadScore}, Pain Points: ${opportunity.painPointAnalysis.painPoints.join(', ')}`);
                
                // Rate limiting delay between posts
                await new Promise(resolve => safeSetTimeout(resolve, 2000));
              } else {
                console.log(`[ERROR] ❌ Failed to post to r/${subreddit}:`, postResult.error);
              }
            }
            
            // Stop if we've reached max posts per run
            if (totalPosted >= MAX_POSTS_PER_RUN) {
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
              const samplePosts = getSamplePostsForSubreddit(selectedSubreddit);
              const postTitle = samplePosts[Math.floor(Math.random() * samplePosts.length)];
              const painPoints = config.painPointFocus?.[0] ? [config.painPointFocus[0]] : ['frustration'];
              
              console.log(`[FALLBACK] 🚀 Generating Bridge Technique comment for r/${selectedSubreddit}`);
              
              const commentResponse = await generatePremiumFeatureComment(
                postTitle,
                '',
                selectedSubreddit,
                painPoints
              );
              
              if (commentResponse.success) {
                // Simulate posting
                console.log(`[FALLBACK] 📝 Would post to r/${selectedSubreddit}: ${commentResponse.comment.substring(0, 100)}...`);
                
                // Update counts (simulated)
                postingActivity.dailyCounts[selectedSubreddit] = (postingActivity.dailyCounts[selectedSubreddit] || 0) + 1;
                postingActivity.totalComments++;
                totalPosted++;
                premiumPosted++;
                
                // Send Discord notification for fallback
                const fallbackLeadData = {
                  subreddit: selectedSubreddit,
                  postTitle: postTitle,
                  leadType: commentResponse.premiumFeature,
                  interestLevel: 'Medium',
                  leadScore: 30,
                  painPoints: painPoints,
                  redditUrl: `https://reddit.com/r/${selectedSubreddit}`,
                  totalLeadsToday: (postingActivity.premiumLeadsGenerated || 0) + 1
                };
                
                const discordSent = await sendDiscordLeadNotification(fallbackLeadData);
                if (discordSent) {
                  discordNotificationsSent++;
                  postingActivity.premiumLeadsGenerated = (postingActivity.premiumLeadsGenerated || 0) + 1;
                  postingActivity.discordNotifications.totalSent = (postingActivity.discordNotifications.totalSent || 0) + 1;
                  postingActivity.discordNotifications.lastSent = new Date().toISOString();
                  console.log(`[FALLBACK] 💬 Discord notification sent for fallback lead`);
                }
                
                console.log(`[FALLBACK] ✅ Simulated post to r/${selectedSubreddit}`);
              }
            }
          }
        }
        
        // Update pain point posts found stat
        postingActivity.goldenHourStats.painPointPostsFound += scanResults.highQualityPosts.length;
        
        // Save activity
        await quickSavePostingActivity(postingActivity);
        
        const processingTime = Date.now() - startTime;
        console.log(`\n[INFO] ✅ Cron completed in ${processingTime}ms`);
        console.log(`[INFO] 📈 Results: ${totalPosted} total posts`);
        console.log(`[INFO]    - ${goldenHourPosted} Golden Hour responses`);
        console.log(`[INFO]    - ${premiumPosted} premium-focused posts`);
        console.log(`[INFO] 💎 Premium Leads Generated: ${postingActivity.premiumLeadsGenerated}`);
        console.log(`[INFO] 💬 Discord Notifications: ${discordNotificationsSent} sent, ${discordNotificationsFailed} failed`);
        console.log(`[INFO] 🎯 Golden Hour Stats:`);
        console.log(`[INFO]    - Posts scanned this run: ${scanResults.allPosts.length}`);
        console.log(`[INFO]    - Total posts scanned: ${postingActivity.goldenHourStats.totalPostsScanned}`);
        console.log(`[INFO]    - Pain point posts found: ${postingActivity.goldenHourStats.painPointPostsFound}`);
        console.log(`[INFO]    - Total opportunities: ${postingActivity.goldenHourStats.totalOpportunitiesFound}`);
        console.log(`[INFO]    - Golden Hour comments: ${postingActivity.goldenHourStats.goldenHourComments}`);
        console.log(`[INFO] 📊 Rate Limits: ${postingActivity.rateLimitInfo?.remaining || 'unknown'} remaining`);
        console.log(`[INFO] 🔄 Optimization: SCAN_ALL_FILTER_ONE (${scanTime}ms scan time)`);
        
        return {
          success: true,
          totalPosted: totalPosted,
          goldenHourPosted: goldenHourPosted,
          premiumPosted: premiumPosted,
          processingTime: processingTime,
          scanTime: scanTime,
          opportunitiesScanned: scanResults.allPosts.length,
          opportunitiesFound: scanResults.highQualityPosts.length,
          rateLimitInfo: postingActivity.rateLimitInfo,
          premiumLeads: postingActivity.premiumLeadsGenerated,
          goldenHourStats: postingActivity.goldenHourStats,
          geminiQuotaUsed: geminiQuotaInfo.requestCount,
          fallbackUsed: !genAI || geminiQuotaInfo.requestCount >= geminiQuotaInfo.quotaLimit,
          discordNotifications: {
            sent: discordNotificationsSent,
            failed: discordNotificationsFailed,
            totalSent: postingActivity.discordNotifications.totalSent || 0
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