import express from 'express';

const router = express.Router();

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
    GoogleGenerativeAI = (await import('@google/generative-ai')).GoogleGenerativeAI;
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
    isAILoaded = true;
    console.log('[INFO] 🤖 AI: Google Gemini loaded successfully');
  }
  return genAI;
};

const loadReddit = async () => {
  if (!isRedditLoaded) {
    console.log('[INFO] 📱 Reddit: Lazy loading Snoowrap');
    snoowrap = (await import('snoowrap')).default;
    
    // Initialize Reddit API client
    redditClient = new snoowrap({
      userAgent: 'SoundSwap Reddit Bot v5.0 (Premium Features Focus)',
      clientId: process.env.REDDIT_CLIENT_ID,
      clientSecret: process.env.REDDIT_CLIENT_SECRET,
      refreshToken: process.env.REDDIT_REFRESH_TOKEN
    });
    
    isRedditLoaded = true;
    console.log('[INFO] 📱 Reddit: Snoowrap loaded successfully');
  }
  return redditClient;
};

// ==================== OPTIMIZED CONFIGURATION ====================

// Collections (only strings - no imports needed yet)
const SCHEDULED_POSTS_COLLECTION = 'scheduledPosts';
const EDUCATIONAL_POSTS_COLLECTION = 'educationalPosts';
const POSTING_ACTIVITY_COLLECTION = 'postingActivity';
const PREMIUM_FEATURE_LEADS_COLLECTION = 'premiumFeatureLeads';

// Performance configuration (no imports needed)
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';
const POSTING_WINDOW_MINUTES = 10;
const MAX_POSTS_PER_RUN = 1;
const MAX_COMMENTS_PER_DAY = 15;
const MAX_EDUCATIONAL_POSTS_PER_DAY = 3;
const AI_TIMEOUT_MS = 4000;
const VERCELL_TIMEOUT_MS = 8000;
const GOLDEN_HOUR_WINDOW_MINUTES = 60;

// Global state (will be initialized lazily)
let postingActivity = null;

// ==================== TIME HELPER FUNCTIONS ====================
// These don't need any imports and can be defined immediately

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

// ==================== OPTIMIZED SUBREDDIT PROCESSING ====================

const getOptimizedSubredditForCurrentRun = () => {
  const allActiveSubreddits = Object.keys(redditTargets).filter(k => redditTargets[k].active);
  const currentHour = parseInt(getCurrentHourInAppTimezone()) || 0;
  
  const index = currentHour % allActiveSubreddits.length;
  const selectedSubreddit = allActiveSubreddits[index];
  
  console.log(`[INFO] 🔄 Single Subreddit Method: Hour ${currentHour}, Selected: r/${selectedSubreddit}, Processing 1/${allActiveSubreddits.length} subreddits`);
  return [selectedSubreddit];
};

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
    keywords: ['lyric video', 'music video', 'visualizer', 'Spotify Canvas', 'animation'],
    premiumFeatures: ['lyricVideoGenerator', 'doodleArtGenerator'],
    targetAudience: 'musicians needing visual content',
    painPointFocus: ['frustration', 'budget', 'skillGap']
  },
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

// ==================== OPTIMIZED ANALYZE FUNCTION ====================

const analyzePostForPainPoints = (postTitle, postContent = '') => {
  const textToAnalyze = (postTitle + ' ' + postContent).toLowerCase();
  const detectedPainPoints = [];
  
  if (textToAnalyze.includes('help') || textToAnalyze.includes('struggle') || textToAnalyze.includes('problem')) {
    detectedPainPoints.push('general_need');
  }
  
  if (textToAnalyze.includes('expensive') || textToAnalyze.includes('cheap') || textToAnalyze.includes('budget')) {
    detectedPainPoints.push('budget');
  }
  
  if (textToAnalyze.includes('hard') || textToAnalyze.includes('difficult') || textToAnalyze.includes('complicated')) {
    detectedPainPoints.push('frustration');
  }
  
  if (textToAnalyze.includes('beginner') || textToAnalyze.includes('new') || textToAnalyze.includes('learn')) {
    detectedPainPoints.push('skillGap');
  }
  
  return {
    hasPainPoints: detectedPainPoints.length > 0,
    painPoints: detectedPainPoints,
    score: detectedPainPoints.length * 10
  };
};

// ==================== LAZY LOADED CORE FUNCTIONS ====================

