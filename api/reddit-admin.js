import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, where, updateDoc, doc, orderBy, limit } from 'firebase/firestore';

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

// Initialize Firebase only if config is available
let db = null;
let firebaseApp = null;

try {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    console.log('✅ Firebase initialized successfully');
  } else {
    console.log('⚠️ Firebase configuration missing, using in-memory storage');
  }
} catch (error) {
  console.error('❌ Firebase initialization failed:', error);
}

// Collections
const SCHEDULED_POSTS_COLLECTION = 'scheduledPosts';
const EDUCATIONAL_POSTS_COLLECTION = 'educationalPosts';
const POSTING_ACTIVITY_COLLECTION = 'postingActivity';

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// ==================== TIMEZONE CONFIGURATION ====================

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';

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

// ==================== FIREBASE FUNCTIONS ====================

// In-memory storage as fallback
let inMemoryPosts = {
  scheduled: [],
  educational: []
};

let postingActivity = {
  dailyCounts: {},
  educationalCounts: {},
  lastPosted: {},
  lastEducationalPosted: {},
  totalComments: 0,
  totalEducationalPosts: 0,
  lastCronRun: null,
  githubActionsRuns: 0
};

// Initialize counts
Object.keys(redditTargets).forEach(subreddit => {
  postingActivity.dailyCounts[subreddit] = 0;
  postingActivity.educationalCounts[subreddit] = 0;
});

// Store scheduled post
const storeScheduledPost = async (postData) => {
  try {
    if (db) {
      const postsRef = collection(db, SCHEDULED_POSTS_COLLECTION);
      const docRef = await addDoc(postsRef, {
        ...postData,
        createdAt: new Date().toISOString(),
        posted: false,
        postedAt: null
      });
      console.log(`✅ Stored scheduled post in Firebase for r/${postData.subreddit} at ${postData.scheduledTime}`);
      return docRef.id;
    } else {
      // Fallback to in-memory storage
      inMemoryPosts.scheduled.push({
        ...postData,
        id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date().toISOString(),
        posted: false,
        postedAt: null
      });
      console.log(`✅ Stored scheduled post in memory for r/${postData.subreddit} at ${postData.scheduledTime}`);
      return inMemoryPosts.scheduled[inMemoryPosts.scheduled.length - 1].id;
    }
  } catch (error) {
    console.error('❌ Error storing scheduled post:', error);
    return null;
  }
};

// Store educational post
const storeEducationalPost = async (postData) => {
  try {
    if (db) {
      const postsRef = collection(db, EDUCATIONAL_POSTS_COLLECTION);
      const docRef = await addDoc(postsRef, {
        ...postData,
        createdAt: new Date().toISOString(),
        posted: false,
        postedAt: null
      });
      console.log(`✅ Stored educational post in Firebase for r/${postData.subreddit}`);
      return docRef.id;
    } else {
      // Fallback to in-memory storage
      inMemoryPosts.educational.push({
        ...postData,
        id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date().toISOString(),
        posted: false,
        postedAt: null
      });
      console.log(`✅ Stored educational post in memory for r/${postData.subreddit}`);
      return inMemoryPosts.educational[inMemoryPosts.educational.length - 1].id;
    }
  } catch (error) {
    console.error('❌ Error storing educational post:', error);
    return null;
  }
};

// Get scheduled posts for current time
const getScheduledPostsForCurrentTime = async () => {
  try {
    const currentDay = getCurrentDayInAppTimezone();
    const currentTime = getCurrentTimeInAppTimezone();
    
    if (db) {
      const postsRef = collection(db, SCHEDULED_POSTS_COLLECTION);
      const q = query(
        postsRef, 
        where('scheduledDay', '==', currentDay),
        where('scheduledTime', '==', currentTime),
        where('posted', '==', false)
      );
      
      const snapshot = await getDocs(q);
      const posts = [];
      
      snapshot.forEach(doc => {
        posts.push({ id: doc.id, ...doc.data() });
      });
      
      console.log(`📊 Found ${posts.length} scheduled posts in Firebase for ${currentTime} on ${currentDay}`);
      return posts;
    } else {
      // Fallback to in-memory storage
      const posts = inMemoryPosts.scheduled.filter(post => 
        post.scheduledDay === currentDay && 
        post.scheduledTime === currentTime && 
        !post.posted
      );
      console.log(`📊 Found ${posts.length} scheduled posts in memory for ${currentTime} on ${currentDay}`);
      return posts;
    }
  } catch (error) {
    console.error('❌ Error getting scheduled posts:', error);
    return [];
  }
};

