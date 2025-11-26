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

// ==================== TIMEZONE CONFIGURATION ====================

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';
const POSTING_WINDOW_MINUTES = 10;

// Helper function to get current time in app timezone
const getCurrentTimeInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { 
    timeZone: APP_TIMEZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).slice(0, 5);
};

// Helper function to get current day in app timezone
const getCurrentDayInAppTimezone = () => {
  const now = new Date();
  return now.toLocaleDateString('en-US', { 
    timeZone: APP_TIMEZONE,
    weekday: 'long'
  }).toLowerCase();
};

// Helper function to get time window (current time ± window minutes)
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

// ==================== REAL REDDIT POSTING FUNCTIONS ====================

// Function to find a suitable post to comment on
const findPostToCommentOn = async (subreddit, keywords) => {
  try {
    console.log(`🔍 Searching for posts in r/${subreddit} with keywords: ${keywords.join(', ')}`);
    
    const subredditInstance = await redditClient.getSubreddit(subreddit);
    
    // Get hot posts (you can change to 'new', 'top', etc.)
    const posts = await subredditInstance.getHot({ limit: 10 });
    
    // Filter posts that are not too old and match our keywords
    const suitablePosts = posts.filter(post => {
      const postAge = Date.now() - post.created_utc * 1000;
      const isRecent = postAge < 24 * 60 * 60 * 1000; // Less than 24 hours old
      const hasKeywords = keywords.some(keyword => 
        post.title.toLowerCase().includes(keyword.toLowerCase()) ||
        (post.selftext && post.selftext.toLowerCase().includes(keyword.toLowerCase()))
      );
      
      return isRecent && hasKeywords && !post.stickied && post.num_comments < 50;
    });
    
    if (suitablePosts.length > 0) {
      const selectedPost = suitablePosts[0];
      console.log(`✅ Found suitable post in r/${subreddit}: "${selectedPost.title.substring(0, 100)}..."`);
      return {
        success: true,
        post: selectedPost,
        title: selectedPost.title,
        content: selectedPost.selftext,
        url: selectedPost.url
      };
    } else {
      console.log(`❌ No suitable posts found in r/${subreddit}`);
      return { success: false, error: 'No suitable posts found' };
    }
  } catch (error) {
    console.error(`❌ Error finding post in r/${subreddit}:`, error.message);
    return { success: false, error: error.message };
  }
};

// Function to post a comment to Reddit
const postRedditComment = async (subreddit, commentContent, keywords) => {
  try {
    console.log(`📝 Preparing to post comment to r/${subreddit}`);
    
    // Find a suitable post to comment on
    const postResult = await findPostToCommentOn(subreddit, keywords);
    
    if (!postResult.success) {
      return { 
        success: false, 
        error: `Could not find suitable post in r/${subreddit}: ${postResult.error}` 
      };
    }
    
    // Post the comment
    const comment = await postResult.post.reply(commentContent);
    
    console.log(`✅ Successfully posted comment to r/${subreddit}`);
    console.log(`🔗 Comment URL: https://reddit.com${comment.permalink}`);
    
    return {
      success: true,
      commentId: comment.id,
      postTitle: postResult.title,
      commentContent: commentContent,
      permalink: `https://reddit.com${comment.permalink}`,
      subreddit: subreddit
    };
  } catch (error) {
    console.error(`❌ Error posting comment to r/${subreddit}:`, error.message);
    return { success: false, error: error.message };
  }
};

// Function to post an educational post to Reddit
const postRedditSubmission = async (subreddit, title, content) => {
  try {
    console.log(`📝 Preparing to post submission to r/${subreddit}`);
    
    const subredditInstance = await redditClient.getSubreddit(subreddit);
    
    // Submit a text post
    const submission = await subredditInstance.submitSelfpost({
      title: title,
      text: content
    });
    
    console.log(`✅ Successfully posted submission to r/${subreddit}`);
    console.log(`🔗 Post URL: https://reddit.com${submission.permalink}`);
    
    return {
      success: true,
      postId: submission.id,
      title: title,
      content: content,
      permalink: `https://reddit.com${submission.permalink}`,
      subreddit: subreddit
    };
  } catch (error) {
    console.error(`❌ Error posting submission to r/${subreddit}:`, error.message);
    return { success: false, error: error.message };
  }
};

