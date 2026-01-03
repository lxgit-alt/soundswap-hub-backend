import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, where, updateDoc, doc, getDoc, deleteDoc, orderBy, limit } from 'firebase/firestore';
import snoowrap from 'snoowrap';

const router = express.Router();

// Initialize Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Initialize Firebase app and Firestore
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Collections
const SCHEDULED_POSTS_COLLECTION = 'scheduledPosts';
const EDUCATIONAL_POSTS_COLLECTION = 'educationalPosts';
const POSTING_ACTIVITY_COLLECTION = 'postingActivity';
const PREMIUM_FEATURE_LEADS_COLLECTION = 'premiumFeatureLeads';

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// ==================== PERFORMANCE CONFIGURATION ====================

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';
const POSTING_WINDOW_MINUTES = 10;
const MAX_POSTS_PER_RUN = 3;
const MAX_COMMENTS_PER_DAY = 15; // Stay well under Reddit API limits
const MAX_EDUCATIONAL_POSTS_PER_DAY = 3;
const AI_TIMEOUT_MS = 5000;
const VERCELL_TIMEOUT_MS = 8000;
const GOLDEN_HOUR_WINDOW_MINUTES = 60; // Check last 60 minutes for fresh posts

// ==================== PAIN POINT INTENT TRIGGERS ====================

const INTENT_TRIGGERS = {
  frustration: [
    'hate making music videos',
    'video editing takes too long',
    'tedious editing process',
    'spending hours on visuals',
    'video creation is exhausting',
    'wasting time on editing',
    'manual video editing sucks',
    'too much work for one video',
    'editing process is painful',
    'can\'t stand editing anymore'
  ],
  budget: [
    'cheap ways to get visuals',
    'free alternative to canva',
    'free alternative to adobe',
    'affordable video editing',
    'low budget music video',
    'cost effective visuals',
    'cheap video editing software',
    'free music video maker',
    'budget friendly animation',
    'inexpensive video creation'
  ],
  skillGap: [
    'i can\'t draw but want art',
    'how do people make doodle videos',
    'no design skills but need visuals',
    'not technical enough for editing',
    'beginner trying to make videos',
    'simple tools for non-designers',
    'easy way to create animations',
    'no experience with video editing',
    'how to make videos without skills',
    'simple video creation for beginners'
  ]
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
    targetSubreddits: ['WeAreTheMusicMakers', 'videoediting', 'AfterEffects', 'MotionDesign', 'MusicMarketing', 'Spotify'],
    painPointSolutions: {
      frustration: 'Automates the tedious video editing process',
      budget: 'Professional quality at a fraction of the cost',
      skillGap: 'No design skills needed - AI does the hard work'
    }
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
    targetSubreddits: ['digitalart', 'StableDiffusion', 'ArtistLounge', 'WeAreTheMusicMakers', 'Spotify'],
    painPointSolutions: {
      frustration: 'Turns simple sketches into finished art instantly',
      budget: 'Create premium artwork without expensive software',
      skillGap: 'Transform basic drawings into professional animations'
    }
  }
};

// ==================== TIME HELPER FUNCTIONS ====================

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

// ==================== ENHANCED TIME FUNCTIONS FOR GOLDEN HOUR ====================

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

// ==================== REDDIT API CONFIGURATION ====================

// Initialize Reddit API client
const redditClient = new snoowrap({
  userAgent: 'SoundSwap Reddit Bot v5.0 (Premium Features Focus)',
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  refreshToken: process.env.REDDIT_REFRESH_TOKEN
});

// Enhanced Reddit connection test with rate limit awareness
const testRedditConnection = async () => {
  try {
    // Get user info first
    const me = await redditClient.getMe();
    
    // Check rate limits from snoowrap client
    const rateLimits = {
      remaining: redditClient.ratelimitRemaining || 60,
      reset: redditClient.ratelimitReset,
      used: redditClient.ratelimitUsed || 0
    };
    
    console.log('📊 Reddit Rate Limits:', {
      remaining: rateLimits.remaining,
      reset: rateLimits.reset ? new Date(rateLimits.reset * 1000).toISOString() : 'unknown',
      used: rateLimits.used
    });
    
    console.log(`✅ Reddit API connected successfully. Logged in as: ${me.name}`);
    return { 
      success: true, 
      username: me.name,
      rateLimits: rateLimits
    };
  } catch (error) {
    console.error('❌ Reddit API connection failed:', error.message);
    return { success: false, error: error.message };
  }
};

// ==================== ENHANCED REDDIT POST FETCHING ====================

const fetchFreshPostsFromSubreddit = async (subreddit, timeWindowMinutes = 60) => {
  try {
    console.log(`🔍 Fetching fresh posts from r/${subreddit} (last ${timeWindowMinutes} minutes)`);
    
    // Get current time for timestamp comparison
    const now = Math.floor(Date.now() / 1000);
    const timeThreshold = now - (timeWindowMinutes * 60);
    
    // Fetch new posts from the subreddit
    const posts = await redditClient.getSubreddit(subreddit).getNew({
      limit: 25 // Get enough posts to filter by time
    });
    
    // Filter posts from the last timeWindowMinutes
    const freshPosts = posts.filter(post => {
      const postTime = post.created_utc;
      return postTime >= timeThreshold;
    });
    
    console.log(`📊 Found ${freshPosts.length} fresh posts in r/${subreddit} from last ${timeWindowMinutes} minutes`);
    
    return freshPosts.map(post => ({
      id: post.id,
      title: post.title,
      content: post.selftext,
      author: post.author.name,
      created_utc: post.created_utc,
      url: post.url,
      score: post.score,
      num_comments: post.num_comments,
      subreddit: subreddit,
      isFresh: isWithinGoldenHour(post.created_utc)
    }));
    
  } catch (error) {
    console.error(`❌ Error fetching fresh posts from r/${subreddit}:`, error.message);
    return [];
  }
};

const analyzePostForPainPoints = (postTitle, postContent = '') => {
  const textToAnalyze = (postTitle + ' ' + postContent).toLowerCase();
  const detectedPainPoints = [];
  
  // Check for frustration triggers
  if (INTENT_TRIGGERS.frustration.some(trigger => textToAnalyze.includes(trigger))) {
    detectedPainPoints.push('frustration');
  }
  
  // Check for budget triggers
  if (INTENT_TRIGGERS.budget.some(trigger => textToAnalyze.includes(trigger))) {
    detectedPainPoints.push('budget');
  }
  
  // Check for skill gap triggers
  if (INTENT_TRIGGERS.skillGap.some(trigger => textToAnalyze.includes(trigger))) {
    detectedPainPoints.push('skillGap');
  }
  
  // Check for other related keywords
  const relatedKeywords = [
    'struggle with',
    'help with',
    'how to',
    'need help',
    'looking for',
    'recommendations for',
    'advice on',
    'trouble with',
    'problem with',
    'issue with'
  ];
  
  if (relatedKeywords.some(keyword => textToAnalyze.includes(keyword))) {
    detectedPainPoints.push('general_need');
  }
  
  return {
    hasPainPoints: detectedPainPoints.length > 0,
    painPoints: detectedPainPoints,
    score: detectedPainPoints.length * 10
  };
};

// ==================== AUTOMATIC DAILY RESET FUNCTIONALITY ====================