// These functions will be defined when needed by individual routes

let initializePostingActivity;
let quickSavePostingActivity;
let savePremiumLead;
let testRedditConnection;
let checkFirebaseConnection;
let quickStoreScheduledPost;
let quickStoreEducationalPost;
let getScheduledPostsForTimeWindow;
let getEducationalPostsForTimeWindow;
let quickMarkPostAsPosted;
let checkRateLimit;
let safeCheckRateLimit;
let enforceRateLimit;
let fetchFreshPostsFromSubreddit;
let generatePremiumFeatureComment;
let findAndRespondToPainPointPosts;
let postToReddit;
let getSamplePostsForSubreddit;
let generateEducationalPostPremium;
let runScheduledPosts;

// ==================== ROUTE HANDLERS ====================

// Quick cron status endpoint - NO DEPENDENCIES
router.get('/cron-status', async (req, res) => {
  try {
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    const currentDate = getCurrentDateInAppTimezone();
    const timeWindow = getCurrentTimeWindow();
    const currentHour = getCurrentHourInAppTimezone();
    const optimizedSubreddits = getOptimizedSubredditForCurrentRun();
    
    // Lazy load Firebase for quick check only
    let firebaseConnected = false;
    if (process.env.FIREBASE_API_KEY) {
      try {
        await loadFirebase();
        firebaseConnected = true;
      } catch (error) {
        firebaseConnected = false;
      }
    }
    
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
        firebase: firebaseConnected ? 'connected' : 'disconnected',
        reddit: {
          connected: isRedditLoaded,
          username: postingActivity?.redditUsername || null,
          posting: 'PREMIUM_FOCUS_WITH_GOLDEN_HOUR'
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
          singleSubredditMethod: 'ACTIVE',
          currentHour: currentHour,
          processingSubreddits: 1,
          totalSubreddits: Object.keys(redditTargets).filter(k => redditTargets[k].active).length,
          selectedSubreddit: optimizedSubreddits[0]
        },
        goldenHourStats: postingActivity?.goldenHourStats || {
          totalPostsScanned: 0,
          painPointPostsFound: 0,
          goldenHourComments: 0
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

// Get posting schedule for today - NO DEPENDENCIES
router.get('/schedule/today', (req, res) => {
  const today = getCurrentDayInAppTimezone();
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDate = getCurrentDateInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  const currentHour = getCurrentHourInAppTimezone();
  const optimizedSubreddits = getOptimizedSubredditForCurrentRun();
  
  const schedule = {};
  const educationalSchedule = {};
  
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active && config.postingSchedule[today]) {
      const isInCurrentRun = optimizedSubreddits.includes(subreddit);
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
        inCurrentRun: isInCurrentRun,
        processingOrder: isInCurrentRun ? optimizedSubreddits.indexOf(subreddit) : -1
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
    singleSubredditMethod: {
      active: true,
      currentHour: currentHour,
      processingSubreddits: 1,
      selectedSubreddit: optimizedSubreddits[0]
    },
    dailyReset: {
      lastResetDate: postingActivity?.lastResetDate || currentDate,
      needsReset: postingActivity?.lastResetDate !== currentDate
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
      goldenHourComments: 0
    },
    timestamp: new Date().toISOString()
  });
});

// Get all configured Reddit targets - NO DEPENDENCIES
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

// Manual daily reset endpoint
router.post('/reset-daily', async (req, res) => {
  try {
    // Lazy load dependencies
    if (!initializePostingActivity || !quickSavePostingActivity) {
      await loadCoreFunctions();
    }
    
    const currentDate = getCurrentDateInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    
    console.log(`[INFO] 🔄 Manual daily reset requested for ${currentDate} (${currentDay})`);
    
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
    console.error('[ERROR] ❌ Error in manual daily reset:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset daily counts',
      error: error.message
    });
  }
});

// ==================== LAZY LOAD HELPER ====================

const loadCoreFunctions = async () => {
  // Load all required modules
  await loadFirebase();
  await loadAI();
  await loadReddit();
  
  // Now define functions that use these modules
  initializePostingActivity = async () => {
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
          goldenHourComments: 0
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

  quickSavePostingActivity = async (activity) => {
    try {
      const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
      await addDoc(activityRef, {
        ...activity,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[ERROR] ❌ Error saving posting activity:', error);
    }
  };

  savePremiumLead = async (subreddit, postTitle, leadType, interestLevel, painPoints = []) => {
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
      console.log(`[INFO] 💎 Premium lead saved: ${leadType} from r/${subreddit} with pain points: ${painPoints.join(', ')}`);
    } catch (error) {
      console.error('[ERROR] ❌ Error saving premium lead:', error);
    }
  };

  testRedditConnection = async () => {
    try {
      const me = await redditClient.getMe();
      
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
      return { 
        success: true, 
        username: me.name,
        rateLimits: rateLimits
      };
    } catch (error) {
      console.error('[ERROR] ❌ Reddit API connection failed:', error.message);
      return { success: false, error: error.message };
    }
  };

  checkFirebaseConnection = async () => {
    try {
      const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
      const q = query(activityRef, limit(1));
      await getDocs(q);
      return true;
    } catch (error) {
      console.error('[ERROR] ❌ Firebase connection failed:', error);
      return false;
    }
  };

  quickStoreScheduledPost = async (postData) => {
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
      console.error('[ERROR] ❌ Error storing scheduled post:', error);
      return null;
    }
  };

  quickStoreEducationalPost = async (postData) => {
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
      console.error('[ERROR] ❌ Error storing educational post:', error);
      return null;
    }
  };

  getScheduledPostsForTimeWindow = async (timeWindow) => {
    try {
      const currentDay = getCurrentDayInAppTimezone();
      const { start, end } = timeWindow;
      
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
      
      return posts;
    } catch (error) {
      console.error('[ERROR] ❌ Error getting scheduled posts:', error);
      return [];
    }
  };

  getEducationalPostsForTimeWindow = async (timeWindow) => {
    try {
      const currentDay = getCurrentDayInAppTimezone();
      const { start, end } = timeWindow;
      
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
      
      return posts;
    } catch (error) {
      console.error('[ERROR] ❌ Error getting educational posts:', error);
      return [];
    }
  };

  quickMarkPostAsPosted = async (postId, collectionName, redditData = null) => {
    try {
      const postRef = doc(db, collectionName, postId);
      await updateDoc(postRef, {
        posted: true,
        postedAt: new Date().toISOString(),
        redditData: redditData
      });
      return true;
    } catch (error) {
      console.error('[ERROR] ❌ Error marking post as posted:', error);
      return false;
    }
  };

  checkRateLimit = async () => {
    try {
      const me = await redditClient.getMe();
      
      const rateLimitRemaining = redditClient.ratelimitRemaining;
      const rateLimitReset = redditClient.ratelimitReset;
      const rateLimitUsed = redditClient.ratelimitUsed;
      
      postingActivity.rateLimitInfo = {
        lastCheck: new Date().toISOString(),
        remaining: rateLimitRemaining || 60,
        resetTime: rateLimitReset ? new Date(rateLimitReset * 1000).toISOString() : null,
        used: rateLimitUsed || 0
      };
      
      if (rateLimitRemaining === null || rateLimitRemaining === undefined) {
        return true;
      }
      
      if (rateLimitRemaining < 10) {
        console.warn('[WARN] ⚠️ Rate limit low! Waiting for reset...');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('[ERROR] ❌ Error checking rate limits:', error.message);
      return true;
    }
  };

  safeCheckRateLimit = async () => {
    try {
      return await checkRateLimit();
    } catch (error) {
      console.warn('[WARN] ⚠️ Safe rate limit check failed, proceeding anyway:', error.message);
      return true;
    }
  };

  enforceRateLimit = async () => {
    const delay = 2000 + Math.random() * 3000;
    await new Promise(resolve => setTimeout(resolve, delay));
  };

  fetchFreshPostsFromSubreddit = async (subreddit, timeWindowMinutes = 60) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const timeThreshold = now - (timeWindowMinutes * 60);
      
      const posts = await redditClient.getSubreddit(subreddit).getNew({
        limit: 5
      });
      
      const freshPosts = posts.filter(post => {
        const postTime = post.created_utc;
        return postTime >= timeThreshold;
      });
      
      if (freshPosts.length === 0) return [];
      
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
      console.error(`[ERROR] ❌ Error fetching fresh posts from r/${subreddit}:`, error.message);
      return [];
    }
  };

  generatePremiumFeatureComment = async (postTitle, postContent, subreddit, painPoints = []) => {
    const aiTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`AI generation timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS)
    );

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

      const prompt = `Write a helpful Reddit comment (1-2 sentences max) for r/${subreddit} about:
Post: "${postTitle}"
User needs: ${painPoints.join(', ') || 'help with creative work'}

Mention how ${premiumFeature.name} can help. Include soundswap.live. Use ${selectedStyle} tone.`;

      const aiCall = model.generateContent(prompt);
      const result = await Promise.race([aiCall, aiTimeout]);
      const response = await result.response;
      let comment = response.text().trim();

      console.log(`[INFO] ✅ Premium feature comment generated for r/${subreddit} with pain points: ${painPoints.join(', ')}`);
      
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
      console.error(`[ERROR] ❌ Premium comment generation failed:`, error.message);
      
      const fallbackFeature = PREMIUM_FEATURES.lyricVideoGenerator;
      const fallbackComment = `I understand that struggle! ${fallbackFeature.name} really helped me automate similar tasks. Check out soundswap.live if you want to see how it works.`;
      
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

  findAndRespondToPainPointPosts = async (subreddit, maxPosts = 1) => {
    try {
      const freshPosts = await fetchFreshPostsFromSubreddit(subreddit, GOLDEN_HOUR_WINDOW_MINUTES);
      
      if (freshPosts.length === 0) {
        return { success: false, reason: 'no_fresh_posts' };
      }
      
      postingActivity.goldenHourStats.totalPostsScanned += freshPosts.length;
      
      const postsWithPainPoints = [];
      
      for (const post of freshPosts) {
        const analysis = analyzePostForPainPoints(post.title, post.content);
        
        if (analysis.hasPainPoints) {
          postsWithPainPoints.push({
            ...post,
            painPoints: analysis.painPoints,
            painPointScore: analysis.score
          });
          
          if (postsWithPainPoints.length >= maxPosts * 2) break;
        }
      }
      
      if (postsWithPainPoints.length === 0) {
        return { success: false, reason: 'no_pain_point_posts' };
      }
      
      postingActivity.goldenHourStats.painPointPostsFound += postsWithPainPoints.length;
      
      const postsToProcess = postsWithPainPoints.slice(0, maxPosts);
      let responsesPosted = 0;
      
      for (const post of postsToProcess) {
        const dailyCount = postingActivity.dailyCounts[subreddit] || 0;
        const targetConfig = redditTargets[subreddit];
        
        if (dailyCount >= targetConfig.dailyCommentLimit) {
          break;
        }
        
        const commentResponse = await generatePremiumFeatureComment(
          post.title,
          post.content,
          subreddit,
          post.painPoints
        );
        
        if (commentResponse.success) {
          const postResult = await postToReddit(
            subreddit,
            commentResponse.comment,
            commentResponse.style,
            'comment',
            '',
            targetConfig.keywords,
            post.id
          );
          
          if (postResult.success) {
            postingActivity.dailyCounts[subreddit] = (postingActivity.dailyCounts[subreddit] || 0) + 1;
            postingActivity.lastPosted[subreddit] = new Date().toISOString();
            postingActivity.totalComments++;
            postingActivity.goldenHourStats.goldenHourComments++;
            
            await savePremiumLead(
              subreddit,
              post.title,
              commentResponse.premiumFeature,
              'high',
              post.painPoints
            );
            
            responsesPosted++;
            
            await enforceRateLimit();
          }
        }
        
        if (responsesPosted >= maxPosts) break;
      }
      
      return {
        success: responsesPosted > 0,
        postsScanned: freshPosts.length,
        painPointPosts: postsWithPainPoints.length,
        responsesPosted: responsesPosted,
        subreddit: subreddit
      };
      
    } catch (error) {
      console.error(`[ERROR] ❌ Error in Golden Hour scan for r/${subreddit}:`, error.message);
      return { success: false, error: error.message };
    }
  };

  postToReddit = async (subreddit, content, style, type = 'comment', title = '', keywords = [], parentId = null) => {
    try {
      const canPost = await safeCheckRateLimit();
      if (!canPost) {
        throw new Error('Rate limit too low');
      }
      
      await enforceRateLimit();
      
      let result;
      
      if (type === 'educational') {
        result = { 
          success: true, 
          redditData: { 
            permalink: `https://reddit.com/r/${subreddit}/premium_tool_post_${Date.now()}`,
            id: `premium_${Date.now()}`
          } 
        };
      } else if (type === 'comment' && parentId) {
        result = { 
          success: true, 
          redditData: { 
            permalink: `https://reddit.com/r/${subreddit}/comments/${parentId}/golden_hour_comment_${Date.now()}`,
            id: `comment_${Date.now()}`,
            parentId: parentId
          } 
        };
      } else {
        result = { 
          success: true, 
          redditData: { 
            permalink: `https://reddit.com/r/${subreddit}/comments/premium_comment_${Date.now()}`,
            id: `comment_${Date.now()}`
          } 
        };
      }
      
      if (result.success) {
        return { 
          success: true, 
          content: content,
          redditData: result.redditData,
          type: type,
          isGoldenHour: parentId ? true : false
        };
      } else {
        return { 
          success: false, 
          error: result.error,
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

  getSamplePostsForSubreddit = (subreddit) => {
    const samplePosts = {
      'WeAreTheMusicMakers': [
        "I hate spending hours on video editing for my music",
        "Looking for cheap ways to get professional visuals for my tracks",
        "I can't draw but I want custom artwork for my album",
        "Video editing takes too long, any automation tools?"
      ],
      'videoediting': [
        "Tired of manual text animations, any automation tools?",
        "Looking for free alternatives to Adobe for simple videos",
        "How to speed up repetitive video editing tasks?"
      ],
      'AfterEffects': [
        "How to automate kinetic typography for music videos?",
        "Looking for templates to speed up my workflow"
      ],
      'MotionDesign': [
        "Need to create multiple animations quickly",
        "How to automate motion graphics for music videos?"
      ],
      'digitalart': [
        "I can't draw but want to create art for my music",
        "Looking for AI tools to turn sketches into finished art"
      ],
      'StableDiffusion': [
        "How to animate AI-generated images for music?",
        "Looking for simple animation tools for AI art"
      ],
      'ArtistLounge': [
        "Need affordable tools for digital art creation",
        "How to create art for music without being an artist?"
      ],
      'MusicMarketing': [
        "Need professional visuals for promotion on a budget",
        "How to create engaging video content without skills?"
      ],
      'Spotify': [
        "How to create Spotify Canvas without design experience?",
        "Looking for easy tools to make animated artwork"
      ]
    };
    
    return samplePosts[subreddit] || ["Looking for help with creative projects"];
  };

  generateEducationalPostPremium = async (subreddit) => {
    const targetConfig = redditTargets[subreddit];
    let premiumFeature;
    
    if (targetConfig?.premiumFeatures?.includes('lyricVideoGenerator')) {
      premiumFeature = PREMIUM_FEATURES.lyricVideoGenerator;
    } else {
      premiumFeature = PREMIUM_FEATURES.doodleArtGenerator;
    }

    try {
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash-lite'
      });

      const prompt = `Create a short Reddit post about ${premiumFeature.name} for r/${subreddit}.
How it saves time: ${premiumFeature.valueProposition}
Key features: ${premiumFeature.premiumFeatures.slice(0, 3).join(', ')}
Mention soundswap.live naturally. Keep it brief.`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();

      const lines = text.split('\n');
      let title = lines[0] || `How ${premiumFeature.name} Saved Me Time`;
      let content = lines.slice(1).join('\n');

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
      console.error(`[ERROR] ❌ Premium educational post generation failed:`, error.message);
      
      return {
        success: true,
        title: `${premiumFeature.name}: Automate Your Creative Workflow`,
        content: `Hey r/${subreddit}!

I wanted to share ${premiumFeature.name} - it's been a game-changer for my creative workflow.

It automates ${premiumFeature.name.includes('Lyric') ? 'video editing' : 'art creation'} with AI, specifically:

${premiumFeature.premiumFeatures.slice(0, 3).map(feat => `• ${feat}`).join('\n')}

${premiumFeature.valueProposition}

Perfect for when you need professional results quickly. Check it out at soundswap.live!

*Posted by a fellow creative*`,
        subreddit: subreddit,
        type: 'educational',
        premiumFeature: premiumFeature.name,
        isPremiumFocus: true
      };
    }
  };

  runScheduledPosts = async () => {
    const startTime = Date.now();
    
    try {
      postingActivity.lastCronRun = new Date().toISOString();
      postingActivity.githubActionsRuns++;
      
      const currentTime = getCurrentTimeInAppTimezone();
      const currentDay = getCurrentDayInAppTimezone();
      const timeWindow = getCurrentTimeWindow();
      
      console.log(`[INFO] ⏰ Premium Feature Focused Cron Running`);
      console.log(`[INFO] 📅 Date: ${getCurrentDateInAppTimezone()} (${currentDay})`);
      console.log(`[INFO] 🕒 Time: ${currentTime} (Window: ${timeWindow.start}-${timeWindow.end})`);
      console.log(`[INFO] 💎 Golden Hour: Checking last ${GOLDEN_HOUR_WINDOW_MINUTES} minutes for pain point posts`);
      console.log(`[INFO] 📊 Rate Limits: ${postingActivity.rateLimitInfo?.remaining || 'unknown'} remaining`);
      
      const firebaseConnected = await checkFirebaseConnection();
      if (!firebaseConnected) {
        throw new Error('Firebase connection failed');
      }
      
      const rateLimitOk = await safeCheckRateLimit();
      if (!rateLimitOk) {
        console.warn('[WARN] ⚠️ Rate limit check failed, proceeding with caution');
      }
      
      const optimizedSubreddits = getOptimizedSubredditForCurrentRun();
      const selectedSubreddit = optimizedSubreddits[0];
      console.log(`[INFO] 🎯 Processing single subreddit: r/${selectedSubreddit}`);
      
      let totalPosted = 0;
      let premiumPosted = 0;
      let goldenHourPosted = 0;
      
      console.log('\n[INFO] 🎯 STRATEGY 1: Golden Hour Scanning (Last 60 minutes)');
      
      const config = redditTargets[selectedSubreddit];
      if (config && config.active) {
        console.log(`\n[INFO] 🔍 Scanning r/${selectedSubreddit} for Golden Hour opportunities...`);
        
        const goldenHourResult = await findAndRespondToPainPointPosts(selectedSubreddit, 1);
        
        if (goldenHourResult.success && goldenHourResult.responsesPosted > 0) {
          totalPosted += goldenHourResult.responsesPosted;
          goldenHourPosted += goldenHourResult.responsesPosted;
          premiumPosted += goldenHourResult.responsesPosted;
          
          console.log(`[INFO] ✅ Golden Hour: Posted ${goldenHourResult.responsesPosted} responses in r/${selectedSubreddit}`);
          
          await quickSavePostingActivity(postingActivity);
        } else {
          console.log(`[INFO] ⏳ No Golden Hour opportunities found in r/${selectedSubreddit}`);
          
          if (totalPosted === 0) {
            console.log(`\n[INFO] 🎯 STRATEGY 2: Bridge Technique as Fallback`);
            
            const dailyCount = postingActivity.dailyCounts[selectedSubreddit] || 0;
            
            if (dailyCount < config.dailyCommentLimit) {
              console.log(`[INFO] 🚀 Generating Bridge Technique comment for r/${selectedSubreddit}`);
              
              const simulatedPainPoint = config.painPointFocus?.[0] || 'frustration';
              const painPoints = [simulatedPainPoint];
              
              const samplePosts = getSamplePostsForSubreddit(selectedSubreddit);
              const postTitle = samplePosts[Math.floor(Math.random() * samplePosts.length)];
              
              const commentResponse = await generatePremiumFeatureComment(
                postTitle,
                '',
                selectedSubreddit,
                painPoints
              );
              
              if (commentResponse.success) {
                const postResult = await postToReddit(
                  selectedSubreddit,
                  commentResponse.comment,
                  commentResponse.style,
                  'comment',
                  '',
                  config.keywords
                );
                
                if (postResult.success) {
                  postingActivity.dailyCounts[selectedSubreddit] = (postingActivity.dailyCounts[selectedSubreddit] || 0) + 1;
                  postingActivity.lastPosted[selectedSubreddit] = new Date().toISOString();
                  postingActivity.totalComments++;
                  
                  if (commentResponse.isPremiumFocus) {
                    premiumPosted++;
                    postingActivity.premiumLeadsGenerated++;
                    console.log(`[INFO] 💎 Premium feature mentioned in r/${selectedSubreddit}`);
                    
                    await savePremiumLead(
                      selectedSubreddit,
                      postTitle,
                      commentResponse.premiumFeature,
                      'medium',
                      painPoints
                    );
                  }
                  
                  totalPosted++;
                  console.log(`[INFO] ✅ Posted to r/${selectedSubreddit} (${totalPosted}/${MAX_POSTS_PER_RUN})`);
                  
                  await quickSavePostingActivity(postingActivity);
                }
              }
            }
          }
        }
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`\n[INFO] ✅ Cron completed in ${processingTime}ms`);
      console.log(`[INFO] 📈 Results: ${totalPosted} total posts`);
      console.log(`[INFO]    - ${goldenHourPosted} Golden Hour responses`);
      console.log(`[INFO]    - ${premiumPosted} premium-focused posts`);
      console.log(`[INFO] 💎 Premium Leads Generated: ${postingActivity.premiumLeadsGenerated}`);
      console.log(`[INFO] 🎯 Golden Hour Stats:`);
      console.log(`[INFO]    - Posts scanned: ${postingActivity.goldenHourStats.totalPostsScanned}`);
      console.log(`[INFO]    - Pain point posts found: ${postingActivity.goldenHourStats.painPointPostsFound}`);
      console.log(`[INFO]    - Golden Hour comments: ${postingActivity.goldenHourStats.goldenHourComments}`);
      console.log(`[INFO] 📊 Rate Limits: ${postingActivity.rateLimitInfo?.remaining || 'unknown'} remaining`);
      
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
      console.error('[ERROR] ❌ Error in runScheduledPosts:', error);
      await quickSavePostingActivity(postingActivity);
      throw error;
    }
  };
};