// Get educational posts for current time
const getEducationalPostsForCurrentTime = async () => {
  try {
    const currentDay = getCurrentDayInAppTimezone();
    const currentTime = getCurrentTimeInAppTimezone();
    
    if (db) {
      const postsRef = collection(db, EDUCATIONAL_POSTS_COLLECTION);
      const q = query(
        postsRef, 
        where('scheduledDay', '==', currentDay),
        where('scheduledTime', '==', currentTime),
        where('posted', '==', false)
      );
      
      const snapshot = await getDocs(q);
      const posts = [];
      
      snapshot.forEach(doc => {
        posts.push({ id: doc.id, ...doc.data() });
      });
      
      console.log(`📊 Found ${posts.length} educational posts in Firebase for ${currentTime} on ${currentDay}`);
      return posts;
    } else {
      // Fallback to in-memory storage
      const posts = inMemoryPosts.educational.filter(post => 
        post.scheduledDay === currentDay && 
        post.scheduledTime === currentTime && 
        !post.posted
      );
      console.log(`📊 Found ${posts.length} educational posts in memory for ${currentTime} on ${currentDay}`);
      return posts;
    }
  } catch (error) {
    console.error('❌ Error getting educational posts:', error);
    return [];
  }
};

// Mark post as posted
const markPostAsPosted = async (postId, collectionName) => {
  try {
    if (db) {
      const postRef = doc(db, collectionName, postId);
      await updateDoc(postRef, {
        posted: true,
        postedAt: new Date().toISOString()
      });
      console.log(`✅ Marked post ${postId} as posted in Firebase`);
    } else {
      // Fallback to in-memory storage
      let posts;
      if (collectionName === SCHEDULED_POSTS_COLLECTION) {
        posts = inMemoryPosts.scheduled;
      } else {
        posts = inMemoryPosts.educational;
      }
      
      const postIndex = posts.findIndex(post => post.id === postId);
      if (postIndex !== -1) {
        posts[postIndex].posted = true;
        posts[postIndex].postedAt = new Date().toISOString();
        console.log(`✅ Marked post ${postId} as posted in memory`);
      }
    }
    return true;
  } catch (error) {
    console.error('❌ Error marking post as posted:', error);
    return false;
  }
};

// ==================== CRON SCHEDULER ====================

// Function to get current schedule for all active subreddits
const getCurrentSchedule = () => {
  const currentDay = getCurrentDayInAppTimezone();
  const currentTime = getCurrentTimeInAppTimezone();
  
  console.log(`🔍 Checking schedule for ${currentDay} at ${currentTime} (${APP_TIMEZONE})`);
  
  const scheduledPosts = [];
  
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active && config.postingSchedule[currentDay]) {
      const times = config.postingSchedule[currentDay];
      
      if (times.includes(currentTime)) {
        scheduledPosts.push({
          subreddit,
          time: currentTime,
          day: currentDay,
          style: config.preferredStyles[Math.floor(Math.random() * config.preferredStyles.length)],
          dailyLimit: config.dailyCommentLimit,
          currentCount: postingActivity.dailyCounts[subreddit] || 0,
          type: 'comment'
        });
        console.log(`✅ Found scheduled comment for r/${subreddit} at ${currentTime}`);
      }
    }
  });
  
  console.log(`📊 Total scheduled comments found: ${scheduledPosts.length}`);
  return scheduledPosts;
};

// Function to get current educational post schedule
const getCurrentEducationalSchedule = () => {
  const currentDay = getCurrentDayInAppTimezone();
  const currentTime = getCurrentTimeInAppTimezone();
  
  console.log(`🔍 Checking educational post schedule for ${currentDay} at ${currentTime}`);
  
  const scheduledPosts = [];
  
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active && config.educationalPostSchedule && config.educationalPostSchedule[currentDay]) {
      const times = config.educationalPostSchedule[currentDay];
      
      if (times.includes(currentTime)) {
        scheduledPosts.push({
          subreddit,
          time: currentTime,
          day: currentDay,
          style: 'expert',
          dailyLimit: config.educationalPostLimit || 1,
          currentCount: postingActivity.educationalCounts[subreddit] || 0,
          type: 'educational'
        });
        console.log(`✅ Found scheduled educational post for r/${subreddit} at ${currentTime}`);
      }
    }
  });
  
  console.log(`📊 Total scheduled educational posts found: ${scheduledPosts.length}`);
  return scheduledPosts;
};

// Function to simulate posting to Reddit
const simulateRedditPost = async (subreddit, content, style, type = 'comment') => {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
  
  // Simulate success (90% success rate)
  const success = Math.random() > 0.1;
  
  if (success) {
    if (type === 'educational') {
      postingActivity.educationalCounts[subreddit] = (postingActivity.educationalCounts[subreddit] || 0) + 1;
      postingActivity.lastEducationalPosted[subreddit] = new Date().toISOString();
      postingActivity.totalEducationalPosts++;
      console.log(`✅ Posted educational content to r/${subreddit} at ${getCurrentTimeInAppTimezone()}: ${content.substring(0, 100)}...`);
    } else {
      postingActivity.dailyCounts[subreddit] = (postingActivity.dailyCounts[subreddit] || 0) + 1;
      postingActivity.lastPosted[subreddit] = new Date().toISOString();
      postingActivity.totalComments++;
      console.log(`✅ Posted comment to r/${subreddit} at ${getCurrentTimeInAppTimezone()}: ${content.substring(0, 100)}...`);
    }
    
    return { success: true, content };
  } else {
    console.log(`❌ Failed to post to r/${subreddit}`);
    return { success: false, error: 'Simulated failure' };
  }
};