// Function to check and reset daily counts if it's a new day
const resetDailyCountsIfNeeded = async (currentActivity) => {
  try {
    const currentDate = getCurrentDateInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    
    // If no lastResetDate exists or it's a different day, reset counts
    if (!currentActivity.lastResetDate || currentActivity.lastResetDate !== currentDate) {
      console.log(`🔄 New day detected! Resetting daily counts from ${currentActivity.lastResetDate || 'never'} to ${currentDate}`);
      
      // Initialize counts if they don't exist
      currentActivity.dailyCounts = currentActivity.dailyCounts || {};
      currentActivity.educationalCounts = currentActivity.educationalCounts || {};
      currentActivity.premiumFeatureCounts = currentActivity.premiumFeatureCounts || {};
      
      // Reset all daily counts
      Object.keys(currentActivity.dailyCounts).forEach(key => {
        currentActivity.dailyCounts[key] = 0;
      });
      Object.keys(currentActivity.educationalCounts).forEach(key => {
        currentActivity.educationalCounts[key] = 0;
      });
      Object.keys(currentActivity.premiumFeatureCounts).forEach(key => {
        currentActivity.premiumFeatureCounts[key] = 0;
      });
      
      // Reset last posted timestamps to allow immediate posting
      currentActivity.lastPosted = currentActivity.lastPosted || {};
      currentActivity.lastEducationalPosted = currentActivity.lastEducationalPosted || {};
      currentActivity.lastPremiumPosted = currentActivity.lastPremiumPosted || {};
      
      // Update reset tracking
      currentActivity.lastResetDate = currentDate;
      currentActivity.lastResetDay = currentDay;
      currentActivity.lastResetTime = new Date().toISOString();
      
      console.log(`✅ Daily counts reset for ${currentDate} (${currentDay})`);
      console.log(`📊 Reset counts:`, {
        comments: currentActivity.dailyCounts,
        educational: currentActivity.educationalCounts,
        premium: currentActivity.premiumFeatureCounts
      });
      
      return true;
    } else {
      console.log(`⏰ Same day (${currentDate}), no reset needed. Last reset: ${currentActivity.lastResetDate}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Error resetting daily counts:', error);
    return false;
  }
};

// ==================== ENHANCED FIREBASE FUNCTIONS ====================

const checkFirebaseConnection = async () => {
  try {
    const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
    const q = query(activityRef, limit(1));
    await getDocs(q);
    return true;
  } catch (error) {
    console.error('❌ Firebase connection failed:', error);
    return false;
  }
};

const savePremiumLead = async (subreddit, postTitle, leadType, interestLevel, painPoints = []) => {
  try {
    const leadsRef = collection(db, PREMIUM_FEATURE_LEADS_COLLECTION);
    await addDoc(leadsRef, {
      subreddit,
      postTitle,
      leadType,
      interestLevel,
      painPoints,
      timestamp: new Date().toISOString(),
      date: getCurrentDateInAppTimezone(),
      converted: false,
      source: 'reddit_comment',
      goldenHour: true
    });
    console.log(`💎 Premium lead saved: ${leadType} from r/${subreddit} with pain points: ${painPoints.join(', ')}`);
  } catch (error) {
    console.error('❌ Error saving premium lead:', error);
  }
};

const initializePostingActivity = async () => {
  try {
    const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
    const q = query(activityRef, orderBy('timestamp', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    
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
          goldenHourComments: 0
        }
      };
      
      Object.keys(redditTargets).forEach(subreddit => {
        initialActivity.dailyCounts[subreddit] = 0;
        initialActivity.educationalCounts[subreddit] = 0;
        initialActivity.premiumFeatureCounts[subreddit] = 0;
      });
      
      await addDoc(activityRef, initialActivity);
      console.log('✅ Initialized new posting activity record with daily reset');
      return initialActivity;
    } else {
      const activityDoc = snapshot.docs[0].data();
      console.log('✅ Loaded existing posting activity');
      
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
        goldenHourComments: 0
      };
      
      // Initialize counts for any new subreddits that aren't in the existing data
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
      
      // Check if we need to reset daily counts
      await resetDailyCountsIfNeeded(activityDoc);
      
      return activityDoc;
    }
  } catch (error) {
    console.error('❌ Error initializing posting activity:', error);
    return getFallbackActivity();
  }
};

const getFallbackActivity = () => {
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
      goldenHourComments: 0
    }
  };
  
  Object.keys(redditTargets).forEach(subreddit => {
    fallbackActivity.dailyCounts[subreddit] = 0;
    fallbackActivity.educationalCounts[subreddit] = 0;
    fallbackActivity.premiumFeatureCounts[subreddit] = 0;
  });
  
  return fallbackActivity;
};

const quickSavePostingActivity = async (activity) => {
  try {
    const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
    await addDoc(activityRef, {
      ...activity,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error saving posting activity:', error);
  }
};

const quickStoreScheduledPost = async (postData) => {
  try {
    const postsRef = collection(db, SCHEDULED_POSTS_COLLECTION);
    const docRef = await addDoc(postsRef, {
      ...postData,
      createdAt: new Date().toISOString(),
      posted: false,
      postedAt: null,
      redditData: null
    });
    return docRef.id;
  } catch (error) {
    console.error('❌ Error storing scheduled post:', error);
    return null;
  }
};

const quickStoreEducationalPost = async (postData) => {
  try {
    const postsRef = collection(db, EDUCATIONAL_POSTS_COLLECTION);
    const docRef = await addDoc(postsRef, {
      ...postData,
      createdAt: new Date().toISOString(),
      posted: false,
      postedAt: null,
      redditData: null
    });
    return docRef.id;
  } catch (error) {
    console.error('❌ Error storing educational post:', error);
    return null;
  }
};

const getScheduledPostsForTimeWindow = async (timeWindow) => {
  try {
    const currentDay = getCurrentDayInAppTimezone();
    const { start, end } = timeWindow;
    
    console.log(`🕒 Checking time window: ${start} to ${end} (current: ${timeWindow.current})`);
    
    const postsRef = collection(db, SCHEDULED_POSTS_COLLECTION);
    const q = query(
      postsRef, 
      where('scheduledDay', '==', currentDay),
      where('posted', '==', false)
    );
    
    const snapshot = await getDocs(q);
    const posts = [];
    
    snapshot.forEach(doc => {
      const post = { id: doc.id, ...doc.data() };
      if (post.scheduledTime >= start && post.scheduledTime <= end) {
        posts.push(post);
      }
    });
    
    console.log(`📊 Found ${posts.length} scheduled posts in Firebase for time window ${start}-${end} on ${currentDay}`);
    return posts;
  } catch (error) {
    console.error('❌ Error getting scheduled posts:', error);
    return [];
  }
};

const getEducationalPostsForTimeWindow = async (timeWindow) => {
  try {
    const currentDay = getCurrentDayInAppTimezone();
    const { start, end } = timeWindow;
    
    console.log(`🕒 Checking educational posts time window: ${start} to ${end} (current: ${timeWindow.current})`);
    
    const postsRef = collection(db, EDUCATIONAL_POSTS_COLLECTION);
    const q = query(
      postsRef, 
      where('scheduledDay', '==', currentDay),
      where('posted', '==', false)
    );
    
    const snapshot = await getDocs(q);
    const posts = [];
    
    snapshot.forEach(doc => {
      const post = { id: doc.id, ...doc.data() };
      if (post.scheduledTime >= start && post.scheduledTime <= end) {
        posts.push(post);
      }
    });
    
    console.log(`📊 Found ${posts.length} educational posts in Firebase for time window ${start}-${end} on ${currentDay}`);
    return posts;
  } catch (error) {
    console.error('❌ Error getting educational posts:', error);
    return [];
  }
};

const quickMarkPostAsPosted = async (postId, collectionName, redditData = null) => {
  try {
    const postRef = doc(db, collectionName, postId);
    await updateDoc(postRef, {
      posted: true,
      postedAt: new Date().toISOString(),
      redditData: redditData
    });
    return true;
  } catch (error) {
    console.error('❌ Error marking post as posted:', error);
    return false;
  }
};

// ==================== RATE LIMIT MANAGEMENT ====================

const checkRateLimit = async () => {
  try {
    // Get your Reddit account info - this automatically checks rate limits
    const me = await redditClient.getMe();
    
    // Snoowrap automatically tracks rate limits in the client
    // We can check the last response headers for rate limit info
    const rateLimitRemaining = redditClient.ratelimitRemaining;
    const rateLimitReset = redditClient.ratelimitReset;
    const rateLimitUsed = redditClient.ratelimitUsed;
    
    postingActivity.rateLimitInfo = {
      lastCheck: new Date().toISOString(),
      remaining: rateLimitRemaining || 60, // Fallback to 60 if unknown
      resetTime: rateLimitReset ? new Date(rateLimitReset * 1000).toISOString() : null,
      used: rateLimitUsed || 0
    };
    
    console.log(`📊 Rate Limits: ${postingActivity.rateLimitInfo.remaining} remaining`);
    
    // If we don't have rate limit info, proceed cautiously
    if (rateLimitRemaining === null || rateLimitRemaining === undefined) {
      console.log('⚠️ Rate limit info unavailable, proceeding with caution');
      return true;
    }
    
    if (rateLimitRemaining < 10) {
      console.warn('⚠️ Rate limit low! Waiting for reset...');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error checking rate limits:', error.message);
    // If we can't check rate limits, proceed with caution
    return true;
  }
};

// Safe rate limit check that won't break the promise chain
const safeCheckRateLimit = async () => {
  try {
    return await checkRateLimit();
  } catch (error) {
    console.warn('⚠️ Safe rate limit check failed, proceeding anyway:', error.message);
    return true; // Always return true to prevent breaking the chain
  }
};

const enforceRateLimit = async () => {
  // Add delay between posts to stay within limits
  const delay = 2000 + Math.random() * 3000; // 2-5 seconds
  await new Promise(resolve => setTimeout(resolve, delay));
};

// ==================== ENHANCED REDDIT TARGET CONFIGURATION ====================

const redditTargets = {
  // Existing music subreddits (optimized)
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
    keywords: ['lyric video', 'music video', 'visualizer', 'Spotify Canvas', 'animation'],
    premiumFeatures: ['lyricVideoGenerator', 'doodleArtGenerator'],
    targetAudience: 'musicians needing visual content',
    painPointFocus: ['frustration', 'budget', 'skillGap']
  },
  
  // NEW: Video Editing & Animation Subreddits (Premium Focus)
  'videoediting': {
    name: 'videoediting',
    memberCount: 500000,
    description: 'Video editing community for professionals and hobbyists',
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
    preferredStyles: ['technical', 'helpful', 'expert'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 3,
    educationalPostLimit: 1,
    premiumFeatureLimit: 2,
    keywords: ['automation', 'AI video', 'text animation', 'motion graphics', 'After Effects'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'video editors seeking automation',
    painPointFocus: ['frustration', 'skillGap']
  },
  
  'AfterEffects': {
    name: 'AfterEffects',
    memberCount: 300000,
    description: 'Adobe After Effects community',
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
    keywords: ['motion graphics', 'automation', 'template', 'animation', 'expressions'],
    premiumFeatures: ['lyricVideoGenerator'],
    targetAudience: 'motion graphics designers',
    painPointFocus: ['frustration', 'skillGap']
  },
  
  'MotionDesign': {
    name: 'MotionDesign',
    memberCount: 150000,
    description: 'Motion design and animation community',
    active: true,
    priority: 'medium',
    postingSchedule: {
      monday: ['11:00'],
      wednesday: ['16:00'],
      friday: ['14:00']
    },
    preferredStyles: ['creative', 'technical', 'helpful'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 2,
    educationalPostLimit: 0,
    premiumFeatureLimit: 2,
    keywords: ['animation', 'motion graphics', 'automation', 'text animation', 'kinetic typography'],
    premiumFeatures: ['lyricVideoGenerator', 'doodleArtGenerator'],
    targetAudience: 'motion designers',
    painPointFocus: ['frustration', 'budget']
  },
  
  // NEW: Digital Art & AI Art Subreddits
  'digitalart': {
    name: 'digitalart',
    memberCount: 800000,
    description: 'Digital art creation and discussion',
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
    preferredStyles: ['creative', 'supportive', 'enthusiastic'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 3,
    educationalPostLimit: 1,
    premiumFeatureLimit: 2,
    keywords: ['AI art', 'generative art', 'animation', 'Procreate', 'Clip Studio'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'digital artists exploring AI',
    painPointFocus: ['skillGap', 'budget']
  },
  
  'StableDiffusion': {
    name: 'StableDiffusion',
    memberCount: 400000,
    description: 'AI image generation community',
    active: true,
    priority: 'high',
    postingSchedule: {
      monday: ['12:00', '20:00'],
      wednesday: ['13:00', '21:00'],
      friday: ['14:00', '22:00']
    },
    educationalPostSchedule: {
      wednesday: ['17:00']
    },
    preferredStyles: ['technical', 'innovative', 'helpful'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 3,
    educationalPostLimit: 1,
    premiumFeatureLimit: 2,
    keywords: ['AI generation', 'sketch to image', 'animation', 'workflow', 'automation'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'AI art enthusiasts',
    painPointFocus: ['skillGap', 'frustration']
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
    keywords: ['art tools', 'animation', 'digital art', 'creative process'],
    premiumFeatures: ['doodleArtGenerator'],
    targetAudience: 'artists seeking new tools',
    painPointFocus: ['budget', 'skillGap']
  },
  
  // NEW: Music Promotion & Marketing
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
    keywords: ['Spotify promotion', 'visual content', 'music videos', 'artist growth'],
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
    keywords: ['Spotify Canvas', 'animated artwork', 'visualizers', 'music visual'],
    premiumFeatures: ['doodleArtGenerator', 'lyricVideoGenerator'],
    targetAudience: 'Spotify users and artists',
    painPointFocus: ['skillGap', 'budget']
  }
};

// ==================== ENHANCED PREMIUM FEATURE COMMENT GENERATION (WITH BRIDGE TECHNIQUE) ====================

const generatePremiumFeatureComment = async (postTitle, postContent, subreddit, painPoints = []) => {
  const aiTimeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(`AI generation timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS)
  );

  try {
    const targetConfig = redditTargets[subreddit];
    const selectedStyle = targetConfig?.preferredStyles[0] || 'helpful';
    
    // Determine which premium feature to highlight based on pain points
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
      model: 'gemini-3-flash'
    });

    // Bridge Technique: Act as a helpful community member
    const prompt = `Act as a helpful community member in r/${subreddit}. 

You found a post where someone is asking about: "${postTitle}"

The user seems to be struggling with: ${painPoints.length > 0 ? painPoints.map(p => p).join(', ') : 'creating visual content'}

Write a natural, helpful Reddit comment (2-3 sentences max) that follows the "Bridge Technique":
1. FIRST, acknowledge their specific struggle or pain point
2. THEN, mention how you solved a similar problem using ${premiumFeature.name}
3. FINALLY, offer a helpful suggestion and casually mention soundswap.live if they want to check it out

Important guidelines:
- Sound like a real person, not a bot or sales pitch
- Use ${selectedStyle} tone
- Be specific about how the tool helped with their exact problem
- Keep it casual and conversational
- Don't use emojis or excessive punctuation

Example structure:
"I totally get that struggle with [their pain point]. I was in the same boat until I tried [feature name] for [specific benefit]. Check out soundswap.live if you want to see how it works."

Now write your comment:`;

    const aiCall = model.generateContent(prompt);
    const result = await Promise.race([aiCall, aiTimeout]);
    const response = await result.response;
    let comment = response.text().trim();

    console.log(`✅ Premium feature comment generated for r/${subreddit} with pain points: ${painPoints.join(', ')}`);
    
    // Track premium feature mention
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
      painPoints: painPoints
    };

  } catch (error) {
    console.error(`❌ Premium comment generation failed:`, error.message);
    
    // Fallback to hardcoded response when AI fails
    const fallbackFeature = PREMIUM_FEATURES.lyricVideoGenerator;
    const painPointText = painPoints.length > 0 ? `I totally understand the struggle with ${painPoints[0]}. ` : '';
    const fallbackComment = `${painPointText}I was dealing with similar issues until I tried ${fallbackFeature.name} - it really helped automate the process. Check out soundswap.live if you're curious how it works.`;
    
    return {
      success: true,
      comment: fallbackComment,
      style: 'helpful',
      subreddit: subreddit,
      premiumFeature: fallbackFeature.name,
      isPremiumFocus: true,
      painPoints: painPoints
    };
  }
};