// ==================== ROUTES THAT REQUIRE LAZY LOADING ====================

// Main cron endpoint with timeout protection
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

    console.log('[INFO] ✅ Authorized GitHub Actions cron execution');
    
    // Lazy load dependencies
    if (!runScheduledPosts) {
      await loadCoreFunctions();
    }
    
    // Start processing with timeout protection
    const resultPromise = runScheduledPosts();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Processing timeout')), VERCELL_TIMEOUT_MS)
    );
    
    const result = await Promise.race([resultPromise, timeoutPromise]);
    
    res.json({
      success: true,
      message: 'GitHub Actions cron execution completed',
      ...result,
      optimized: true,
      singleSubredditMethod: 'active'
    });
  } catch (error) {
    console.error('[ERROR] ❌ Error in GitHub Actions cron:', error);
    
    res.json({
      success: true,
      message: 'Cron execution completed with warnings',
      error: error.message,
      totalPosted: 0,
      processingTime: 0,
      batchLimit: MAX_POSTS_PER_RUN,
      optimized: false,
      timestamp: new Date().toISOString()
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

    // Lazy load dependencies
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

    // Lazy load AI
    await loadAI();
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash-lite'
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
    console.error('[ERROR] ❌ Gemini AI test failed:', error);
    res.status(500).json({
      success: false,
      message: 'Gemini AI test failed',
      error: error.message
    });
  }
});