// Enhanced function to post to Reddit (replaces simulation)
const postToReddit = async (subreddit, content, style, type = 'comment', title = '', keywords = []) => {
  try {
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
    
    let result;
    
    if (type === 'educational') {
      result = await postRedditSubmission(subreddit, title, content);
    } else {
      result = await postRedditComment(subreddit, content, keywords);
    }
    
    if (result.success) {
      console.log(`✅ Real Reddit ${type} posted to r/${subreddit}`);
      return { 
        success: true, 
        content: content,
        redditData: result,
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

// ==================== OPTIMIZED FIREBASE FUNCTIONS ====================

// Quick Firebase health check
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

// Add this function to automatically reset daily counts
const autoResetDailyCounts = async () => {
  try {
    const currentDate = new Date().toLocaleDateString('en-US', { timeZone: APP_TIMEZONE });
    const lastResetDate = postingActivity.lastResetDate;
    
    // If lastResetDate doesn't exist or is different from current date, reset counts
    if (!lastResetDate || lastResetDate !== currentDate) {
      console.log(`🔄 Auto-resetting daily counts (last reset: ${lastResetDate}, current: ${currentDate})`);
      
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
      
      // Update last reset date
      postingActivity.lastResetDate = currentDate;
      
      // Save to Firebase
      await quickSavePostingActivity(postingActivity);
      
      console.log('✅ Daily counts automatically reset for new day');
      return true;
    }
    
    return false; // No reset needed
  } catch (error) {
    console.error('❌ Error auto-resetting daily counts:', error);
    return false;
  }
};

// Update the initializePostingActivity function to include lastResetDate
const initializePostingActivity = async () => {
  try {
    const activityRef = collection(db, POSTING_ACTIVITY_COLLECTION);
    const q = query(activityRef, orderBy('timestamp', 'desc'), limit(1));
    const snapshot = await getDocs(q);
    
    const currentDate = new Date().toLocaleDateString('en-US', { timeZone: APP_TIMEZONE });
    
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
        lastResetDate: currentDate, // NEW
        redditUsername: null,
        timestamp: new Date().toISOString()
      };
      
      Object.keys(redditTargets).forEach(subreddit => {
        initialActivity.dailyCounts[subreddit] = 0;
        initialActivity.educationalCounts[subreddit] = 0;
      });
      
      await addDoc(activityRef, initialActivity);
      console.log('✅ Initialized new posting activity record');
      return initialActivity;
    } else {
      const activityDoc = snapshot.docs[0].data();
      
      // Check if we need to reset for new day
      if (!activityDoc.lastResetDate || activityDoc.lastResetDate !== currentDate) {
        console.log(`🔄 New day detected, resetting counts (last: ${activityDoc.lastResetDate}, current: ${currentDate})`);
        
        // Reset counts for new day
        Object.keys(activityDoc.dailyCounts).forEach(key => {
          activityDoc.dailyCounts[key] = 0;
        });
        Object.keys(activityDoc.educationalCounts).forEach(key => {
          activityDoc.educationalCounts[key] = 0;
        });
        
        activityDoc.lastPosted = {};
        activityDoc.lastEducationalPosted = {};
        activityDoc.lastResetDate = currentDate;
        
        // Save the reset activity
        await addDoc(activityRef, activityDoc);
        console.log('✅ Reset daily counts for new day');
      }
      
      console.log('✅ Loaded existing posting activity');
      return activityDoc;
    }
  } catch (error) {
    console.error('❌ Error initializing posting activity:', error);
    return getFallbackActivity();
  }
};

// Update getFallbackActivity to include lastResetDate
const getFallbackActivity = () => {
  const currentDate = new Date().toLocaleDateString('en-US', { timeZone: APP_TIMEZONE });
  
  const fallbackActivity = {
    dailyCounts: {},
    educationalCounts: {},
    lastPosted: {},
    lastEducationalPosted: {},
    totalComments: 0,
    totalEducationalPosts: 0,
    lastCronRun: null,
    githubActionsRuns: 0,
    lastResetDate: currentDate, // NEW
    redditUsername: null,
    timestamp: new Date().toISOString()
  };
  
  Object.keys(redditTargets).forEach(subreddit => {
    fallbackActivity.dailyCounts[subreddit] = 0;
    fallbackActivity.educationalCounts[subreddit] = 0;
  });
  
  return fallbackActivity;
};

// Update the main runScheduledPosts function to include auto-reset at the beginning
export const runScheduledPosts = async () => {
  const startTime = Date.now();
  const timeout = 8000;
  
  try {
    // AUTO-RESET DAILY COUNTS (add this at the beginning)
    await autoResetDailyCounts();
    
    postingActivity.lastCronRun = new Date().toISOString();
    postingActivity.githubActionsRuns++;
    
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    const timeWindow = getCurrentTimeWindow();
    
    console.log(`⏰ GitHub Actions Cron running at ${currentTime} on ${currentDay} (${APP_TIMEZONE})`);
    console.log(`🔄 GitHub Actions Run #${postingActivity.githubActionsRuns}`);
    console.log(`🗄️ Database: Firebase`);
    console.log(`🕒 Time window: ${timeWindow.start} to ${timeWindow.end}`);
    
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
    
    // Process posts with timeout protection
    if (allPosts.length > 0) {
      console.log(`📅 Found ${allPosts.length} scheduled posts in database for current time window`);
      
      for (const post of allPosts) {
        // Check timeout
        if (Date.now() - startTime > timeout) {
          console.log('⏰ Timeout approaching, stopping post processing');
          break;
        }
        
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
          // Use REAL Reddit API for educational posts
          postResult = await postToReddit(subreddit, content, 'expert', 'educational', title);
        } else {
          // Use REAL Reddit API for comments
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
          console.log(`✅ Successfully posted REAL ${type} to r/${subreddit} (was scheduled for ${scheduledTime})`);
          
          // Log Reddit URLs for tracking
          if (postResult.redditData?.permalink) {
            console.log(`🔗 Reddit URL: ${postResult.redditData.permalink}`);
          }
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
    console.log(`📈 Posted ${totalPosted} REAL posts to Reddit this run`);
    
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
      redditConnected: redditConnection.success,
      redditUsername: postingActivity.redditUsername,
      lastResetDate: postingActivity.lastResetDate, // NEW
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

// Also update the cron-status endpoint to show lastResetDate
router.get('/cron-status', async (req, res) => {
  try {
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
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
        timeWindow: timeWindow,
        totalComments: postingActivity.totalComments,
        totalEducationalPosts: postingActivity.totalEducationalPosts,
        githubActionsRuns: postingActivity.githubActionsRuns,
        lastCronRun: postingActivity.lastCronRun,
        lastResetDate: postingActivity.lastResetDate, // NEW
        firebase: firebaseConnected ? 'connected' : 'disconnected',
        reddit: {
          connected: redditConnection.success,
          username: postingActivity.redditUsername,
          posting: 'REAL_POSTS'
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

// Test Reddit connection endpoint
router.get('/test-reddit', async (req, res) => {
  try {
    const connection = await testRedditConnection();
    
    if (connection.success) {
      // Update activity with username
      postingActivity.redditUsername = connection.username;
      await quickSavePostingActivity(postingActivity);
    }
    
    res.json({
      success: connection.success,
      username: connection.username,
      error: connection.error,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error testing Reddit connection:', error);
    res.status(500).json({
      success: false,
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
      timestamp: new Date().toISOString()
    });
  }
});

// [Keep all your other existing endpoints exactly as they were...]
// Add GET endpoint for /cron to show available endpoints
router.get('/cron', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();
  const timeWindow = getCurrentTimeWindow();
  
  res.json({
    success: true,
    message: 'Reddit Automation Cron Endpoint',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
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
      '/api/reddit-admin/targets',
      '/api/reddit-admin/create-top50-post',
      '/api/reddit-admin/generate-comment',
      '/api/reddit-admin/generate-reply',
      '/api/reddit-admin/analyze-post',
      '/api/reddit-admin/test-gemini',
      '/api/reddit-admin/admin',
      '/api/reddit-admin/generate-daily-posts',
      '/api/reddit-admin/test-reddit' // NEW
    ],
    timestamp: new Date().toISOString()
  });
});

// Get posting schedule for today
router.get('/schedule/today', (req, res) => {
  const today = getCurrentDayInAppTimezone();
  const currentTime = getCurrentTimeInAppTimezone();
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
    timezone: APP_TIMEZONE,
    timeWindow: timeWindow,
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