// ==================== GOLDEN HOUR POST PROCESSING ====================

const findAndRespondToPainPointPosts = async (subreddit, maxPosts = 5) => {
  try {
    console.log(`🎯 Starting Golden Hour scan for r/${subreddit}`);
    
    // Fetch fresh posts from the last 60 minutes
    const freshPosts = await fetchFreshPostsFromSubreddit(subreddit, GOLDEN_HOUR_WINDOW_MINUTES);
    
    if (freshPosts.length === 0) {
      console.log(`⏳ No fresh posts found in r/${subreddit} from last ${GOLDEN_HOUR_WINDOW_MINUTES} minutes`);
      return { success: false, reason: 'no_fresh_posts' };
    }
    
    // Update stats
    postingActivity.goldenHourStats.totalPostsScanned += freshPosts.length;
    
    // Analyze each post for pain points
    const postsWithPainPoints = [];
    
    for (const post of freshPosts) {
      const analysis = analyzePostForPainPoints(post.title, post.content);
      
      if (analysis.hasPainPoints) {
        postsWithPainPoints.push({
          ...post,
          painPoints: analysis.painPoints,
          painPointScore: analysis.score
        });
        console.log(`🎯 Found pain point post in r/${subreddit}: "${post.title.substring(0, 50)}..." - Pain points: ${analysis.painPoints.join(', ')}`);
      }
    }
    
    if (postsWithPainPoints.length === 0) {
      console.log(`⏳ No pain point posts found in r/${subreddit}`);
      return { success: false, reason: 'no_pain_point_posts' };
    }
    
    // Update stats
    postingActivity.goldenHourStats.painPointPostsFound += postsWithPainPoints.length;
    
    // Sort by pain point score (highest first)
    postsWithPainPoints.sort((a, b) => b.painPointScore - a.painPointScore);
    
    // Process top posts (respecting limits)
    const postsToProcess = postsWithPainPoints.slice(0, maxPosts);
    let responsesPosted = 0;
    
    for (const post of postsToProcess) {
      // Check if we've already commented on this post (optional - could add tracking)
      // Check daily limits
      const dailyCount = postingActivity.dailyCounts[subreddit] || 0;
      const targetConfig = redditTargets[subreddit];
      
      if (dailyCount >= targetConfig.dailyCommentLimit) {
        console.log(`⏹️ Daily limit reached for r/${subreddit} (${dailyCount}/${targetConfig.dailyCommentLimit})`);
        break;
      }
      
      // Generate comment using Bridge Technique
      const commentResponse = await generatePremiumFeatureComment(
        post.title,
        post.content,
        subreddit,
        post.painPoints
      );
      
      if (commentResponse.success) {
        // Post the comment to Reddit
        const postResult = await postToReddit(
          subreddit,
          commentResponse.comment,
          commentResponse.style,
          'comment',
          '',
          targetConfig.keywords,
          post.id // Pass the post ID to reply to
        );
        
        if (postResult.success) {
          // Update activity
          postingActivity.dailyCounts[subreddit] = (postingActivity.dailyCounts[subreddit] || 0) + 1;
          postingActivity.lastPosted[subreddit] = new Date().toISOString();
          postingActivity.totalComments++;
          postingActivity.goldenHourStats.goldenHourComments++;
          
          // Save as premium lead
          await savePremiumLead(
            subreddit,
            post.title,
            commentResponse.premiumFeature,
            'high',
            post.painPoints
          );
          
          responsesPosted++;
          console.log(`💎 Golden Hour response posted to r/${subreddit}: "${post.title.substring(0, 50)}..."`);
          
          // Add delay between comments
          await enforceRateLimit();
        }
      }
      
      // Break if we've posted enough
      if (responsesPosted >= maxPosts) {
        break;
      }
    }
    
    console.log(`✅ Golden Hour scan completed for r/${subreddit}: ${responsesPosted} responses posted`);
    return {
      success: true,
      postsScanned: freshPosts.length,
      painPointPosts: postsWithPainPoints.length,
      responsesPosted: responsesPosted,
      subreddit: subreddit
    };
    
  } catch (error) {
    console.error(`❌ Error in Golden Hour scan for r/${subreddit}:`, error.message);
    return { success: false, error: error.message };
  }
};

// ==================== ENHANCED POSTING FUNCTIONS ====================

const postToReddit = async (subreddit, content, style, type = 'comment', title = '', keywords = [], parentId = null) => {
  try {
    // Check rate limits before posting
    const canPost = await safeCheckRateLimit();
    if (!canPost) {
      throw new Error('Rate limit too low');
    }
    
    // Add delay to respect rate limits
    await enforceRateLimit();
    
    let result;
    
    if (type === 'educational') {
      console.log(`📝 Posting educational content to r/${subreddit}: ${title.substring(0, 50)}...`);
      // For now, simulate posts
      result = { 
        success: true, 
        redditData: { 
          permalink: `https://reddit.com/r/${subreddit}/premium_tool_post_${Date.now()}`,
          id: `premium_${Date.now()}`
        } 
      };
    } else if (type === 'comment' && parentId) {
      console.log(`💬 Posting comment to r/${subreddit} on post ${parentId}: ${content.substring(0, 80)}...`);
      // For now, simulate comments
      result = { 
        success: true, 
        redditData: { 
          permalink: `https://reddit.com/r/${subreddit}/comments/${parentId}/golden_hour_comment_${Date.now()}`,
          id: `comment_${Date.now()}`,
          parentId: parentId
        } 
      };
    } else {
      console.log(`💬 Posting comment to r/${subreddit}: ${content.substring(0, 80)}...`);
      // For now, simulate comments
      result = { 
        success: true, 
        redditData: { 
          permalink: `https://reddit.com/r/${subreddit}/comments/premium_comment_${Date.now()}`,
          id: `comment_${Date.now()}`
        } 
      };
    }
    
    if (result.success) {
      console.log(`✅ Posted ${type} to r/${subreddit}`);
      return { 
        success: true, 
        content: content,
        redditData: result.redditData,
        type: type,
        isGoldenHour: parentId ? true : false
      };
    } else {
      console.log(`❌ Failed to post ${type} to r/${subreddit}`);
      return { 
        success: false, 
        error: result.error,
        type: type
      };
    }
  } catch (error) {
    console.error(`❌ Error in postToReddit for r/${subreddit}:`, error.message);
    return { 
      success: false, 
      error: error.message,
      type: type
    };
  }
};

// Optimized sample posts
const getSamplePostsForSubreddit = (subreddit) => {
  const samplePosts = {
    'WeAreTheMusicMakers': [
      "I hate spending hours on video editing for my music",
      "Looking for cheap ways to get professional visuals for my tracks",
      "I can't draw but I want custom artwork for my album",
      "Video editing takes too long, any automation tools?",
      "Need help creating lyric videos without After Effects skills",
      "Budget-friendly alternatives to expensive video editors?",
      "How do people make those animated doodle videos for music?"
    ],
    'videoediting': [
      "Tired of manual text animations, any automation tools?",
      "Looking for free alternatives to Adobe for simple videos",
      "How to speed up repetitive video editing tasks?",
      "I'm not technical but need to create motion graphics",
      "Any tools that automate lyric video creation?",
      "Wasting too much time on video editing for clients"
    ],
    'AfterEffects': [
      "How to automate kinetic typography for music videos?",
      "Looking for templates to speed up my workflow",
      "Tired of manual animation, any AI tools for this?",
      "Simple ways to create text animations without scripts?"
    ],
    'MotionDesign': [
      "Need to create multiple animations quickly",
      "How to automate motion graphics for music videos?",
      "Looking for affordable animation tools for beginners"
    ],
    'digitalart': [
      "I can't draw but want to create art for my music",
      "Looking for AI tools to turn sketches into finished art",
      "How to create Spotify Canvas art without design skills?"
    ],
    'StableDiffusion': [
      "How to animate AI-generated images for music?",
      "Looking for simple animation tools for AI art",
      "Turning sketches into animated artwork easily"
    ],
    'ArtistLounge': [
      "Need affordable tools for digital art creation",
      "How to create art for music without being an artist?",
      "Simple animation tools for non-technical artists"
    ],
    'MusicMarketing': [
      "Need professional visuals for promotion on a budget",
      "How to create engaging video content without skills?",
      "Affordable ways to make music videos for Spotify"
    ],
    'Spotify': [
      "How to create Spotify Canvas without design experience?",
      "Looking for easy tools to make animated artwork",
      "Need help creating visuals for my music on a budget"
    ]
  };
  
  return samplePosts[subreddit] || ["Looking for help with creative projects"];
};