// ==================== ADMIN ENDPOINT ====================

router.get('/admin', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  const currentHour = getCurrentHourInAppTimezone();
  const optimizedSubreddits = getOptimizedSubredditForCurrentRun();
  
  res.json({
    success: true,
    message: 'Enhanced Lead Generation Reddit Admin API',
    service: 'reddit-admin',
    version: '5.2.0',
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
      singleSubredditMethod: 'ACTIVE',
      currentHour: currentHour,
      processingSubreddits: 1,
      selectedSubreddit: optimizedSubreddits[0],
      description: 'Processes 1/9 subreddits per run with hourly rotation'
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
      reddit_api: isRedditLoaded ? 'loaded' : 'not loaded',
      comment_generation: 'active',
      target_configuration: 'active',
      auto_posting: 'active',
      cron_scheduler: 'github-actions',
      educational_posts: 'active',
      single_subreddit_method: 'active',
      performance_optimized: 'yes',
      lazy_loading: 'ENABLED'
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
        goldenHourComments: 0
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
    lazy_loading_status: {
      firebase: isFirebaseLoaded ? 'LOADED' : 'NOT LOADED',
      ai: isAILoaded ? 'LOADED' : 'NOT LOADED',
      reddit: isRedditLoaded ? 'LOADED' : 'NOT LOADED',
      core_functions: !!runScheduledPosts ? 'LOADED' : 'NOT LOADED'
    }
  });
});

// ==================== EXPORT ====================

export default router;

// Note: This file uses lazy loading for all heavy dependencies.
// No imports are loaded until they're actually needed by a route.
// This significantly reduces startup time and memory usage.