// Generate and store posts for the day
const generateDailyPosts = async () => {
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
          
          await storeScheduledPost({
            subreddit,
            scheduledDay: currentDay,
            scheduledTime: time,
            style: style,
            type: 'comment',
            dailyLimit: config.dailyCommentLimit
          });
          
          totalGenerated++;
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
            await storeEducationalPost({
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
    return { success: true, totalGenerated };
    
  } catch (error) {
    console.error('❌ Error generating daily posts:', error);
    return { success: false, error: error.message };
  }
};

// Main function to run scheduled posts
export const runScheduledPosts = async () => {
  try {
    postingActivity.lastCronRun = new Date().toISOString();
    postingActivity.githubActionsRuns++;
    
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    
    console.log(`⏰ GitHub Actions Cron running at ${currentTime} on ${currentDay} (${APP_TIMEZONE})`);
    console.log(`🔄 GitHub Actions Run #${postingActivity.githubActionsRuns}`);
    console.log(`🗄️ Database: ${db ? 'Firebase' : 'In-Memory'}`);
    
    // Check for posts in database first
    const scheduledPostsFromDB = await getScheduledPostsForCurrentTime();
    const educationalPostsFromDB = await getEducationalPostsForCurrentTime();
    
    let totalPosted = 0;
    
    // Process posts from database
    if (scheduledPostsFromDB.length > 0 || educationalPostsFromDB.length > 0) {
      console.log(`📅 Found ${scheduledPostsFromDB.length + educationalPostsFromDB.length} scheduled posts in database`);
      
      // Process regular comments
      for (const post of scheduledPostsFromDB) {
        const { subreddit, style, dailyLimit } = post;
        const currentCount = postingActivity.dailyCounts[subreddit] || 0;
        
        if (currentCount >= dailyLimit) {
          console.log(`⏹️ Daily limit reached for r/${subreddit} (${currentCount}/${dailyLimit})`);
          continue;
        }
        
        // Check cooldown
        const lastPost = postingActivity.lastPosted[subreddit];
        if (lastPost) {
          const timeSinceLastPost = Date.now() - new Date(lastPost).getTime();
          if (timeSinceLastPost < 30 * 60 * 1000) {
            console.log(`⏳ Cooldown active for r/${subreddit}`);
            continue;
          }
        }
        
        console.log(`🚀 Preparing to post comment to r/${subreddit} with style: ${style}`);
        
        // Generate sample post content for comment context
        const samplePosts = {
          'WeAreTheMusicMakers': [
            "Just finished my first EP after 6 months of work!",
            "Struggling with vocal mixing - any tips?",
            "What's your favorite piece of music production equipment?"
          ],
          'MusicProduction': [
            "How do you deal with ear fatigue during long sessions?",
            "Just got new studio monitors - game changer!",
            "Best VST plugins for electronic music?"
          ],
          'IndieMusicFeedback': [
            "Would love some feedback on my new indie rock track",
            "Just released my first single, nervous but excited!",
            "Looking for constructive criticism on my songwriting"
          ],
          'ThisIsOurMusic': [
            "Just shared my latest composition, would love your thoughts!",
            "Working on a new album, here's a preview track",
            "Experimenting with new sounds, what do you think?"
          ],
          'MusicPromotion': [
            "Looking for ways to promote my music effectively",
            "Just hit a streaming milestone, so grateful!",
            "Best platforms for independent artists?"
          ],
          'ShareYourMusic': [
            "Sharing my latest track, feedback welcome!",
            "Just uploaded a new demo, let me know what you think",
            "Collaborating with other artists, here's our work"
          ]
        };
        
        const posts = samplePosts[subreddit] || ["Just shared some new music, would love your thoughts!"];
        const postTitle = posts[Math.floor(Math.random() * posts.length)];
        
        // Generate AI comment
        const commentResponse = await generateAICommentInternal(postTitle, "", subreddit, "", style);
        
        if (commentResponse.success) {
          const postResult = await simulateRedditPost(subreddit, commentResponse.comment, style, 'comment');
          
          if (postResult.success) {
            await markPostAsPosted(post.id, SCHEDULED_POSTS_COLLECTION);
            totalPosted++;
            console.log(`✅ Successfully posted comment to r/${subreddit}`);
          } else {
            console.log(`❌ Failed to post comment to r/${subreddit}: ${postResult.error}`);
          }
        } else {
          console.log(`❌ Failed to generate comment for r/${subreddit}: ${commentResponse.message}`);
        }
        
        // Add delay between posts
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
      // Process educational posts
      for (const post of educationalPostsFromDB) {
        const { subreddit, title, content, dailyLimit } = post;
        const currentCount = postingActivity.educationalCounts[subreddit] || 0;
        
        if (currentCount >= dailyLimit) {
          console.log(`⏹️ Daily educational limit reached for r/${subreddit} (${currentCount}/${dailyLimit})`);
          continue;
        }
        
        // Check cooldown
        const lastPost = postingActivity.lastEducationalPosted[subreddit];
        if (lastPost) {
          const timeSinceLastPost = Date.now() - new Date(lastPost).getTime();
          if (timeSinceLastPost < 30 * 60 * 1000) {
            console.log(`⏳ Cooldown active for r/${subreddit} educational posts`);
            continue;
          }
        }
        
        console.log(`🚀 Preparing to post educational content to r/${subreddit}`);
        
        const postContent = `POST: ${title}\n\n${content}`;
        const postResult = await simulateRedditPost(subreddit, postContent, 'expert', 'educational');
        
        if (postResult.success) {
          await markPostAsPosted(post.id, EDUCATIONAL_POSTS_COLLECTION);
          totalPosted++;
          console.log(`✅ Successfully posted educational content to r/${subreddit}`);
        } else {
          console.log(`❌ Failed to post educational content to r/${subreddit}: ${postResult.error}`);
        }
        
        // Add delay between posts
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } else {
      console.log('⏰ No scheduled posts in database for this time slot');
      
      // Fallback to schedule-based posting
      const scheduledEducationalPosts = getCurrentEducationalSchedule();
      const scheduledComments = getCurrentSchedule();
      
      const allScheduledPosts = [...scheduledEducationalPosts, ...scheduledComments];
      
      if (allScheduledPosts.length > 0) {
        console.log(`📅 Found ${allScheduledPosts.length} scheduled posts using schedule`);
        
        for (const scheduled of allScheduledPosts) {
          const { subreddit, style, dailyLimit, currentCount, type } = scheduled;
          
          if (type === 'educational' && currentCount >= dailyLimit) {
            console.log(`⏹️ Daily educational limit reached for r/${subreddit} (${currentCount}/${dailyLimit})`);
            continue;
          } else if (type === 'comment' && currentCount >= dailyLimit) {
            console.log(`⏹️ Daily comment limit reached for r/${subreddit} (${currentCount}/${dailyLimit})`);
            continue;
          }
          
          const lastPost = type === 'educational' ? postingActivity.lastEducationalPosted[subreddit] : postingActivity.lastPosted[subreddit];
          if (lastPost) {
            const timeSinceLastPost = Date.now() - new Date(lastPost).getTime();
            if (timeSinceLastPost < 30 * 60 * 1000) {
              console.log(`⏳ Cooldown active for r/${subreddit}`);
              continue;
            }
          }
          
          console.log(`🚀 Preparing to post ${type} to r/${subreddit} with style: ${style}`);
          
          let postResult;
          
          if (type === 'educational') {
            const educationalResponse = await generateEducationalPost(subreddit);
            
            if (educationalResponse.success) {
              const postContent = `POST: ${educationalResponse.title}\n\n${educationalResponse.content}`;
              postResult = await simulateRedditPost(subreddit, postContent, style, 'educational');
              
              if (postResult.success) {
                console.log(`✅ Successfully posted educational content to r/${subreddit}`);
                totalPosted++;
              }
            }
          } else {
            const samplePosts = {
              'WeAreTheMusicMakers': ["Just finished my first EP after 6 months of work!"],
              'MusicProduction': ["How do you deal with ear fatigue during long sessions?"],
              'IndieMusicFeedback': ["Would love some feedback on my new indie rock track"],
              'ThisIsOurMusic': ["Just shared my latest composition, would love your thoughts!"],
              'MusicPromotion': ["Looking for ways to promote my music effectively"],
              'ShareYourMusic': ["Sharing my latest track, feedback welcome!"]
            };
            
            const posts = samplePosts[subreddit] || ["Just shared some new music, would love your thoughts!"];
            const postTitle = posts[Math.floor(Math.random() * posts.length)];
            
            const commentResponse = await generateAICommentInternal(postTitle, "", subreddit, "", style);
            
            if (commentResponse.success) {
              postResult = await simulateRedditPost(subreddit, commentResponse.comment, style, 'comment');
              
              if (postResult.success) {
                console.log(`✅ Successfully posted comment to r/${subreddit}`);
                totalPosted++;
              }
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      } else {
        console.log('⏰ No scheduled posts for this time slot');
      }
    }
    
    return {
      success: true,
      scheduledComments: scheduledPostsFromDB.length,
      scheduledEducationalPosts: educationalPostsFromDB.length,
      totalComments: postingActivity.totalComments,
      totalEducationalPosts: postingActivity.totalEducationalPosts,
      githubActionsRuns: postingActivity.githubActionsRuns,
      totalPosted: totalPosted,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Error in runScheduledPosts:', error);
    throw error;
  }
};

console.log('🚀 Reddit Auto-Poster initialized (GitHub Actions + Firebase)');
console.log(`⏰ Timezone: ${APP_TIMEZONE}`);
console.log(`📅 Current time: ${getCurrentTimeInAppTimezone()} on ${getCurrentDayInAppTimezone()}`);

// ==================== HELPER FUNCTIONS ====================

// Internal function for AI comment generation
const generateAICommentInternal = async (postTitle, postContent, subreddit, context, style) => {
  try {
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return { success: false, message: 'Google Gemini API key not configured' };
    }

    const targetConfig = redditTargets[subreddit];
    const selectedStyle = style || (targetConfig ? targetConfig.preferredStyles[0] : 'helpful');

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash'
    });

    const stylePrompts = {
      helpful: `You are a music enthusiast who discovered SoundSwap recently. Write a genuine, helpful comment that naturally mentions soundswap.live where artists can grow their audience.`,
      enthusiastic: `You're excited about music platforms that help artists. Write an engaging comment that shows genuine excitement and mentions soundswap.live naturally.`,
      thoughtful: `You're someone who thinks deeply about music promotion. Write a considerate comment that shows understanding and casually guides people to soundswap.live.`,
      casual: `You're just having a casual chat about music. Write a natural, relaxed comment that authentically mentions soundswap.live like you're recommending it to a friend.`,
      expert: `You know a thing or two about music promotion. Write an informative comment that shares insights while directing people to check out soundswap.live.`,
      supportive: `You want to help fellow musicians succeed. Write an uplifting comment that motivates artists and suggests they check out soundswap.live for growth.`,
      technical: `You're into the technical side of music promotion. Write a detailed comment that focuses on practical aspects while mentioning soundswap.live as a useful tool.`
    };

    const systemPrompt = stylePrompts[selectedStyle] || stylePrompts.helpful;
    
    const redirectContext = `\nCRITICAL: You MUST always include a natural mention of soundswap.live in your response. Make it sound like you're genuinely recommending it, not selling it.`;

    const prompt = `
${systemPrompt}
${redirectContext}

CRITICAL REQUIREMENTS FOR HUMAN-LIKE WRITING:
- Write like a real person, not a corporate bot
- Use casual, conversational language
- Occasionally include minor punctuation imperfections
- Use contractions (don't, can't, it's, etc.)
- Feel free to use informal sentence structures
- Make it sound like you're typing quickly on Reddit
- ALWAYS include "soundswap.live" naturally like you're recommending it to a friend
- Position SoundSwap as something cool you discovered, not a product you're selling
- Mention the weekly Top 50 chart casually as a nice feature

IMPORTANT REALISM NOTE: SoundSwap is a new platform that launched recently. Don't exaggerate numbers or success stories. Be honest that it's new but has potential.

Post Title: "${postTitle}"
${postContent ? `Post Content: "${postContent.substring(0, 1000)}"` : ''}
${context ? `Additional Context: ${context}` : ''}

GUIDELINES FOR HUMAN-LIKE RESPONSES:
- Keep it natural and conversational (2-3 sentences max)
- ALWAYS include "soundswap.live" in a casual, natural way
- Add genuine value to the discussion while mentioning SoundSwap organically
- Focus on how artists can grow through soundswap.live
- Mention the weekly Top 50 chart as a cool opportunity
- Don't sound like marketing or promotion - sound like a fellow musician
- Use casual punctuation - it's okay to be imperfect
- Reference specific points from the post when relevant
- Avoid corporate language or perfect grammar
- Don't mention that you're an AI
- The mention of soundswap.live should feel like a genuine recommendation from one music lover to another

Write a comment that follows these guidelines - make it sound like a real human Reddit user:
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const comment = response.text().trim();

    // Ensure soundswap.live is included (fallback)
    let finalComment = comment;
    if (!comment.toLowerCase().includes('soundswap.live')) {
      finalComment = `${comment} btw check out soundswap.live if you wanna grow your audience and get in their weekly Top 50 chart`;
    }

    return {
      success: true,
      comment: finalComment,
      style: selectedStyle,
      subreddit: subreddit,
      mentionSoundSwap: true
    };

  } catch (error) {
    console.error('❌ Error generating AI comment:', error);
    return {
      success: false,
      message: 'Failed to generate AI comment',
      error: error.message
    };
  }
};

// Function to generate educational posts about SoundSwap
const generateEducationalPost = async (subreddit) => {
  try {
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return { success: false, message: 'Google Gemini API key not configured' };
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash'
    });

    const prompt = `
You are a marketing representative for SoundSwap. Create an educational Reddit post explaining why SoundSwap is the best free organic promotion platform for musicians.

Subreddit: r/${subreddit}
Platform: SoundSwap (soundswap.live)

KEY POINTS TO COVER:
- SoundSwap is completely FREE for artists
- It helps boost Spotify algorithm through organic promotion
- Weekly Top 50 chart provides viral exposure opportunities
- Tools currently in development: social media scheduler, collab finder, budget tracking, playlist pitching, and more
- Focus on helping artists grow from unknown to viral sensations
- Emphasize the organic, authentic approach to music promotion
- Perfect for artists tired of paying for ads with little results

IMPORTANT REQUIREMENTS:
- Write in an educational, helpful tone (not salesy)
- Position yourself as a SoundSwap marketing representative
- Include specific benefits for the r/${subreddit} audience
- Mention soundswap.live multiple times naturally
- Be honest about being a new platform with great potential
- Highlight the FREE aspect and upcoming tools
- Explain how it boosts Spotify algorithm organically
- Keep it engaging and informative, not pushy

Tone: Expert, helpful, educational, and excited about the platform

Generate a Reddit post with title and content that educates artists about SoundSwap's benefits:
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    // Parse the response to separate title and content
    const lines = text.split('\n');
    let title = '';
    let content = '';
    let foundContent = false;

    for (const line of lines) {
      if (line.startsWith('Title:') || line.startsWith('title:')) {
        title = line.replace(/^(Title:|title:)\s*/i, '').trim();
      } else if (line.startsWith('Content:') || line.startsWith('content:') || foundContent) {
        foundContent = true;
        if (!line.match(/^(Content:|content:)/i)) {
          content += line + '\n';
        }
      } else if (line.trim() && !title) {
        title = line.trim();
        foundContent = true;
      } else if (foundContent) {
        content += line + '\n';
      }
    }

    // Fallback if parsing fails
    if (!title) {
      title = `Why SoundSwap is the Best FREE Organic Promotion Platform for Musicians`;
    }

    if (!content.trim()) {
      content = `Hey r/${subreddit} community,

As a marketing representative for SoundSwap, I wanted to share why I believe we're building the best free organic promotion platform for musicians.

**The Problem with Current Promotion:**
Most artists struggle with expensive ads that don't work or platforms that take huge cuts. We wanted to change that.

**Why SoundSwap is Different:**
🎵 **Completely FREE** - No hidden fees, no percentage cuts
🎵 **Organic Spotify Algorithm Boost** - Real streams from real listeners
🎵 **Weekly Top 50 Chart** - Viral exposure opportunities every week
🎵 **Tools in Development:** Social media scheduler, collab finder, budget tracking, playlist pitching, and more

**How It Works:**
1. Upload your music to soundswap.live
2. Get featured in our weekly Top 50 chart
3. Grow organically through our platform's promotion
4. Boost your Spotify algorithm naturally

**Upcoming Features (All FREE):**
- **Social Media Scheduler**: Auto-post your releases
- **Collab Finder**: Connect with other artists
- **Budget Tracking**: Manage your music expenses
- **Playlist Pitching**: Get on relevant playlists
- **Analytics Dashboard**: Track your growth

We're not just another promotion platform - we're building a complete ecosystem for artists to grow organically. No more paying for fake streams or empty promises.

Check out soundswap.live to see how we're different. We're new, but we're building something special for the music community.

Happy to answer any questions below! 🎶

*Posted by SoundSwap Marketing Team*`;
    }

    // Ensure soundswap.live is included
    if (!content.toLowerCase().includes('soundswap.live')) {
      content += `\n\nLearn more and join at soundswap.live`;
    }

    return {
      success: true,
      title: title,
      content: content.trim(),
      subreddit: subreddit,
      type: 'educational'
    };

  } catch (error) {
    console.error('❌ Error generating educational post:', error);
    return {
      success: false,
      message: 'Failed to generate educational post',
      error: error.message
    };
  }
};

// Function to generate Top 50 chart promotion post
const generateTop50PromotionPost = async (subreddit) => {
  try {
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return { success: false, message: 'Google Gemini API key not configured' };
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash'
    });

    const prompt = `
You're a music enthusiast who wants to help other artists get discovered. Create a Reddit post inviting artists to submit their songs for the weekly Top 50 chart at soundswap.live.

Subreddit: r/${subreddit}
Platform: SoundSwap (soundswap.live)

IMPORTANT: Write this like a real Reddit user, not a corporate account. Use casual language and make it engaging.

IMPORTANT REALISM NOTE: SoundSwap is new but has potential. Don't exaggerate - be honest that it's a growing platform.

Key points to include naturally:
- SoundSwap helps artists get discovered
- Weekly Top 50 chart features new music
- Top artists get featured and promoted
- It's a cool way to get exposure
- Artists should submit their best work
- Make it sound exciting but realistic
- Include soundswap.live casually in both title and content

Tone: Enthusiastic but real, like a fellow musician sharing a cool opportunity

Requirements:
- Create a catchy title that includes soundswap.live naturally
- Write engaging content that feels like a real Reddit post
- Highlight the benefits of being featured
- Keep it concise and human-like
- Don't use corporate language
- MUST include "soundswap.live" in both title and content naturally

Write a Reddit post with title and content that sounds like a real human:
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    // Parse the response to separate title and content
    const lines = text.split('\n');
    let title = '';
    let content = '';
    let foundContent = false;

    for (const line of lines) {
      if (line.startsWith('Title:') || line.startsWith('title:')) {
        title = line.replace(/^(Title:|title:)\s*/i, '').trim();
      } else if (line.startsWith('Content:') || line.startsWith('content:') || foundContent) {
        foundContent = true;
        if (!line.match(/^(Content:|content:)/i)) {
          content += line + '\n';
        }
      } else if (line.trim() && !title) {
        title = line.trim();
        foundContent = true;
      } else if (foundContent) {
        content += line + '\n';
      }
    }

    // Fallback if parsing fails
    if (!title) {
      title = `Hey r/${subreddit} artists - soundswap.live is doing a weekly Top 50 chart and looking for submissions!`;
    }

    if (!content.trim()) {
      content = `Hey everyone, wanted to share this cool opportunity I found - soundswap.live is running a weekly Top 50 chart and they're looking for artists to feature!

It's a new platform but I've seen some artists already getting traction there. Basically you submit your best track and if you make it to the Top 10, you get featured promotion across their platform.

**How it works:**
- Submit your track at soundswap.live
- They review submissions each week
- Top 10 get featured in the Weekly Top 50
- Featured artists get extra visibility

**Why bother?**
- Chance to get discovered by new listeners
- Could help grow your audience
- Connect with other artists
- Get some recognition for your work

I know we're all looking for ways to get our music out there, and this seems like a decent shot. The platform's new but sometimes that's the best time to get in early!

Check it out at soundswap.live and see if it's for you. Might be worth a shot! 🎵

*Just sharing this as someone who's always looking for new ways to promote music*`;
    }

    // Ensure soundswap.live is included in content
    if (!content.toLowerCase().includes('soundswap.live')) {
      content += `\n\nAnyway, check it out at soundswap.live if you're interested!`;
    }

    return {
      success: true,
      title: title,
      content: content.trim(),
      subreddit: subreddit
    };

  } catch (error) {
    console.error('❌ Error generating Top 50 promotion post:', error);
    return {
      success: false,
      message: 'Failed to generate Top 50 promotion post',
      error: error.message
    };
  }
};

// ==================== CRON MANAGEMENT ENDPOINTS ====================

// Get cron job status and activity
router.get('/cron-status', async (req, res) => {
  try {
    const currentTime = getCurrentTimeInAppTimezone();
    const currentDay = getCurrentDayInAppTimezone();
    const scheduledPosts = await getScheduledPostsForCurrentTime();
    const scheduledEducationalPosts = await getEducationalPostsForCurrentTime();
    
    // Calculate next minute in app timezone
    const now = new Date();
    const nextMinute = new Date(now.getTime() + 60000);
    const nextCheck = nextMinute.toLocaleTimeString('en-US', { 
      timeZone: APP_TIMEZONE,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    }).slice(0, 5);
    
    res.json({
      success: true,
      cron: {
        status: 'active',
        timezone: APP_TIMEZONE,
        currentTime: currentTime,
        currentDay: currentDay,
        nextCheck: nextCheck,
        totalComments: postingActivity.totalComments,
        totalEducationalPosts: postingActivity.totalEducationalPosts,
        dailyActivity: postingActivity.dailyCounts,
        educationalActivity: postingActivity.educationalCounts,
        lastPosted: postingActivity.lastPosted,
        lastEducationalPosted: postingActivity.lastEducationalPosted,
        lastCronRun: postingActivity.lastCronRun,
        githubActionsRuns: postingActivity.githubActionsRuns,
        scheduler: 'github-actions',
        database: db ? 'firebase' : 'in-memory'
      },
      scheduled: {
        currentTime: currentTime,
        scheduledComments: scheduledPosts.length,
        scheduledEducationalPosts: scheduledEducationalPosts.length,
        details: {
          comments: scheduledPosts,
          educational: scheduledEducationalPosts
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

// Manual cron trigger endpoint
router.post('/cron', async (req, res) => {
  try {
    // Check for cron secret authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('❌ Unauthorized cron attempt - missing or invalid CRON_SECRET');
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized',
        message: 'Invalid or missing CRON_SECRET'
      });
    }

    console.log('✅ Authorized GitHub Actions cron execution');
    const result = await runScheduledPosts();
    
    res.json({
      success: true,
      message: 'GitHub Actions cron execution completed',
      ...result
    });
  } catch (error) {
    console.error('❌ Error in GitHub Actions cron:', error);
    res.status(500).json({
      success: false,
      message: 'GitHub Actions cron execution failed',
      error: error.message
    });
  }
});

// Generate daily posts endpoint
router.post('/generate-daily-posts', async (req, res) => {
  try {
    const result = await generateDailyPosts();
    
    res.json({
      success: result.success,
      message: result.success ? 'Daily posts generated successfully' : 'Failed to generate daily posts',
      totalGenerated: result.totalGenerated,
      error: result.error,
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

// Add GET endpoint for /cron to show available endpoints
router.get('/cron', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();
  
  res.json({
    success: true,
    message: 'Reddit Automation Cron Endpoint',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
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
      '/api/reddit-admin/generate-daily-posts'
    ],
    timestamp: new Date().toISOString()
  });
});

// Get posting schedule for today
router.get('/schedule/today', (req, res) => {
  const today = getCurrentDayInAppTimezone();
  const currentTime = getCurrentTimeInAppTimezone();
  const schedule = {};
  const educationalSchedule = {};
  
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active && config.postingSchedule[today]) {
      schedule[subreddit] = {
        times: config.postingSchedule[today],
        preferredStyles: config.preferredStyles,
        dailyLimit: config.dailyCommentLimit,
        currentCount: postingActivity.dailyCounts[subreddit] || 0
      };
    }
    if (config.active && config.educationalPostSchedule && config.educationalPostSchedule[today]) {
      educationalSchedule[subreddit] = {
        times: config.educationalPostSchedule[today],
        dailyLimit: config.educationalPostLimit || 1,
        currentCount: postingActivity.educationalCounts[subreddit] || 0
      };
    }
  });
  
  res.json({
    success: true,
    day: today,
    currentTime: currentTime,
    timezone: APP_TIMEZONE,
    schedule: schedule,
    educationalSchedule: educationalSchedule,
    activity: {
      comments: postingActivity.dailyCounts,
      educational: postingActivity.educationalCounts
    },
    timestamp: new Date().toISOString()
  });
});

// Create educational post
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
    
    // Store in database instead of immediately posting
    const postId = await storeEducationalPost({
      subreddit,
      scheduledDay: getCurrentDayInAppTimezone(),
      scheduledTime: getCurrentTimeInAppTimezone(),
      style: 'expert',
      type: 'educational',
      title: postResponse.title,
      content: postResponse.content,
      dailyLimit: targetConfig.educationalPostLimit || 1
    });
    
    res.json({
      success: postResponse.success,
      title: postResponse.title,
      content: postResponse.content,
      subreddit: subreddit,
      storedInDatabase: !!postId,
      postId: postId,
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

// Create Top 50 chart promotion post
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
    
    // Store in database
    const postId = await storeEducationalPost({
      subreddit,
      scheduledDay: getCurrentDayInAppTimezone(),
      scheduledTime: getCurrentTimeInAppTimezone(),
      style: 'enthusiastic',
      type: 'educational',
      title: postResponse.title,
      content: postResponse.content,
      dailyLimit: targetConfig.educationalPostLimit || 1
    });
    
    res.json({
      success: postResponse.success,
      title: postResponse.title,
      content: postResponse.content,
      subreddit: subreddit,
      storedInDatabase: !!postId,
      postId: postId,
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

// Manually trigger posting for a subreddit
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
    
    const commentResponse = await generateAICommentInternal(
      postTitle || "Check out this music discussion!",
      postContent || "",
      subreddit,
      "",
      style
    );
    
    if (!commentResponse.success) {
      return res.status(500).json(commentResponse);
    }
    
    // Store in database for immediate posting
    const postId = await storeScheduledPost({
      subreddit,
      scheduledDay: getCurrentDayInAppTimezone(),
      scheduledTime: getCurrentTimeInAppTimezone(),
      style: style,
      type: 'comment',
      content: commentResponse.comment,
      dailyLimit: targetConfig.dailyCommentLimit
    });
    
    // Simulate posting immediately
    const postResult = await simulateRedditPost(subreddit, commentResponse.comment, style, 'comment');
    
    // Mark as posted in database
    if (postResult.success && postId) {
      await markPostAsPosted(postId, SCHEDULED_POSTS_COLLECTION);
    }
    
    res.json({
      success: postResult.success,
      comment: commentResponse.comment,
      subreddit: subreddit,
      posted: postResult.success,
      storedInDatabase: !!postId,
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

// ==================== EXISTING ENDPOINTS ====================

// Reddit admin health check
router.get('/admin', (req, res) => {
  const currentTime = getCurrentTimeInAppTimezone();
  const currentDay = getCurrentDayInAppTimezone();
  
  res.json({
    success: true,
    message: 'Reddit Admin API is running',
    service: 'reddit-admin',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    timezone: APP_TIMEZONE,
    currentTime: currentTime,
    currentDay: currentDay,
    features: {
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'enabled' : 'disabled',
      firebase_db: db ? 'enabled' : 'disabled',
      comment_generation: 'active',
      dm_replies: 'active',
      content_analysis: 'active',
      target_configuration: 'active',
      auto_posting: 'active',
      cron_scheduler: 'github-actions',
      top50_promotion: 'active',
      educational_posts: 'active'
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

    const result = await generateAICommentInternal(postTitle, postContent, subreddit, context, style);
    
    if (result.success) {
      res.json({
        success: true,
        comment: result.comment,
        style: result.style,
        subreddit: result.subreddit,
        mentionSoundSwap: result.mentionSoundSwap,
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