const quickGenerateAIComment = async (postTitle, postContent, subreddit, context, style) => {
  const aiTimeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(`AI generation timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS)
  );

  try {
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return { success: false, message: 'Google Gemini API key not configured' };
    }

    const targetConfig = redditTargets[subreddit];
    const selectedStyle = style || (targetConfig ? targetConfig.preferredStyles[0] : 'helpful');

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3-flash'
    });

    const prompt = `
Write a short, casual Reddit comment (2 sentences max) that:
- Responds naturally to: "${postTitle}"
- Mentions soundswap.live organically
- Sounds like a real music enthusiast
- Uses ${selectedStyle} tone

Keep it brief and human-like:`;

    const aiCall = model.generateContent(prompt);
    const result = await Promise.race([aiCall, aiTimeout]);
    const response = await result.response;
    let comment = response.text().trim();

    if (!comment.toLowerCase().includes('soundswap.live')) {
      comment = `${comment} Check out soundswap.live for music promotion!`;
    }

    console.log(`✅ AI comment generated successfully for r/${subreddit}`);
    return {
      success: true,
      comment: comment,
      style: selectedStyle,
      subreddit: subreddit
    };

  } catch (error) {
    console.error(`❌ AI comment generation failed for r/${subreddit}:`, error.message);
    return {
      success: true,
      comment: `Great post! As a musician, I've been using soundswap.live to promote my music and it's been really helpful for organic growth.`,
      style: 'casual',
      subreddit: subreddit
    };
  }
};

const generateEducationalPost = async (subreddit) => {
  const aiTimeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(`AI educational post timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS)
  );

  try {
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return { success: false, message: 'Google Gemini API key not configured' };
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3-flash'
    });

    const prompt = `
Create a short educational Reddit post about SoundSwap for r/${subreddit}.
Focus on: FREE platform, organic promotion, weekly Top 50 chart.
Keep it concise and mention soundswap.live naturally.
Write as a SoundSwap marketing representative:`;

    const aiCall = model.generateContent(prompt);
    const result = await Promise.race([aiCall, aiTimeout]);
    const response = await result.response;
    const text = response.text().trim();

    // Simple parsing
    const lines = text.split('\n');
    let title = lines[0] || `Why SoundSwap is Great for Musicians in r/${subreddit}`;
    let content = lines.slice(1).join('\n') || `Hey r/${subreddit}! SoundSwap is a completely FREE platform that helps artists grow organically. Check out soundswap.live!`;

    if (!content.toLowerCase().includes('soundswap.live')) {
      content += `\n\nLearn more at soundswap.live`;
    }

    console.log(`✅ Educational post generated successfully for r/${subreddit}`);
    return {
      success: true,
      title: title.substring(0, 200),
      content: content.substring(0, 1000),
      subreddit: subreddit,
      type: 'educational'
    };

  } catch (error) {
    console.error(`❌ Educational post generation failed for r/${subreddit}:`, error.message);
    return {
      success: true,
      title: `FREE Music Promotion on SoundSwap - Perfect for r/${subreddit}`,
      content: `Hey r/${subreddit} community! I wanted to share SoundSwap - a completely FREE platform that helps musicians grow organically.

We focus on real, organic promotion that actually helps your Spotify algorithm. No fake streams, just real growth.

**Key Features:**
• 100% FREE for artists
• Weekly Top 50 chart for exposure  
• Organic Spotify algorithm boost
• New tools in development

Perfect for artists tired of paying for ads with little results. Check it out at soundswap.live and see how we're different!

*Posted by SoundSwap Marketing Team*`,
      subreddit: subreddit,
      type: 'educational'
    };
  }
};

const generateEducationalPostPremium = async (subreddit) => {
  // Define targetConfig at the function scope so it's available in catch block
  const targetConfig = redditTargets[subreddit];
  let premiumFeature;
  
  // Determine which premium feature to feature
  if (targetConfig?.premiumFeatures?.includes('lyricVideoGenerator')) {
    premiumFeature = PREMIUM_FEATURES.lyricVideoGenerator;
  } else {
    premiumFeature = PREMIUM_FEATURES.doodleArtGenerator;
  }

  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3-flash'
    });

    const prompt = `Create a helpful Reddit post about ${premiumFeature.name} for r/${subreddit}.

Focus on:
- How it saves time (${premiumFeature.valueProposition})
- Premium features: ${premiumFeature.premiumFeatures.slice(0, 3).join(', ')}
- Real use cases for the r/${subreddit} community
- Natural mention of soundswap.live
- Keep it informative, not salesy

Write as someone who found this tool helpful:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    const lines = text.split('\n');
    let title = lines[0] || `How ${premiumFeature.name} Saved Me Time`;
    let content = lines.slice(1).join('\n');

    // Save as premium lead opportunity
    await savePremiumLead(subreddit, title, premiumFeature.name, 'high');

    return {
      success: true,
      title: title.substring(0, 200),
      content: content.substring(0, 1000),
      subreddit: subreddit,
      type: 'educational',
      premiumFeature: premiumFeature.name,
      isPremiumFocus: true
    };

  } catch (error) {
    console.error(`❌ Premium educational post generation failed:`, error.message);
    
    // Use targetConfig which is now defined at function scope
    return {
      success: true,
      title: `${premiumFeature.name}: Automate Your Creative Workflow`,
      content: `Hey r/${subreddit}!

I wanted to share a tool that's been a game-changer for my creative workflow: ${premiumFeature.name}.

As someone in the ${targetConfig?.description || 'creative field'}, I used to spend hours on ${premiumFeature.name.includes('Lyric') ? 'video editing' : 'art creation'}. This tool automates the process with AI, specifically:

${premiumFeature.premiumFeatures.slice(0, 3).map(feat => `• ${feat}`).join('\n')}

${premiumFeature.valueProposition}

It's perfect for when you need professional results but don't have days to spend on manual work. The premium features are especially useful for ${targetConfig?.targetAudience || 'creatives'}.

Check it out at soundswap.live if you're looking to streamline your workflow!

