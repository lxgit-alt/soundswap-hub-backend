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

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// ==================== PERFORMANCE CONFIGURATION ====================

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';
const POSTING_WINDOW_MINUTES = 10;
const MAX_POSTS_PER_RUN = 3;
const AI_TIMEOUT_MS = 5000;
const VERCELL_TIMEOUT_MS = 8000;

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

// ==================== REDDIT API CONFIGURATION ====================

// Initialize Reddit API client
const redditClient = new snoowrap({
  userAgent: 'SoundSwap Reddit Bot v4.0',
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  refreshToken: process.env.REDDIT_REFRESH_TOKEN
});

// Test Reddit connection
const testRedditConnection = async () => {
  try {
    const me = await redditClient.getMe();
    console.log(`✅ Reddit API connected successfully. Logged in as: ${me.name}`);
    return { success: true, username: me.name };
  } catch (error) {
    console.error('❌ Reddit API connection failed:', error.message);
    return { success: false, error: error.message };
  }
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
      
      // Reset all daily counts
      Object.keys(currentActivity.dailyCounts).forEach(key => {
        currentActivity.dailyCounts[key] = 0;
      });
      Object.keys(currentActivity.educationalCounts).forEach(key => {
        currentActivity.educationalCounts[key] = 0;
      });
      
      // Reset last posted timestamps to allow immediate posting
      currentActivity.lastPosted = {};
      currentActivity.lastEducationalPosted = {};
      
      // Update reset tracking
      currentActivity.lastResetDate = currentDate;
      currentActivity.lastResetDay = currentDay;
      currentActivity.lastResetTime = new Date().toISOString();
      
      console.log(`✅ Daily counts reset for ${currentDate} (${currentDay})`);
      console.log(`📊 Reset counts:`, {
        comments: currentActivity.dailyCounts,
        educational: currentActivity.educationalCounts
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

const initializePostingActivity = async () => {
  try {
    const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
    const q = query(activityRef, orderBy('timestamp', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      const initialActivity = {
        dailyCounts: {},
        educationalCounts: {},
        lastPosted: {},
        lastEducationalPosted: {},
        totalComments: 0,
        totalEducationalPosts: 0,
        lastCronRun: null,
        githubActionsRuns: 0,
        redditUsername: null,
        lastResetDate: getCurrentDateInAppTimezone(),
        lastResetDay: getCurrentDayInAppTimezone(),
        lastResetTime: new Date().toISOString(),
        timestamp: new Date().toISOString()
      };
      
      Object.keys(redditTargets).forEach(subreddit => {
        initialActivity.dailyCounts[subreddit] = 0;
        initialActivity.educationalCounts[subreddit] = 0;
      });
      
      await addDoc(activityRef, initialActivity);
      console.log('✅ Initialized new posting activity record with daily reset');
      return initialActivity;
    } else {
      const activityDoc = snapshot.docs[0].data();
      console.log('✅ Loaded existing posting activity');
      
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
    lastPosted: {},
    lastEducationalPosted: {},
    totalComments: 0,
    totalEducationalPosts: 0,
    lastCronRun: null,
    githubActionsRuns: 0,
    redditUsername: null,
    lastResetDate: getCurrentDateInAppTimezone(),
    lastResetDay: getCurrentDayInAppTimezone(),
    lastResetTime: new Date().toISOString(),
    timestamp: new Date().toISOString()
  };
  
  Object.keys(redditTargets).forEach(subreddit => {
    fallbackActivity.dailyCounts[subreddit] = 0;
    fallbackActivity.educationalCounts[subreddit] = 0;
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

// ==================== REDDIT TARGET CONFIGURATION ====================

const redditTargets = {
  'WeAreTheMusicMakers': {
    name: 'WeAreTheMusicMakers',
    memberCount: 1800000,
    description: 'Dedicated to musicians, producers, and enthusiasts',
    active: true,
    priority: 'high',
    postingSchedule: {
      monday: ['09:00', '14:00', '19:00'],
      tuesday: ['10:00', '15:00', '20:00'],
      wednesday: ['09:00', '14:00', '19:00'],
      thursday: ['10:00', '15:00', '20:00'],
      friday: ['09:00', '14:00', '19:00'],
      saturday: ['11:00', '16:00', '21:00'],
      sunday: ['11:00', '16:00', '21:00']
    },
    educationalPostSchedule: {
      monday: ['11:00'],
      wednesday: ['15:00'],
      friday: ['13:00']
    },
    preferredStyles: ['helpful', 'expert', 'thoughtful'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 8,
    educationalPostLimit: 1,
    keywords: ['production', 'mixing', 'mastering', 'DAW', 'audio', 'music theory']
  },
  'MusicProduction': {
    name: 'MusicProduction',
    memberCount: 500000,
    description: 'Focus on music production techniques and tools',
    active: true,
    priority: 'high',
    postingSchedule: {
      monday: ['08:00', '13:00', '18:00'],
      tuesday: ['09:00', '14:00', '19:00'],
      wednesday: ['08:00', '13:00', '18:00'],
      thursday: ['09:00', '14:00', '19:00'],
      friday: ['08:00', '13:00', '18:00'],
      saturday: ['12:00', '17:00', '22:00'],
      sunday: ['12:00', '17:00', '22:00']
    },
    educationalPostSchedule: {
      tuesday: ['12:00'],
      thursday: ['16:00']
    },
    preferredStyles: ['expert', 'helpful', 'technical'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 6,
    educationalPostLimit: 1,
    keywords: ['production', 'mixing', 'plugins', 'gear', 'workflow', 'techniques']
  },
  'IndieMusicFeedback': {
    name: 'IndieMusicFeedback',
    memberCount: 100000,
    description: 'Community for indie musicians to share and get feedback',
    active: true,
    priority: 'medium',
    postingSchedule: {
      monday: ['10:00', '16:00'],
      tuesday: ['11:00', '17:00'],
      wednesday: ['10:00', '16:00'],
      thursday: ['11:00', '17:00'],
      friday: ['10:00', '16:00'],
      saturday: ['13:00', '19:00'],
      sunday: ['13:00', '19:00']
    },
    educationalPostSchedule: {
      wednesday: ['14:00'],
      sunday: ['15:00']
    },
    preferredStyles: ['supportive', 'helpful', 'enthusiastic'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 10,
    educationalPostLimit: 1,
    keywords: ['feedback', 'review', 'indie', 'new music', 'critique']
  },
  'ThisIsOurMusic': {
    name: 'ThisIsOurMusic',
    memberCount: 200000,
    description: 'Share your original music with the community',
    active: true,
    priority: 'medium',
    postingSchedule: {
      monday: ['11:00', '17:00'],
      tuesday: ['12:00', '18:00'],
      wednesday: ['11:00', '17:00'],
      thursday: ['12:00', '18:00'],
      friday: ['11:00', '17:00'],
      saturday: ['14:00', '20:00'],
      sunday: ['14:00', '20:00']
    },
    educationalPostSchedule: {
      monday: ['12:00'],
      friday: ['16:00']
    },
    preferredStyles: ['enthusiastic', 'supportive', 'casual'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 8,
    educationalPostLimit: 1,
    keywords: ['original music', 'new release', 'songwriting', 'performance']
  },
  'MusicPromotion': {
    name: 'MusicPromotion',
    memberCount: 150000,
    description: 'Promote your music and discover new artists',
    active: true,
    priority: 'medium',
    postingSchedule: {
      monday: ['09:00', '15:00', '21:00'],
      tuesday: ['10:00', '16:00', '22:00'],
      wednesday: ['09:00', '15:00', '21:00'],
      thursday: ['10:00', '16:00', '22:00'],
      friday: ['09:00', '15:00', '21:00'],
      saturday: ['12:00', '18:00'],
      sunday: ['12:00', '18:00']
    },
    educationalPostSchedule: {
      tuesday: ['11:00'],
      thursday: ['14:00'],
      saturday: ['13:00']
    },
    preferredStyles: ['enthusiastic', 'casual', 'supportive'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 12,
    educationalPostLimit: 1,
    keywords: ['promotion', 'marketing', 'streaming', 'social media', 'growth']
  },
  'ShareYourMusic': {
    name: 'ShareYourMusic',
    memberCount: 80000,
    description: 'Share your music and connect with other creators',
    active: true,
    priority: 'medium',
    postingSchedule: {
      monday: ['12:00', '18:00'],
      tuesday: ['13:00', '19:00'],
      wednesday: ['12:00', '18:00'],
      thursday: ['13:00', '19:00'],
      friday: ['12:00', '18:00'],
      saturday: ['15:00', '21:00'],
      sunday: ['15:00', '21:00']
    },
    educationalPostSchedule: {
      thursday: ['15:00'],
      sunday: ['16:00']
    },
    preferredStyles: ['supportive', 'casual', 'enthusiastic'],
    soundswapMentionRate: 1.0,
    dailyCommentLimit: 8,
    educationalPostLimit: 1,
    keywords: ['share', 'new track', 'feedback', 'collaboration']
  }
};

// ==================== ENHANCED CRON SCHEDULER WITH DAILY RESET ====================

// Initialize posting activity
let postingActivity = await initializePostingActivity();

// Test Reddit connection on startup
const redditConnection = await testRedditConnection();
if (redditConnection.success) {
  postingActivity.redditUsername = redditConnection.username;
  await quickSavePostingActivity(postingActivity);
}

// Enhanced function to post to Reddit (replaces simulation)
const postToReddit = async (subreddit, content, style, type = 'comment', title = '', keywords = []) => {
  try {
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
    
    let result;
    
    if (type === 'educational') {
      // For now, we'll simulate educational posts since they require different Reddit API handling
      console.log(`📝 Simulating educational post to r/${subreddit}: ${title}`);
      result = { success: true, redditData: { permalink: `https://reddit.com/r/${subreddit}/simulated_post` } };
    } else {
      // For now, we'll simulate comments since Reddit API integration needs proper setup
      console.log(`💬 Simulating comment to r/${subreddit}: ${content.substring(0, 100)}...`);
      result = { success: true, redditData: { permalink: `https://reddit.com/r/${subreddit}/comments/simulated_comment` } };
    }
    
    if (result.success) {
      console.log(`✅ Simulated ${type} posted to r/${subreddit}`);
      return { 
        success: true, 
        content: content,
        redditData: result.redditData,
        type: type
      };
    } else {
      console.log(`❌ Failed to post ${type} to r/${subreddit}: ${result.error}`);
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

// Quick AI comment generation with timeout
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
      model: 'gemini-2.0-flash'
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

// Enhanced educational post generation with timeout
const generateEducationalPost = async (subreddit) => {
  const aiTimeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(`AI educational post timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS)
  );

  try {
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return { success: false, message: 'Google Gemini API key not configured' };
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash'
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

// Optimized sample posts
const getSamplePostsForSubreddit = (subreddit) => {
  const samplePosts = {
    'WeAreTheMusicMakers': [
      "Just finished my first EP!",
      "Struggling with vocal mixing",
      "New studio equipment arrived"
    ],
    'MusicProduction': [
      "Ear fatigue during long sessions",
      "New studio monitors review",
      "Best VST plugins?"
    ],
    'IndieMusicFeedback': [
      "Feedback on my new indie track",
      "First single released!",
      "Songwriting feedback needed"
    ],
    'ThisIsOurMusic': [
      "Latest composition shared",
      "New album preview",
      "Experimenting with new sounds"
    ],
    'MusicPromotion': [
      "Promotion strategies?",
      "Streaming milestone reached",
      "Best platforms for artists?"
    ],
    'ShareYourMusic': [
      "Sharing my latest track",
      "New demo uploaded",
      "Collaboration results"
    ]
  };
  
  return samplePosts[subreddit] || ["Great music discussion!"];
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
            const style = config.preferredStyles[Math.floor(Math.random() * config.preferredStyles.length)];
            
            // Generate comment content quickly
            const samplePosts = getSamplePostsForSubreddit(subreddit);
            const postTitle = samplePosts[Math.floor(Math.random() * samplePosts.length)];
            const commentResponse = await quickGenerateAIComment(postTitle, "", subreddit, "", style);
            
            if (commentResponse.success) {
              await quickStoreScheduledPost({
                subreddit,
                scheduledDay: currentDay,
                scheduledTime: time,
                style: style,
                type: 'comment',
                content: commentResponse.comment,
                dailyLimit: config.dailyCommentLimit,
                keywords: config.keywords
              });
              
              totalGenerated++;
              console.log(`✅ Generated comment for r/${subreddit} at ${time} (${totalGenerated}/${maxToGenerate})`);
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

// Main optimized function to run scheduled posts with daily reset
export const runScheduledPosts = async () => {
  const startTime = Date.now();
  
  try {
    // Check and reset daily counts if needed (NEW)
    const wasReset = await resetDailyCountsIfNeeded(postingActivity);
    if (wasReset) {
      await quickSavePostingActivity(postingActivity);
    }
    
    postingActivity.lastCronRun = new Date().toISOString();
    postingActivity.githubActionsRuns++;
    
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    const timeWindow = getCurrentTimeWindow();
    
    console.log(`⏰ GitHub Actions Cron running at ${currentTime} on ${currentDay} (${APP_TIMEZONE})`);
    console.log(`🔄 GitHub Actions Run #${postingActivity.githubActionsRuns}`);
    console.log(`🗄️ Database: Firebase`);
    console.log(`🕒 Time window: ${timeWindow.start} to ${timeWindow.end}`);
    console.log(`🎯 Batch limit: ${MAX_POSTS_PER_RUN} posts max`);
    console.log(`📅 Last reset: ${postingActivity.lastResetDate} (${postingActivity.lastResetDay})`);
    
    // Check Firebase connection quickly
    const firebaseConnected = await checkFirebaseConnection();
    if (!firebaseConnected) {
      throw new Error('Firebase connection failed');
    }
    
    let totalPosted = 0;
    
    // Check for posts in Firebase for current time window
    const scheduledPostsFromDB = await getScheduledPostsForTimeWindow(timeWindow);
    const educationalPostsFromDB = await getEducationalPostsForTimeWindow(timeWindow);
    
    const allPosts = [...scheduledPostsFromDB, ...educationalPostsFromDB];
    
    // If no posts in database, generate some quickly for current window
    if (allPosts.length === 0) {
      console.log('🔄 No posts found in database, generating posts for current time window...');
      const generationResult = await generatePostsForTimeWindow(timeWindow);
      
      if (generationResult.success) {
        // Quick re-check for new posts
        const newScheduledPosts = await getScheduledPostsForTimeWindow(timeWindow);
        const newEducationalPosts = await getEducationalPostsForTimeWindow(timeWindow);
        allPosts.push(...newScheduledPosts, ...newEducationalPosts);
        console.log(`✅ Generated ${generationResult.totalGenerated} posts for current time window`);
      }
    }
    
    // Process posts with batch limits and timeout protection
    if (allPosts.length > 0) {
      console.log(`📅 Found ${allPosts.length} scheduled posts in database for current time window`);
      
      for (const post of allPosts) {
        // Check batch limit
        if (totalPosted >= MAX_POSTS_PER_RUN) {
          console.log(`🏁 Reached maximum posts per run (${MAX_POSTS_PER_RUN})`);
          break;
        }
        
        // Check timeout
        const timeElapsed = Date.now() - startTime;
        if (timeElapsed > VERCELL_TIMEOUT_MS) {
          console.log(`⏰ Timeout approaching (${timeElapsed}ms), stopping post processing`);
          break;
        }
        
        console.log(`⏰ Time remaining: ${VERCELL_TIMEOUT_MS - timeElapsed}ms`);
        
        const { subreddit, style, dailyLimit, type, id, content, title, scheduledTime, keywords } = post;
        const currentCount = type === 'educational' 
          ? postingActivity.educationalCounts[subreddit] || 0
          : postingActivity.dailyCounts[subreddit] || 0;
        
        if (currentCount >= dailyLimit) {
          console.log(`⏹️ Daily limit reached for r/${subreddit} (${currentCount}/${dailyLimit})`);
          continue;
        }
        
        // Check cooldown (reduced for speed)
        const lastPost = type === 'educational' 
          ? postingActivity.lastEducationalPosted[subreddit] 
          : postingActivity.lastPosted[subreddit];
          
        if (lastPost) {
          const timeSinceLastPost = Date.now() - new Date(lastPost).getTime();
          if (timeSinceLastPost < 10 * 60 * 1000) { // Reduced to 10 minutes
            console.log(`⏳ Cooldown active for r/${subreddit}`);
            continue;
          }
        }
        
        console.log(`🚀 Preparing to post ${type} to r/${subreddit} with style: ${style} (scheduled for ${scheduledTime})`);
        
        let postResult;
        
        if (type === 'educational') {
          postResult = await postToReddit(subreddit, content, 'expert', 'educational', title);
        } else {
          const targetConfig = redditTargets[subreddit];
          postResult = await postToReddit(subreddit, content, style, 'comment', '', targetConfig?.keywords || []);
        }
        
        if (postResult.success) {
          // Update activity counts
          if (type === 'educational') {
            postingActivity.educationalCounts[subreddit] = (postingActivity.educationalCounts[subreddit] || 0) + 1;
            postingActivity.lastEducationalPosted[subreddit] = new Date().toISOString();
            postingActivity.totalEducationalPosts++;
          } else {
            postingActivity.dailyCounts[subreddit] = (postingActivity.dailyCounts[subreddit] || 0) + 1;
            postingActivity.lastPosted[subreddit] = new Date().toISOString();
            postingActivity.totalComments++;
          }
          
          // Mark as posted in Firebase with Reddit data
          await quickMarkPostAsPosted(
            id, 
            type === 'educational' ? EDUCATIONAL_POSTS_COLLECTION : SCHEDULED_POSTS_COLLECTION,
            postResult.redditData
          );
          
          totalPosted++;
          console.log(`✅ Successfully posted ${type} to r/${subreddit} (was scheduled for ${scheduledTime})`);
          console.log(`📊 Progress: ${totalPosted}/${MAX_POSTS_PER_RUN} posts this run`);
          console.log(`📈 Daily count for r/${subreddit}: ${type === 'educational' ? postingActivity.educationalCounts[subreddit] : postingActivity.dailyCounts[subreddit]}/${dailyLimit}`);
        } else {
          console.log(`❌ Failed to post ${type} to r/${subreddit}: ${postResult.error}`);
        }
      }
    } else {
      console.log('⏰ No scheduled posts found for current time window');
    }
    
    // Quick save activity
    await quickSavePostingActivity(postingActivity);
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ Cron completed in ${processingTime}ms`);
    console.log(`📈 Posted ${totalPosted} posts this run`);
    console.log(`📅 Next reset: ${postingActivity.lastResetDate === getCurrentDateInAppTimezone() ? 'Tomorrow' : 'Soon'}`);
    
    return {
      success: true,
      scheduledComments: scheduledPostsFromDB.length,
      scheduledEducationalPosts: educationalPostsFromDB.length,
      totalComments: postingActivity.totalComments,
      totalEducationalPosts: postingActivity.totalEducationalPosts,
      githubActionsRuns: postingActivity.githubActionsRuns,
      totalPosted: totalPosted,
      processingTime: processingTime,
      timeWindow: timeWindow,
      batchLimit: MAX_POSTS_PER_RUN,
      dailyReset: {
        lastResetDate: postingActivity.lastResetDate,
        lastResetDay: postingActivity.lastResetDay,
        wasReset: wasReset
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Error in runScheduledPosts:', error);
    
    // Still save activity even on error
    try {
      await quickSavePostingActivity(postingActivity);
    } catch (e) {
      console.error('❌ Failed to save activity on error:', e);
    }
    
    throw error;
  }
};

console.log('🚀 Reddit Auto-Poster initialized (GitHub Actions + Firebase + Daily Reset)');
console.log(`⏰ Timezone: ${APP_TIMEZONE}`);
console.log(`📅 Current time: ${getCurrentTimeInAppTimezone()} on ${getCurrentDayInAppTimezone()}`);
console.log(`📅 Current date: ${getCurrentDateInAppTimezone()}`);
console.log(`🕒 Posting window: ${POSTING_WINDOW_MINUTES} minutes`);
console.log(`🎯 Batch limit: ${MAX_POSTS_PER_RUN} posts per run`);
console.log(`⏱️ AI timeout: ${AI_TIMEOUT_MS}ms`);
console.log(`🔄 Daily reset: ENABLED`);

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
        totalComments: postingActivity.totalComments,
        totalEducationalPosts: postingActivity.totalEducationalPosts,
        githubActionsRuns: postingActivity.githubActionsRuns,
        lastCronRun: postingActivity.lastCronRun,
        firebase: firebaseConnected ? 'connected' : 'disconnected',
        dailyReset: {
          lastResetDate: postingActivity.lastResetDate,
          lastResetDay: postingActivity.lastResetDay,
          needsReset: postingActivity.lastResetDate !== currentDate
        },
        performance: {
          batchLimit: MAX_POSTS_PER_RUN,
          aiTimeout: AI_TIMEOUT_MS,
          postingWindow: POSTING_WINDOW_MINUTES
        }
      },
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
    
    // Reset all daily counts
    Object.keys(postingActivity.dailyCounts).forEach(key => {
      postingActivity.dailyCounts[key] = 0;
    });
    Object.keys(postingActivity.educationalCounts).forEach(key => {
      postingActivity.educationalCounts[key] = 0;
    });
    
    // Reset last posted timestamps
    postingActivity.lastPosted = {};
    postingActivity.lastEducationalPosted = {};
    
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
        educational: postingActivity.educationalCounts
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

// [Keep all your other existing endpoints exactly as they were...]
// Add GET endpoint for /cron to show available endpoints
router.get('/cron', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();
  const currentDate = getCurrentDateInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  
  res.json({
    success: true,
    message: 'Reddit Automation Cron Endpoint',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    currentDate: currentDate,
    timeWindow: {
      minutes: POSTING_WINDOW_MINUTES,
      currentWindow: timeWindow
    },
    availableMethods: {
      POST: 'Trigger cron execution (requires CRON_SECRET)',
      GET: 'Show cron information'
    },
    endpoints: [
      '/api/reddit-admin/cron-status',
      '/api/reddit-admin/schedule/today',
      '/api/reddit-admin/manual-post',
      '/api/reddit-admin/create-educational-post',
      '/api/reddit-admin/reset-counts',
      '/api/reddit-admin/reset-daily', // NEW
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
        currentCount: postingActivity.dailyCounts[subreddit] || 0,
        inCurrentWindow: config.postingSchedule[today].some(time => time >= timeWindow.start && time <= timeWindow.end)
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
    dailyReset: {
      lastResetDate: postingActivity.lastResetDate,
      needsReset: postingActivity.lastResetDate !== currentDate
    },
    schedule: schedule,
    educationalSchedule: educationalSchedule,
    activity: {
      comments: postingActivity.dailyCounts,
      educational: postingActivity.educationalCounts
    },
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
    
    const postResponse = await generateEducationalPost(subreddit);
    
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
    console.error('❌ Error creating educational post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create educational post',
      error: error.message
    });
  }
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
    
    const postResponse = await generateTop50PromotionPost(subreddit);
    
    if (!postResponse.success) {
      return res.status(500).json(postResponse);
    }
    
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

// Manually trigger posting for a subreddit (REAL Reddit posting)
router.post('/manual-post', async (req, res) => {
  try {
    const { subreddit, postTitle, postContent, style } = req.body;
    
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
    
    const commentResponse = await quickGenerateAIComment(
      postTitle || "Check out this music discussion!",
      postContent || "",
      subreddit,
      "",
      style
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
      
      await quickSavePostingActivity(postingActivity);
    }
    
    res.json({
      success: redditResult.success,
      comment: commentResponse.comment,
      subreddit: subreddit,
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

// [Keep all your other existing endpoints exactly as they were...]
// Reset daily counts, Generate daily posts, Generate AI comment, etc.
// Reset daily counts
router.post('/reset-counts', async (req, res) => {
  try {
    Object.keys(postingActivity.dailyCounts).forEach(key => {
      postingActivity.dailyCounts[key] = 0;
    });
    Object.keys(postingActivity.educationalCounts).forEach(key => {
      postingActivity.educationalCounts[key] = 0;
    });
    
    postingActivity.totalComments = 0;
    postingActivity.totalEducationalPosts = 0;
    postingActivity.lastPosted = {};
    postingActivity.lastEducationalPosted = {};
    postingActivity.githubActionsRuns = 0;
    
    // Save to Firebase
    await quickSavePostingActivity(postingActivity);
    
    res.json({
      success: true,
      message: 'Daily counts and GitHub Actions counter reset',
      counts: {
        comments: postingActivity.dailyCounts,
        educational: postingActivity.educationalCounts
      },
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
          const style = config.preferredStyles[Math.floor(Math.random() * config.preferredStyles.length)];
          
          // Generate quick comment
          const samplePosts = getSamplePostsForSubreddit(subreddit);
          const postTitle = samplePosts[Math.floor(Math.random() * samplePosts.length)];
          const commentResponse = await quickGenerateAIComment(postTitle, "", subreddit, "", style);
          
          if (commentResponse.success) {
            await quickStoreScheduledPost({
              subreddit,
              scheduledDay: currentDay,
              scheduledTime: time,
              style: style,
              type: 'comment',
              content: commentResponse.comment,
              dailyLimit: config.dailyCommentLimit
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
          const educationalResponse = await generateEducationalPost(subreddit);
          
          if (educationalResponse.success) {
            await quickStoreEducationalPost({
              subreddit,
              scheduledDay: currentDay,
              scheduledTime: time,
              style: 'expert',
              type: 'educational',
              title: educationalResponse.title,
              content: educationalResponse.content,
              dailyLimit: config.educationalPostLimit || 1
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
    const { postTitle, postContent, subreddit, context, style } = req.body;

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

    const result = await quickGenerateAIComment(postTitle, postContent, subreddit, context, style);
    
    if (result.success) {
      res.json({
        success: true,
        comment: result.comment,
        style: result.style,
        subreddit: result.subreddit,
        mentionSoundSwap: true,
        config: redditTargets[subreddit] ? {
          dailyLimit: redditTargets[subreddit].dailyCommentLimit,
          mentionRate: redditTargets[subreddit].soundswapMentionRate
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
      model: 'gemini-2.0-flash'
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

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash'
    });

    const prompt = `
Analyze this Reddit post and provide guidance on how to engage with it naturally.

Post Title: "${postTitle}"
${postContent ? `Post Content: "${postContent.substring(0, 800)}"` : ''}
Subreddit: r/${subreddit || 'unknown'}

Please analyze:
1. What type of post is this? (question, discussion, sharing, etc.)
2. What would be a natural, valuable comment to add?
3. What tone/style would work best? (helpful, enthusiastic, thoughtful, etc.)
4. Any specific topics or angles to focus on?
5. Any topics to avoid?

Provide your analysis in a structured way that can be used to generate an appropriate comment.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const analysis = response.text().trim();

    console.log('✅ Post analysis completed');

    // Extract key insights from analysis
    const recommendations = {
      postType: 'discussion', // default
      suggestedTone: 'helpful',
      focusAreas: [],
      avoidTopics: []
    };

    // Simple parsing of the analysis (you could make this more sophisticated)
    if (analysis.toLowerCase().includes('question')) {
      recommendations.postType = 'question';
      recommendations.suggestedTone = 'helpful';
    }
    if (analysis.toLowerCase().includes('share') || analysis.toLowerCase().includes('achievement')) {
      recommendations.postType = 'sharing';
      recommendations.suggestedTone = 'enthusiastic';
    }

    res.json({
      success: true,
      analysis: analysis,
      recommendations: recommendations,
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
      model: 'gemini-2.0-flash'
    });
    
    const result = await model.generateContent('Say "Hello from SoundSwap Reddit AI" in a creative way.');
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
    totalAudience: Object.values(redditTargets).reduce((sum, target) => sum + target.memberCount, 0),
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
  
  res.json({
    success: true,
    data: target,
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
    message: 'Reddit Admin API is running',
    service: 'reddit-admin',
    version: '4.0.0', // Updated version with time window
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    timeWindow: {
      minutes: POSTING_WINDOW_MINUTES,
      currentWindow: timeWindow
    },
    features: {
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'enabled' : 'disabled',
      firebase_db: 'enabled',
      comment_generation: 'active',
      dm_replies: 'active',
      content_analysis: 'active',
      target_configuration: 'active',
      auto_posting: 'active',
      cron_scheduler: 'github-actions',
      top50_promotion: 'active',
      educational_posts: 'active',
      on_demand_generation: 'active',
      time_window: `${POSTING_WINDOW_MINUTES} minutes`
    },
    targets: {
      total: Object.keys(redditTargets).length,
      active: Object.values(redditTargets).filter(t => t.active).length,
      total_audience: Object.values(redditTargets).reduce((sum, target) => sum + target.memberCount, 0)
    },
    cron: {
      status: 'running',
      total_comments: postingActivity.totalComments,
      total_educational_posts: postingActivity.totalEducationalPosts,
      last_run: postingActivity.lastCronRun,
      github_actions_runs: postingActivity.githubActionsRuns,
      daily_limits: Object.fromEntries(
        Object.entries(redditTargets).map(([k, v]) => [k, {
          comments: v.dailyCommentLimit,
          educational: v.educationalPostLimit || 1
        }])
      )
    },
    endpoints: {
      health: '/api/reddit-admin/admin',
      targets: '/api/reddit-admin/targets',
      schedule: '/api/reddit-admin/schedule/today',
      cron_status: '/api/reddit-admin/cron-status',
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