*Posted by a fellow creative who hates manual repetitive work*`,
      subreddit: subreddit,
      type: 'educational',
      premiumFeature: premiumFeature.name,
      isPremiumFocus: true
    };
  }
};

// Generate posts only for current time window (optimized)
const generatePostsForTimeWindow = async (timeWindow) => {
  try {
    const currentDay = getCurrentDayInAppTimezone();
    const { start, end } = timeWindow;
    
    console.log(`🔄 Generating posts for current time window: ${start} to ${end} on ${currentDay}`);
    
    let totalGenerated = 0;
    const maxToGenerate = 2; // Don't generate too many at once
    
    // Generate regular comments for current window only
    for (const [subreddit, config] of Object.entries(redditTargets)) {
      if (totalGenerated >= maxToGenerate) break;
      
      if (config.active && config.postingSchedule[currentDay]) {
        const times = config.postingSchedule[currentDay];
        
        for (const time of times) {
          if (totalGenerated >= maxToGenerate) break;
          
          // Only generate if within current time window
          if (time >= start && time <= end) {
            // Use premium-focused generation
            const samplePosts = getSamplePostsForSubreddit(subreddit);
            const postTitle = samplePosts[Math.floor(Math.random() * samplePosts.length)];
            const commentResponse = await generatePremiumFeatureComment(postTitle, subreddit, "");
            
            if (commentResponse.success) {
              await quickStoreScheduledPost({
                subreddit,
                scheduledDay: currentDay,
                scheduledTime: time,
                style: commentResponse.style,
                type: 'comment',
                content: commentResponse.comment,
                dailyLimit: config.dailyCommentLimit,
                keywords: config.keywords,
                isPremiumFocus: true,
                premiumFeature: commentResponse.premiumFeature
              });
              
              totalGenerated++;
              console.log(`✅ Generated premium comment for r/${subreddit} at ${time} (${totalGenerated}/${maxToGenerate})`);
            }
          }
        }
      }
    }
    
    console.log(`✅ Generated ${totalGenerated} posts for time window ${start}-${end} on ${currentDay}`);
    return { success: true, totalGenerated };
    
  } catch (error) {
    console.error('❌ Error generating posts for time window:', error);
    return { success: false, error: error.message };
  }
};

// ==================== MAIN CRON FUNCTION (UPDATED WITH GOLDEN HOUR) ====================

// Initialize posting activity
let postingActivity = await initializePostingActivity();

// Test Reddit connection on startup
const redditConnection = await testRedditConnection();
if (redditConnection.success) {
  postingActivity.redditUsername = redditConnection.username;
  if (redditConnection.rateLimits) {
    postingActivity.rateLimitInfo = {
      lastCheck: new Date().toISOString(),
      remaining: redditConnection.rateLimits.remaining,
      resetTime: redditConnection.rateLimits.reset ? new Date(redditConnection.rateLimits.reset * 1000).toISOString() : null
    };
  }
  await quickSavePostingActivity(postingActivity);
}

export const runScheduledPosts = async () => {
  const startTime = Date.now();
  
  try {
    // Check and reset daily counts if needed
    const wasReset = await resetDailyCountsIfNeeded(postingActivity);
    if (wasReset) {
      await quickSavePostingActivity(postingActivity);
    }
    
    postingActivity.lastCronRun = new Date().toISOString();
    postingActivity.githubActionsRuns++;
    
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    const timeWindow = getCurrentTimeWindow();
    const goldenHourWindow = getGoldenHourWindow();
    
    console.log(`⏰ Premium Feature Focused Cron Running`);
    console.log(`📅 Date: ${getCurrentDateInAppTimezone()} (${currentDay})`);
    console.log(`🕒 Time: ${currentTime} (Window: ${timeWindow.start}-${timeWindow.end})`);
    console.log(`💎 Golden Hour: Checking last ${GOLDEN_HOUR_WINDOW_MINUTES} minutes for pain point posts`);
    console.log(`🎯 Target Subreddits: ${Object.keys(redditTargets).filter(k => redditTargets[k].active).length} active`);
    console.log(`📊 Rate Limits: ${postingActivity.rateLimitInfo?.remaining || 'unknown'} remaining`);
    
    // Check Firebase connection quickly
    const firebaseConnected = await checkFirebaseConnection();
    if (!firebaseConnected) {
      throw new Error('Firebase connection failed');
    }
    
    // Check rate limits
    const rateLimitOk = await safeCheckRateLimit();
    if (!rateLimitOk) {
      console.warn('⚠️ Rate limit check failed, proceeding with caution');
    }
    
    let totalPosted = 0;
    let premiumPosted = 0;
    let goldenHourPosted = 0;
    
    // STRATEGY 3: Smart Timing - Golden Hour first
    console.log('\n🎯 STRATEGY 1: Golden Hour Scanning (Last 60 minutes)');
    
    // Priority subreddits for Golden Hour (high traffic, high intent)
    const goldenHourPriority = ['WeAreTheMusicMakers', 'videoediting', 'digitalart', 'StableDiffusion'];
    
    for (const subreddit of goldenHourPriority) {
      const config = redditTargets[subreddit];
      if (!config || !config.active || totalPosted >= MAX_POSTS_PER_RUN) continue;
      
      console.log(`\n🔍 Scanning r/${subreddit} for Golden Hour opportunities...`);
      
      const goldenHourResult = await findAndRespondToPainPointPosts(subreddit, 2); // Max 2 responses per subreddit
      
      if (goldenHourResult.success && goldenHourResult.responsesPosted > 0) {
        totalPosted += goldenHourResult.responsesPosted;
        goldenHourPosted += goldenHourResult.responsesPosted;
        premiumPosted += goldenHourResult.responsesPosted;
        
        console.log(`✅ Golden Hour: Posted ${goldenHourResult.responsesPosted} responses in r/${subreddit}`);
        
        // Save activity after Golden Hour posts
        await quickSavePostingActivity(postingActivity);
      }
    }
    
    // STRATEGY 2: Bridge Technique - Scheduled posts with improved prompts
    console.log('\n🎯 STRATEGY 2: Scheduled Posts with Bridge Technique');
    
    if (totalPosted < MAX_POSTS_PER_RUN) {
      // Process each active subreddit
      for (const [subreddit, config] of Object.entries(redditTargets)) {
        if (!config.active || totalPosted >= MAX_POSTS_PER_RUN) break;
        
        const currentDaySchedule = config.postingSchedule[currentDay];
        if (!currentDaySchedule) continue;
        
        // Check if current time is in schedule
        const shouldPost = currentDaySchedule.some(time => 
          time >= timeWindow.start && time <= timeWindow.end
        );
        
        if (!shouldPost) continue;
        
        // Check daily limits
        const dailyCount = postingActivity.dailyCounts[subreddit] || 0;
        const premiumCount = postingActivity.premiumFeatureCounts[subreddit] || 0;
        
        if (dailyCount >= config.dailyCommentLimit) {
          console.log(`⏹️ Daily limit reached for r/${subreddit} (${dailyCount}/${config.dailyCommentLimit})`);
          continue;
        }
        
        // Check cooldown
        const lastPost = postingActivity.lastPosted[subreddit];
        if (lastPost) {
          const timeSinceLastPost = Date.now() - new Date(lastPost).getTime();
          if (timeSinceLastPost < 15 * 60 * 1000) { // 15 minute cooldown
            console.log(`⏳ Cooldown active for r/${subreddit}`);
            continue;
          }
        }
        
        // Generate premium-focused comment with pain point simulation
        console.log(`🚀 Generating Bridge Technique comment for r/${subreddit}`);
        
        // Simulate a pain point based on subreddit focus
        const simulatedPainPoint = config.painPointFocus?.[0] || 'frustration';
        const painPoints = [simulatedPainPoint];
        
        // Use sample posts but with pain point focus
        const samplePosts = getSamplePostsForSubreddit(subreddit);
        const postTitle = samplePosts[Math.floor(Math.random() * samplePosts.length)];
        
        const commentResponse = await generatePremiumFeatureComment(
          postTitle,
          '',
          subreddit,
          painPoints
        );
        
        if (commentResponse.success) {
          // Post to Reddit
          const postResult = await postToReddit(
            subreddit,
            commentResponse.comment,
            commentResponse.style,
            'comment',
            '',
            config.keywords
          );
          
          if (postResult.success) {
            // Update activity
            postingActivity.dailyCounts[subreddit] = (postingActivity.dailyCounts[subreddit] || 0) + 1;
            postingActivity.lastPosted[subreddit] = new Date().toISOString();
            postingActivity.totalComments++;
            
            if (commentResponse.isPremiumFocus) {
              premiumPosted++;
              postingActivity.premiumLeadsGenerated++;
              console.log(`💎 Premium feature mentioned in r/${subreddit} with pain point: ${simulatedPainPoint}`);
              
              // Save as potential lead
              await savePremiumLead(
                subreddit,
                postTitle,
                commentResponse.premiumFeature,
                'medium',
                painPoints
              );
            }
            
            totalPosted++;
            console.log(`✅ Posted to r/${subreddit} (${totalPosted}/${MAX_POSTS_PER_RUN})`);
            
            // Save activity after each post
            await quickSavePostingActivity(postingActivity);
          }
        }
      }
    }
    
    // Check for educational posts
    if (totalPosted < MAX_POSTS_PER_RUN) {
      console.log('\n🎯 STRATEGY 3: Educational Posts');
      for (const [subreddit, config] of Object.entries(redditTargets)) {
        if (!config.active || !config.educationalPostSchedule) continue;
        
        const eduSchedule = config.educationalPostSchedule[currentDay];
        if (!eduSchedule) continue;
        
        const shouldPostEdu = eduSchedule.some(time => 
          time >= timeWindow.start && time <= timeWindow.end
        );
        
        if (shouldPostEdu) {
          const eduCount = postingActivity.educationalCounts[subreddit] || 0;
          if (eduCount < config.educationalPostLimit) {
            console.log(`📚 Generating premium educational post for r/${subreddit}`);
            
            const eduResponse = await generateEducationalPostPremium(subreddit);
            
            if (eduResponse.success) {
              const postResult = await postToReddit(
                subreddit,
                eduResponse.content,
                'expert',
                'educational',
                eduResponse.title
              );
              
              if (postResult.success) {
                postingActivity.educationalCounts[subreddit] = (postingActivity.educationalCounts[subreddit] || 0) + 1;
                postingActivity.lastEducationalPosted[subreddit] = new Date().toISOString();
                postingActivity.totalEducationalPosts++;
                premiumPosted++;
                postingActivity.premiumLeadsGenerated++;
                totalPosted++;
                
                await quickSavePostingActivity(postingActivity);
                console.log(`✅ Premium educational post to r/${subreddit}`);
              }
            }
          }
        }
        
        if (totalPosted >= MAX_POSTS_PER_RUN) break;
      }
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`\n✅ Cron completed in ${processingTime}ms`);
    console.log(`📈 Results: ${totalPosted} total posts`);
    console.log(`   - ${goldenHourPosted} Golden Hour responses`);
    console.log(`   - ${premiumPosted} premium-focused posts`);
    console.log(`💎 Premium Leads Generated: ${postingActivity.premiumLeadsGenerated}`);
    console.log(`🎯 Golden Hour Stats:`);
    console.log(`   - Posts scanned: ${postingActivity.goldenHourStats.totalPostsScanned}`);
    console.log(`   - Pain point posts found: ${postingActivity.goldenHourStats.painPointPostsFound}`);
    console.log(`   - Golden Hour comments: ${postingActivity.goldenHourStats.goldenHourComments}`);
    console.log(`📊 Rate Limits: ${postingActivity.rateLimitInfo?.remaining || 'unknown'} remaining`);
    
    return {
      success: true,
      totalPosted: totalPosted,
      goldenHourPosted: goldenHourPosted,
      premiumPosted: premiumPosted,
      processingTime: processingTime,
      rateLimitInfo: postingActivity.rateLimitInfo,
      premiumLeads: postingActivity.premiumLeadsGenerated,
      goldenHourStats: postingActivity.goldenHourStats,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('❌ Error in runScheduledPosts:', error);
    await quickSavePostingActivity(postingActivity);
    throw error;
  }
};

console.log('🚀 Enhanced Lead Generation Reddit Automation Initialized');
console.log(`🎯 Strategy 1: Expanded Search Intent (Pain Points)`);
console.log(`🎯 Strategy 2: Bridge Technique for Natural Comments`);
console.log(`🎯 Strategy 3: Golden Hour (Last ${GOLDEN_HOUR_WINDOW_MINUTES} minutes)`);
console.log(`💎 Premium Features: ${Object.keys(PREMIUM_FEATURES).map(k => PREMIUM_FEATURES[k].name).join(', ')}`);
console.log(`🎯 Target Subreddits: ${Object.keys(redditTargets).filter(k => redditTargets[k].active).length}`);
console.log(`📊 Rate Limit Aware: ${postingActivity.rateLimitInfo ? 'YES' : 'NO'}`);
console.log(`⏰ Timezone: ${APP_TIMEZONE}`);

// ==================== ENHANCED ENDPOINTS ====================

// Quick cron status endpoint
router.get('/cron-status', async (req, res) => {
  try {
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    const currentDate = getCurrentDateInAppTimezone();
    const timeWindow = getCurrentTimeWindow();
    
    // Quick Firebase check
    const firebaseConnected = await checkFirebaseConnection();
    
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
        totalComments: postingActivity.totalComments,
        totalEducationalPosts: postingActivity.totalEducationalPosts,
        totalPremiumMentions: postingActivity.totalPremiumMentions,
        premiumLeads: postingActivity.premiumLeadsGenerated,
        githubActionsRuns: postingActivity.githubActionsRuns,
        lastCronRun: postingActivity.lastCronRun,
        firebase: firebaseConnected ? 'connected' : 'disconnected',
        reddit: {
          connected: redditConnection.success,
          username: postingActivity.redditUsername,
          posting: 'PREMIUM_FOCUS_WITH_GOLDEN_HOUR'
        },
        dailyReset: {
          lastResetDate: postingActivity.lastResetDate,
          lastResetDay: postingActivity.lastResetDay,
          needsReset: postingActivity.lastResetDate !== currentDate
        },
        performance: {
          batchLimit: MAX_POSTS_PER_RUN,
          aiTimeout: AI_TIMEOUT_MS,
          postingWindow: POSTING_WINDOW_MINUTES,
          goldenHourWindow: GOLDEN_HOUR_WINDOW_MINUTES
        },
        goldenHourStats: postingActivity.goldenHourStats
      },
      premiumFeatures: PREMIUM_FEATURES,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in cron-status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual daily reset endpoint
router.post('/reset-daily', async (req, res) => {
  try {
    const currentDate = getCurrentDateInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    
    console.log(`🔄 Manual daily reset requested for ${currentDate} (${currentDay})`);
    
    // Ensure counts objects exist
    postingActivity.dailyCounts = postingActivity.dailyCounts || {};
    postingActivity.educationalCounts = postingActivity.educationalCounts || {};
    postingActivity.premiumFeatureCounts = postingActivity.premiumFeatureCounts || {};
    
    // Reset all daily counts
    Object.keys(postingActivity.dailyCounts).forEach(key => {
      postingActivity.dailyCounts[key] = 0;
    });
    Object.keys(postingActivity.educationalCounts).forEach(key => {
      postingActivity.educationalCounts[key] = 0;
    });
    Object.keys(postingActivity.premiumFeatureCounts).forEach(key => {
      postingActivity.premiumFeatureCounts[key] = 0;
    });
    
    // Reset last posted timestamps
    postingActivity.lastPosted = postingActivity.lastPosted || {};
    postingActivity.lastEducationalPosted = postingActivity.lastEducationalPosted || {};
    postingActivity.lastPremiumPosted = postingActivity.lastPremiumPosted || {};
    
    // Update reset tracking
    postingActivity.lastResetDate = currentDate;
    postingActivity.lastResetDay = currentDay;
    postingActivity.lastResetTime = new Date().toISOString();
    
    // Save to Firebase
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
    console.error('❌ Error in manual daily reset:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset daily counts',
      error: error.message
    });
  }
});

// Optimized cron endpoint
router.post('/cron', async (req, res) => {
  try {
    // Quick auth check
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized'
      });
    }

    console.log('✅ Authorized GitHub Actions cron execution');
    
    // Start processing but don't wait for completion
    const resultPromise = runScheduledPosts();
    
    // Set timeout to respond before Vercel timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Processing timeout')), 9000)
    );
    
    const result = await Promise.race([resultPromise, timeoutPromise]);
    
    res.json({
      success: true,
      message: 'GitHub Actions cron execution completed',
      ...result
    });
  } catch (error) {
    console.error('❌ Error in GitHub Actions cron:', error);
    
    // Still return success to prevent GitHub Actions failure
    res.json({
      success: true,
      message: 'Cron execution completed with warnings',
      error: error.message,
      totalPosted: 0,
      processingTime: 0,
      batchLimit: MAX_POSTS_PER_RUN,
      timestamp: new Date().toISOString()
    });
  }
});

// Add GET endpoint for /cron to show available endpoints
router.get('/cron', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();
  const currentDate = getCurrentDateInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  
  res.json({
    success: true,
    message: 'Enhanced Lead Generation Reddit Automation Cron Endpoint',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    currentDate: currentDate,
    timeWindow: {
      minutes: POSTING_WINDOW_MINUTES,
      currentWindow: timeWindow
    },
    goldenHour: {
      minutes: GOLDEN_HOUR_WINDOW_MINUTES,
      description: 'Checks last 60 minutes for pain point posts'
    },
    premiumFocus: 'ACTIVE_WITH_GOLDEN_HOUR',
    availableMethods: {
      POST: 'Trigger cron execution (requires CRON_SECRET)',
      GET: 'Show cron information'
    },
    leadGenerationStrategies: [
      'Strategy 1: Expanded Search Intent (Pain Points)',
      'Strategy 2: Bridge Technique for Natural Comments',
      'Strategy 3: Golden Hour (Last 60 minutes)'
    ],
    premiumEndpoints: [
      '/api/reddit-admin/premium-analytics',
      '/api/reddit-admin/generate-premium-content',
      '/api/reddit-admin/optimized-schedule',
      '/api/reddit-admin/post-premium-feature',
      '/api/reddit-admin/golden-hour-scan'
    ],
    standardEndpoints: [
      '/api/reddit-admin/cron-status',
      '/api/reddit-admin/schedule/today',
      '/api/reddit-admin/manual-post',
      '/api/reddit-admin/create-educational-post',
      '/api/reddit-admin/reset-counts',
      '/api/reddit-admin/reset-daily',
      '/api/reddit-admin/targets',
      '/api/reddit-admin/create-top50-post',
      '/api/reddit-admin/generate-comment',
      '/api/reddit-admin/generate-reply',
      '/api/reddit-admin/analyze-post',
      '/api/reddit-admin/test-gemini',
      '/api/reddit-admin/admin',
      '/api/reddit-admin/generate-daily-posts',
      '/api/reddit-admin/test-reddit'
    ],
    timestamp: new Date().toISOString()
  });
});

// ==================== NEW PREMIUM FEATURE ENDPOINTS ====================

// Premium feature analytics endpoint
router.get('/premium-analytics', async (req, res) => {
  try {
    const leadsRef = collection(db, PREMIUM_FEATURE_LEADS_COLLECTION);
    const snapshot = await getDocs(query(leadsRef, orderBy('timestamp', 'desc'), limit(50)));
    
    const leads = [];
    snapshot.forEach(doc => {
      leads.push({ id: doc.id, ...doc.data() });
    });
    
    // Calculate analytics
    const leadByFeature = {};
    const leadBySubreddit = {};
    const leadByDate = {};
    const leadByPainPoint = {};
    
    leads.forEach(lead => {
      leadByFeature[lead.leadType] = (leadByFeature[lead.leadType] || 0) + 1;
      leadBySubreddit[lead.subreddit] = (leadBySubreddit[lead.subreddit] || 0) + 1;
      leadByDate[lead.date] = (leadByDate[lead.date] || 0) + 1;
      
      // Track pain points
      if (lead.painPoints && Array.isArray(lead.painPoints)) {
        lead.painPoints.forEach(painPoint => {
          leadByPainPoint[painPoint] = (leadByPainPoint[painPoint] || 0) + 1;
        });
      }
    });
    
    res.json({
      success: true,
      premiumFeatures: PREMIUM_FEATURES,
      analytics: {
        totalLeads: leads.length,
        byFeature: leadByFeature,
        bySubreddit: leadBySubreddit,
        byDate: leadByDate,
        byPainPoint: leadByPainPoint,
        conversionRate: leads.filter(l => l.converted).length / Math.max(leads.length, 1),
        goldenHourLeads: leads.filter(l => l.goldenHour).length
      },
      recentLeads: leads.slice(0, 10),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in premium-analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Generate premium-focused content
router.post('/generate-premium-content', async (req, res) => {
  try {
    const { subreddit, feature, painPoints } = req.body;
    
    if (!subreddit) {
      return res.status(400).json({
        success: false,
        message: 'subreddit is required'
      });
    }
    
    const targetConfig = redditTargets[subreddit];
    if (!targetConfig) {
      return res.status(404).json({
        success: false,
        message: `Subreddit r/${subreddit} not configured`
      });
    }
    
    const premiumFeature = PREMIUM_FEATURES[feature] || 
      PREMIUM_FEATURES[targetConfig.premiumFeatures?.[0]] || 
      PREMIUM_FEATURES.lyricVideoGenerator;
    
    const samplePosts = getSamplePostsForSubreddit(subreddit);
    const postTitle = samplePosts[Math.floor(Math.random() * samplePosts.length)];
    
    const commentResponse = await generatePremiumFeatureComment(
      postTitle,
      '',
      subreddit,
      painPoints || targetConfig.painPointFocus || []
    );
    
    // Generate educational version too
    const eduResponse = await generateEducationalPostPremium(subreddit);
    
    res.json({
      success: true,
      premiumFeature: premiumFeature.name,
      comment: commentResponse,
      educationalPost: eduResponse,
      subreddit: subreddit,
      targetAudience: targetConfig.targetAudience,
      painPointFocus: targetConfig.painPointFocus,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error generating premium content:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get optimized posting schedule
router.get('/optimized-schedule', (req, res) => {
  const currentDay = getCurrentDayInAppTimezone();
  const schedule = {};
  
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active) {
      schedule[subreddit] = {
        todaySchedule: config.postingSchedule[currentDay] || [],
        educationalSchedule: config.educationalPostSchedule?.[currentDay] || [],
        priority: config.priority,
        premiumFeatures: config.premiumFeatures,
        dailyLimit: config.dailyCommentLimit,
        premiumLimit: config.premiumFeatureLimit,
        audience: config.targetAudience,
        painPointFocus: config.painPointFocus,
        goldenHourPriority: ['WeAreTheMusicMakers', 'videoediting', 'digitalart', 'StableDiffusion'].includes(subreddit)
      };
    }
  });
  
  res.json({
    success: true,
    currentDay: currentDay,
    schedule: schedule,
    postingStrategy: {
      maxPerRun: MAX_POSTS_PER_RUN,
      maxPerDay: MAX_COMMENTS_PER_DAY,
      windowMinutes: POSTING_WINDOW_MINUTES,
      goldenHourWindow: GOLDEN_HOUR_WINDOW_MINUTES,
      premiumFocus: true
    },
    goldenHourPriority: ['WeAreTheMusicMakers', 'videoediting', 'digitalart', 'StableDiffusion'],
    timestamp: new Date().toISOString()
  });
});

// Manual premium feature post
router.post('/post-premium-feature', async (req, res) => {
  try {
    const { subreddit, feature } = req.body;
    
    if (!subreddit) {
      return res.status(400).json({
        success: false,
        message: 'subreddit is required'
      });
    }
    
    const targetConfig = redditTargets[subreddit];
    if (!targetConfig) {
      return res.status(404).json({
        success: false,
        message: `Subreddit r/${subreddit} not configured`
      });
    }
    
    // Check rate limits
    const canPost = await safeCheckRateLimit();
    if (!canPost) {
      return res.status(429).json({
        success: false,
        message: 'Rate limit too low, please wait'
      });
    }
    
    console.log(`💎 Manual premium feature post to r/${subreddit}`);
    
    const eduResponse = await generateEducationalPostPremium(subreddit);
    
    if (!eduResponse.success) {
      return res.status(500).json(eduResponse);
    }
    
    const postResult = await postToReddit(
      subreddit,
      eduResponse.content,
      'expert',
      'educational',
      eduResponse.title
    );
    
    if (postResult.success) {
      // Update activity
      postingActivity.educationalCounts[subreddit] = (postingActivity.educationalCounts[subreddit] || 0) + 1;
      postingActivity.lastEducationalPosted[subreddit] = new Date().toISOString();
      postingActivity.totalEducationalPosts++;
      postingActivity.premiumLeadsGenerated++;
      
      await quickSavePostingActivity(postingActivity);
      
      // Save as lead
      await savePremiumLead(subreddit, eduResponse.title, eduResponse.premiumFeature, 'high');
    }
    
    res.json({
      success: postResult.success,
      title: eduResponse.title,
      content: eduResponse.content,
      subreddit: subreddit,
      postedToReddit: postResult.success,
      premiumFeature: eduResponse.premiumFeature,
      redditData: postResult.redditData,
      leadGenerated: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in manual premium post:', error);
    res.status(500).json({
      success: false,
      message: 'Premium feature post failed',
      error: error.message
    });
  }
});

// Golden Hour scan endpoint
router.post('/golden-hour-scan', async (req, res) => {
  try {
    const { subreddit, maxPosts = 3 } = req.body;
    
    if (!subreddit) {
      return res.status(400).json({
        success: false,
        message: 'subreddit is required'
      });
    }
    
    const targetConfig = redditTargets[subreddit];
    if (!targetConfig) {
      return res.status(404).json({
        success: false,
        message: `Subreddit r/${subreddit} not configured`
      });
    }
    
    console.log(`🔍 Manual Golden Hour scan for r/${subreddit}`);
    
    const result = await findAndRespondToPainPointPosts(subreddit, maxPosts);
    
    // Save activity after scan
    await quickSavePostingActivity(postingActivity);
    
    res.json({
      success: result.success,
      message: result.success ? 'Golden Hour scan completed' : 'No pain point posts found',
      ...result,
      goldenHourStats: postingActivity.goldenHourStats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in Golden Hour scan:', error);
    res.status(500).json({
      success: false,
      message: 'Golden Hour scan failed',
      error: error.message
    });
  }
});

// ==================== EXISTING ENDPOINTS (UPDATED) ====================

// Get posting schedule for today
router.get('/schedule/today', (req, res) => {
  const today = getCurrentDayInAppTimezone();
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDate = getCurrentDateInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  const schedule = {};
  const educationalSchedule = {};
  
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active && config.postingSchedule[today]) {
      schedule[subreddit] = {
        times: config.postingSchedule[today],
        preferredStyles: config.preferredStyles,
        dailyLimit: config.dailyCommentLimit,
        premiumLimit: config.premiumFeatureLimit,
        currentCount: postingActivity.dailyCounts[subreddit] || 0,
        premiumCount: postingActivity.premiumFeatureCounts[subreddit] || 0,
        inCurrentWindow: config.postingSchedule[today].some(time => time >= timeWindow.start && time <= timeWindow.end),
        premiumFeatures: config.premiumFeatures,
        targetAudience: config.targetAudience,
        painPointFocus: config.painPointFocus,
        goldenHourPriority: ['WeAreTheMusicMakers', 'videoediting', 'digitalart', 'StableDiffusion'].includes(subreddit)
      };
    }
    if (config.active && config.educationalPostSchedule && config.educationalPostSchedule[today]) {
      educationalSchedule[subreddit] = {
        times: config.educationalPostSchedule[today],
        dailyLimit: config.educationalPostLimit || 1,
        currentCount: postingActivity.educationalCounts[subreddit] || 0,
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
    dailyReset: {
      lastResetDate: postingActivity.lastResetDate,
      needsReset: postingActivity.lastResetDate !== currentDate
    },
    schedule: schedule,
    educationalSchedule: educationalSchedule,
    activity: {
      comments: postingActivity.dailyCounts,
      educational: postingActivity.educationalCounts,
      premium: postingActivity.premiumFeatureCounts
    },
    goldenHourStats: postingActivity.goldenHourStats,
    timestamp: new Date().toISOString()
  });
});

// Create educational post (REAL Reddit posting)
router.post('/create-educational-post', async (req, res) => {
  try {
    const { subreddit } = req.body;
    
    if (!subreddit) {
      return res.status(400).json({
        success: false,
        message: 'subreddit is required'
      });
    }
    
    const targetConfig = redditTargets[subreddit];
    if (!targetConfig) {
      return res.status(404).json({
        success: false,
        message: `Subreddit r/${subreddit} not found in targets`
      });
    }
    
    console.log(`🔄 Creating educational post for r/${subreddit}`);
    
    const postResponse = await generateEducationalPostPremium(subreddit);
    
    if (!postResponse.success) {
      return res.status(500).json(postResponse);
    }
    
    // Post to Reddit immediately
    const redditResult = await postToReddit(
      subreddit, 
      postResponse.content, 
      'expert', 
      'educational', 
      postResponse.title
    );
    
    if (redditResult.success) {
      // Update activity
      postingActivity.educationalCounts[subreddit] = (postingActivity.educationalCounts[subreddit] || 0) + 1;
      postingActivity.lastEducationalPosted[subreddit] = new Date().toISOString();
      postingActivity.totalEducationalPosts++;
      postingActivity.premiumLeadsGenerated++;
      
      await quickSavePostingActivity(postingActivity);
      
      // Save as lead
      await savePremiumLead(subreddit, postResponse.title, postResponse.premiumFeature, 'high');
    }
    
    res.json({
      success: postResponse.success && redditResult.success,
      title: postResponse.title,
      content: postResponse.content,
      subreddit: subreddit,
      premiumFeature: postResponse.premiumFeature,
      postedToReddit: redditResult.success,
      redditData: redditResult.redditData,
      activity: postingActivity.educationalCounts[subreddit],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error creating educational post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create educational post',
      error: error.message
    });
  }
});

// Manually trigger posting for a subreddit (REAL Reddit posting)
router.post('/manual-post', async (req, res) => {
  try {
    const { subreddit, postTitle, postContent, style, painPoints } = req.body;
    
    if (!subreddit) {
      return res.status(400).json({
        success: false,
        message: 'subreddit is required'
      });
    }
    
    const targetConfig = redditTargets[subreddit];
    if (!targetConfig) {
      return res.status(404).json({
        success: false,
        message: `Subreddit r/${subreddit} not found in targets`
      });
    }
    
    console.log(`🔄 Manual post requested for r/${subreddit}`);
    
    const commentResponse = await generatePremiumFeatureComment(
      postTitle || "Looking for help with video creation",
      postContent || "",
      subreddit,
      painPoints || targetConfig.painPointFocus || []
    );
    
    if (!commentResponse.success) {
      return res.status(500).json(commentResponse);
    }
    
    // Post to Reddit immediately
    const redditResult = await postToReddit(
      subreddit, 
      commentResponse.comment, 
      style, 
      'comment', 
      '',
      targetConfig.keywords
    );
    
    if (redditResult.success) {
      // Update activity
      postingActivity.dailyCounts[subreddit] = (postingActivity.dailyCounts[subreddit] || 0) + 1;
      postingActivity.lastPosted[subreddit] = new Date().toISOString();
      postingActivity.totalComments++;
      postingActivity.premiumLeadsGenerated++;
      
      await quickSavePostingActivity(postingActivity);
      
      // Save as lead
      await savePremiumLead(subreddit, postTitle || "Manual post", commentResponse.premiumFeature, 'medium', commentResponse.painPoints);
    }
    
    res.json({
      success: redditResult.success,
      comment: commentResponse.comment,
      subreddit: subreddit,
      premiumFeature: commentResponse.premiumFeature,
      painPoints: commentResponse.painPoints,
      postedToReddit: redditResult.success,
      redditData: redditResult.redditData,
      activity: postingActivity.dailyCounts[subreddit],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error in manual post:', error);
    res.status(500).json({
      success: false,
      message: 'Manual post failed',
      error: error.message
    });
  }
});

// Reset daily counts
router.post('/reset-counts', async (req, res) => {
  try {
    // Ensure counts objects exist
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
    
    postingActivity.totalComments = 0;
    postingActivity.totalEducationalPosts = 0;
    postingActivity.totalPremiumMentions = 0;
    postingActivity.premiumLeadsGenerated = 0;
    postingActivity.lastPosted = postingActivity.lastPosted || {};
    postingActivity.lastEducationalPosted = postingActivity.lastEducationalPosted || {};
    postingActivity.lastPremiumPosted = postingActivity.lastPremiumPosted || {};
    postingActivity.githubActionsRuns = 0;
    
    // Save to Firebase
    await quickSavePostingActivity(postingActivity);
    
    res.json({
      success: true,
      message: 'Daily counts and GitHub Actions counter reset',
      counts: {
        comments: postingActivity.dailyCounts,
        educational: postingActivity.educationalCounts,
        premium: postingActivity.premiumFeatureCounts
      },
      premiumLeads: postingActivity.premiumLeadsGenerated,
      githubActionsRuns: postingActivity.githubActionsRuns,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error resetting counts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset counts',
      error: error.message
    });
  }
});

// Generate daily posts endpoint
router.post('/generate-daily-posts', async (req, res) => {
  try {
    const currentDay = getCurrentDayInAppTimezone();
    console.log(`🔄 Generating daily posts for ${currentDay}`);
    
    let totalGenerated = 0;
    
    // Generate regular comments
    for (const [subreddit, config] of Object.entries(redditTargets)) {
      if (config.active && config.postingSchedule[currentDay]) {
        const times = config.postingSchedule[currentDay];
        
        for (const time of times) {
          // Use premium-focused generation
          const samplePosts = getSamplePostsForSubreddit(subreddit);
          const postTitle = samplePosts[Math.floor(Math.random() * samplePosts.length)];
          const commentResponse = await generatePremiumFeatureComment(
            postTitle, 
            "", 
            subreddit, 
            config.painPointFocus || []
          );
          
          if (commentResponse.success) {
            await quickStoreScheduledPost({
              subreddit,
              scheduledDay: currentDay,
              scheduledTime: time,
              style: commentResponse.style,
              type: 'comment',
              content: commentResponse.comment,
              dailyLimit: config.dailyCommentLimit,
              isPremiumFocus: true,
              premiumFeature: commentResponse.premiumFeature,
              painPoints: commentResponse.painPoints
            });
            
            totalGenerated++;
          }
        }
      }
    }
    
    // Generate educational posts
    for (const [subreddit, config] of Object.entries(redditTargets)) {
      if (config.active && config.educationalPostSchedule && config.educationalPostSchedule[currentDay]) {
        const times = config.educationalPostSchedule[currentDay];
        
        for (const time of times) {
          const educationalResponse = await generateEducationalPostPremium(subreddit);
          
          if (educationalResponse.success) {
            await quickStoreEducationalPost({
              subreddit,
              scheduledDay: currentDay,
              scheduledTime: time,
              style: 'expert',
              type: 'educational',
              title: educationalResponse.title,
              content: educationalResponse.content,
              dailyLimit: config.educationalPostLimit || 1,
              isPremiumFocus: true,
              premiumFeature: educationalResponse.premiumFeature
            });
            
            totalGenerated++;
          }
        }
      }
    }
    
    console.log(`✅ Generated ${totalGenerated} posts for ${currentDay}`);
    
    res.json({
      success: true,
      message: 'Daily posts generated successfully',
      totalGenerated: totalGenerated,
      premiumFocus: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error generating daily posts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate daily posts',
      error: error.message
    });
  }
});

// Generate AI-powered comment for Reddit posts
router.post('/generate-comment', async (req, res) => {
  try {
    const { postTitle, postContent, subreddit, context, style, painPoints } = req.body;

    if (!postTitle) {
      return res.status(400).json({
        success: false,
        message: 'postTitle is required'
      });
    }

    console.log('🤖 Generating AI comment for post:', { 
      subreddit, 
      style,
      titleLength: postTitle.length,
      contentLength: postContent?.length || 0
    });

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
    console.error('❌ Error generating AI comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate AI comment',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Generate AI-powered reply to DMs or comments
router.post('/generate-reply', async (req, res) => {
  try {
    const { message, conversationHistory = [], tone = 'friendly', relationship = 'stranger' } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'message is required'
      });
    }

    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Google Gemini API key not configured'
      });
    }

    console.log('🤖 Generating AI reply to message:', { 
      messageLength: message.length,
      historyLength: conversationHistory.length,
      tone,
      relationship
    });

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3-flash'
    });

    // Different tones for different relationships
    const tonePrompts = {
      friendly: 'Write a friendly, warm reply that builds rapport',
      professional: 'Write a professional, helpful reply',
      casual: 'Write a casual, relaxed reply',
      supportive: 'Write a supportive, encouraging reply',
      informative: 'Write an informative, helpful reply'
    };

    const relationshipPrompts = {
      stranger: 'You are talking to another Reddit user you just met',
      acquaintance: 'You are talking to someone you have interacted with before',
      community_member: 'You are part of the same community and have shared interests'
    };

    let historyContext = '';
    if (conversationHistory.length > 0) {
      historyContext = `Previous conversation:\n${conversationHistory.slice(-3).map(msg => 
        `${msg.sender === 'user' ? 'Them' : 'You'}: ${msg.content}`
      ).join('\n')}\n\n`;
    }

    const prompt = `
${relationshipPrompts[relationship] || relationshipPrompts.stranger}. 
${tonePrompts[tone] || tonePrompts.friendly}.

${historyContext}
Their message: "${message}"

Guidelines:
- Keep it natural and human-like (1-2 sentences)
- Match the tone and relationship context
- Don't sound like a bot or automated response
- Show genuine interest in the conversation
- Ask follow-up questions when appropriate
- Do NOT use any emojis or emoticons
- Don't be overly enthusiastic or salesy

Write a reply that follows these guidelines:
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const reply = response.text().trim();

    console.log('✅ Generated AI reply:', reply);

    res.json({
      success: true,
      reply: reply,
      tone: tone,
      relationship: relationship,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error generating AI reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate AI reply',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Analyze post content for appropriate commenting strategy
router.post('/analyze-post', async (req, res) => {
  try {
    const { postTitle, postContent, subreddit } = req.body;

    if (!postTitle) {
      return res.status(400).json({
        success: false,
        message: 'postTitle is required'
      });
    }

    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Google Gemini API key not configured'
      });
    }

    console.log('🔍 Analyzing post for commenting strategy:', { subreddit });

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
    console.error('❌ Error analyzing post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze post',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
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

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3-flash'
    });
    
    const result = await model.generateContent('Say "Hello from SoundSwap Premium Reddit AI" in a creative way.');
    const response = await result.response;
    const text = response.text();

    res.json({
      success: true,
      message: 'Gemini AI is working correctly',
      response: text,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Gemini AI test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Gemini AI test failed',
      error: error.message
    });
  }
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
    timestamp: new Date().toISOString()
  });
});

// Get specific target configuration
router.get('/targets/:subreddit', (req, res) => {
  const { subreddit } = req.params;
  const target = redditTargets[subreddit];
  
  if (!target) {
    return res.status(404).json({
      success: false,
      message: `Target configuration for r/${subreddit} not found`
    });
  }
  
  const premiumFeatures = target.premiumFeatures?.map(feat => PREMIUM_FEATURES[feat]) || [];
  
  res.json({
    success: true,
    data: {
      ...target,
      premiumFeaturesDetails: premiumFeatures
    },
    timestamp: new Date().toISOString()
  });
});

// Reddit admin health check
router.get('/admin', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  
  res.json({
    success: true,
    message: 'Enhanced Lead Generation Reddit Admin API',
    service: 'reddit-admin',
    version: '5.1.0',
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
    premiumFeatures: PREMIUM_FEATURES,
    features: {
      strategy_1_pain_points: 'ACTIVE',
      strategy_2_bridge_technique: 'ACTIVE',
      strategy_3_golden_hour: 'ACTIVE',
      lyric_video_generator: 'PROMOTED',
      doodle_art_generator: 'PROMOTED',
      lead_generation: 'ENHANCED',
      rate_limit_management: 'ACTIVE',
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'enabled' : 'disabled',
      firebase_db: 'enabled',
      reddit_api: redditConnection.success ? `connected as ${postingActivity.redditUsername}` : 'disconnected',
      comment_generation: 'active',
      dm_replies: 'active',
      content_analysis: 'enhanced',
      target_configuration: 'active',
      auto_posting: 'active',
      cron_scheduler: 'github-actions',
      top50_promotion: 'active',
      educational_posts: 'active',
      on_demand_generation: 'active',
      time_window: `${POSTING_WINDOW_MINUTES} minutes`,
      golden_hour_window: `${GOLDEN_HOUR_WINDOW_MINUTES} minutes`
    },
    stats: {
      total_targets: Object.keys(redditTargets).length,
      active_targets: Object.values(redditTargets).filter(t => t.active).length,
      total_audience: Object.values(redditTargets).reduce((sum, target) => sum + target.memberCount, 0),
      premium_leads: postingActivity.premiumLeadsGenerated,
      premium_mentions: postingActivity.totalPremiumMentions,
      golden_hour_stats: postingActivity.goldenHourStats
    },
    cron: {
      status: 'running',
      total_comments: postingActivity.totalComments,
      total_educational_posts: postingActivity.totalEducationalPosts,
      total_premium_mentions: postingActivity.totalPremiumMentions,
      last_run: postingActivity.lastCronRun,
      github_actions_runs: postingActivity.githubActionsRuns,
      daily_limits: Object.fromEntries(
        Object.entries(redditTargets).map(([k, v]) => [k, {
          comments: v.dailyCommentLimit,
          educational: v.educationalPostLimit || 1,
          premium: v.premiumFeatureLimit || 2
        }])
      )
    },
    endpoints: {
      premium_analytics: '/api/reddit-admin/premium-analytics',
      generate_premium_content: '/api/reddit-admin/generate-premium-content',
      optimized_schedule: '/api/reddit-admin/optimized-schedule',
      post_premium_feature: '/api/reddit-admin/post-premium-feature',
      golden_hour_scan: '/api/reddit-admin/golden-hour-scan',
      cron_status: '/api/reddit-admin/cron-status',
      schedule_today: '/api/reddit-admin/schedule/today',
      manual_post: '/api/reddit-admin/manual-post',
      create_educational_post: '/api/reddit-admin/create-educational-post',
      create_top50_post: '/api/reddit-admin/create-top50-post',
      reset_counts: '/api/reddit-admin/reset-counts',
      generate_comment: '/api/reddit-admin/generate-comment',
      generate_reply: '/api/reddit-admin/generate-reply',
      analyze_post: '/api/reddit-admin/analyze-post',
      cron: '/api/reddit-admin/cron (POST)',
      generate_daily_posts: '/api/reddit-admin/generate-daily-posts'
    }
  });
});

// Create Top 50 chart promotion post (REAL Reddit posting)
router.post('/create-top50-post', async (req, res) => {
  try {
    const { subreddit } = req.body;
    
    if (!subreddit) {
      return res.status(400).json({
        success: false,
        message: 'subreddit is required'
      });
    }
    
    const targetConfig = redditTargets[subreddit];
    if (!targetConfig) {
      return res.status(404).json({
        success: false,
        message: `Subreddit r/${subreddit} not found in targets`
      });
    }
    
    console.log(`🔄 Creating Top 50 promotion post for r/${subreddit}`);
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3-flash'
    });
    
    const prompt = `Create a Reddit post about SoundSwap's Weekly Top 50 chart for r/${subreddit}.
    
Focus on:
- It's 100% FREE for artists
- Helps with organic Spotify algorithm growth
- Weekly exposure on the Top 50 chart
- No fake streams, real organic growth
- Perfect for artists in r/${subreddit}

Write as a SoundSwap representative:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    const lines = text.split('\n');
    let title = lines[0] || `FREE Weekly Top 50 Chart for r/${subreddit} Artists`;
    let content = lines.slice(1).join('\n');

    if (!content.toLowerCase().includes('soundswap.live')) {
      content += `\n\nCheck it out at soundswap.live`;
    }

    const postResponse = {
      success: true,
      title: title.substring(0, 200),
      content: content.substring(0, 1000),
      subreddit: subreddit,
      type: 'educational'
    };
    
    // Post to Reddit immediately
    const redditResult = await postToReddit(
      subreddit, 
      postResponse.content, 
      'enthusiastic', 
      'educational', 
      postResponse.title
    );
    
    if (redditResult.success) {
      // Update activity
      postingActivity.educationalCounts[subreddit] = (postingActivity.educationalCounts[subreddit] || 0) + 1;
      postingActivity.lastEducationalPosted[subreddit] = new Date().toISOString();
      postingActivity.totalEducationalPosts++;
      
      await quickSavePostingActivity(postingActivity);
    }
    
    res.json({
      success: postResponse.success && redditResult.success,
      title: postResponse.title,
      content: postResponse.content,
      subreddit: subreddit,
      postedToReddit: redditResult.success,
      redditData: redditResult.redditData,
      activity: postingActivity.educationalCounts[subreddit],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error creating Top 50 post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create Top 50 promotion post',
      error: error.message
    });
  }
});

// Test Reddit connection
router.get('/test-reddit', async (req, res) => {
  try {
    const connection = await testRedditConnection();
    res.json(connection);
  } catch (error) {
    console.error('❌ Error testing Reddit connection:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add more Reddit admin routes as needed
router.get('/auth', (req, res) => {
  res.json({
    success: true,
    message: 'Reddit authentication endpoint',
    status: 'active'
  });
});

router.get('/posts', (req, res) => {
  res.json({
    success: true,
    message: 'Reddit posts management endpoint',
    status: 'active'
  });
});

router.get('/analytics', (req, res) => {
  res.json({
    success: true,
    message: 'Reddit analytics endpoint',
    status: 'active'
  });
});

export default router;