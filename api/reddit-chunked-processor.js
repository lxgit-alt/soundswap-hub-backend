// reddit-chunked-processor.js - Chunked Reddit processing to avoid Vercel timeout
import { GoogleGenerativeAI } from '@google/generative-ai';
import snoowrap from 'snoowrap';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, where, updateDoc, doc, getDoc, deleteDoc, orderBy, limit } from 'firebase/firestore';

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
const POSTING_ACTIVITY_COLLECTION = 'postingActivity';
const PREMIUM_FEATURE_LEADS_COLLECTION = 'premiumFeatureLeads';

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// Initialize Reddit API client
const redditClient = new snoowrap({
  userAgent: 'SoundSwap Reddit Bot v5.0 (Chunked Processing)',
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  refreshToken: process.env.REDDIT_REFRESH_TOKEN
});

// ==================== PERFORMANCE CONFIGURATION ====================

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';
const AI_TIMEOUT_MS = 3000;
const REDDIT_TIMEOUT_MS = 3000;
const GOLDEN_HOUR_WINDOW_MINUTES = 30;

// ==================== OPTIMIZED FUNCTIONS ====================

const analyzePostForPainPoints = (postTitle, postContent = '') => {
  const textToAnalyze = (postTitle + ' ' + postContent).toLowerCase();
  const detectedPainPoints = [];
  
  // Quick keyword matching
  if (textToAnalyze.includes('help') || textToAnalyze.includes('struggle')) {
    detectedPainPoints.push('general_need');
  }
  if (textToAnalyze.includes('expensive') || textToAnalyze.includes('budget')) {
    detectedPainPoints.push('budget');
  }
  if (textToAnalyze.includes('hard') || textToAnalyze.includes('difficult')) {
    detectedPainPoints.push('frustration');
  }
  
  return {
    hasPainPoints: detectedPainPoints.length > 0,
    painPoints: detectedPainPoints,
    score: detectedPainPoints.length * 10
  };
};

const generatePremiumFeatureComment = async (postTitle, subreddit, painPoints = []) => {
  const aiTimeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(`AI generation timeout after ${AI_TIMEOUT_MS}ms`)), AI_TIMEOUT_MS)
  );

  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash-lite'
    });

    // Quick prompt
    const prompt = `Write a helpful Reddit comment (1 sentence) for r/${subreddit} about:
Post: "${postTitle}"
User needs: ${painPoints.join(', ') || 'help with creative work'}

Mention how AI tools can help. Keep it brief.`;

    const aiCall = model.generateContent(prompt);
    const result = await Promise.race([aiCall, aiTimeout]);
    const response = await result.response;
    let comment = response.text().trim();

    console.log(`✅ Premium comment generated for r/${subreddit}`);
    
    return {
      success: true,
      comment: comment
    };

  } catch (error) {
    console.error(`❌ Premium comment generation failed:`, error.message);
    
    // Quick fallback response
    const fallbackComment = `I understand that struggle! AI tools really helped me automate similar tasks.`;
    
    return {
      success: true,
      comment: fallbackComment
    };
  }
};

const fetchFreshPostsFromSubreddit = async (subreddit, timeWindowMinutes = 30) => {
  try {
    console.log(`🔍 Fetching fresh posts from r/${subreddit} (last ${timeWindowMinutes} minutes)`);
    
    const redditTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Reddit API timeout after ${REDDIT_TIMEOUT_MS}ms`)), REDDIT_TIMEOUT_MS)
    );
    
    // Get current time for timestamp comparison
    const now = Math.floor(Date.now() / 1000);
    const timeThreshold = now - (timeWindowMinutes * 60);
    
    const fetchPromise = redditClient.getSubreddit(subreddit).getNew({
      limit: 3 // Very small limit
    });
    
    const posts = await Promise.race([fetchPromise, redditTimeout]);
    
    // Filter posts from the last timeWindowMinutes
    const freshPosts = posts.filter(post => {
      const postTime = post.created_utc;
      return postTime >= timeThreshold;
    });
    
    console.log(`📊 Found ${freshPosts.length} fresh posts in r/${subreddit}`);
    
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
      subreddit: subreddit
    }));
    
  } catch (error) {
    console.error(`❌ Error fetching fresh posts from r/${subreddit}:`, error.message);
    return [];
  }
};

const processSingleSubreddit = async (subreddit, processType = 'goldenHour') => {
  const startTime = Date.now();
  
  try {
    console.log(`🎯 Starting chunked processing for r/${subreddit}`);
    
    // Fetch fresh posts
    const freshPosts = await fetchFreshPostsFromSubreddit(subreddit, GOLDEN_HOUR_WINDOW_MINUTES);
    
    if (freshPosts.length === 0) {
      console.log(`⏳ No fresh posts found in r/${subreddit}`);
      return { 
        success: true, 
        message: 'No fresh posts found',
        processingTime: Date.now() - startTime,
        postsProcessed: 0
      };
    }
    
    // Analyze for pain points
    const postsWithPainPoints = [];
    
    for (const post of freshPosts) {
      const analysis = analyzePostForPainPoints(post.title, post.content);
      
      if (analysis.hasPainPoints) {
        postsWithPainPoints.push({
          ...post,
          painPoints: analysis.painPoints,
          painPointScore: analysis.score
        });
        console.log(`🎯 Found pain point post in r/${subreddit}: "${post.title.substring(0, 50)}..."`);
        
        // Process only the first one to stay within time limits
        break;
      }
    }
    
    if (postsWithPainPoints.length === 0) {
      console.log(`⏳ No pain point posts found in r/${subreddit}`);
      return { 
        success: true, 
        message: 'No pain point posts found',
        processingTime: Date.now() - startTime,
        postsProcessed: 0
      };
    }
    
    // Process the first post
    const postToProcess = postsWithPainPoints[0];
    
    // Generate comment
    const commentResponse = await generatePremiumFeatureComment(
      postToProcess.title,
      subreddit,
      postToProcess.painPoints
    );
    
    if (!commentResponse.success) {
      throw new Error('Failed to generate comment');
    }
    
    // SIMULATED POSTING - In production, you would post to Reddit here
    console.log(`💬 Would post comment to r/${subreddit} on post ${postToProcess.id}`);
    
    // Save lead to Firebase
    await savePremiumLead(
      subreddit,
      postToProcess.title,
      'AI Tool',
      'high',
      postToProcess.painPoints
    );
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ Chunked processing completed for r/${subreddit} in ${processingTime}ms`);
    
    return {
      success: true,
      message: 'Successfully processed subreddit',
      subreddit: subreddit,
      postProcessed: postToProcess.title.substring(0, 50) + '...',
      commentGenerated: true,
      leadSaved: true,
      processingTime: processingTime,
      postsProcessed: 1
    };
    
  } catch (error) {
    console.error(`❌ Error processing r/${subreddit}:`, error.message);
    return {
      success: false,
      error: error.message,
      processingTime: Date.now() - startTime,
      postsProcessed: 0
    };
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
      converted: false,
      source: 'chunked_processing'
    });
    console.log(`💎 Premium lead saved: ${leadType} from r/${subreddit}`);
  } catch (error) {
    console.error('❌ Error saving premium lead:', error);
  }
};

const processBatch = async (subreddits, maxChunks = 3) => {
  console.log(`🔄 Starting batch processing for ${subreddits.length} subreddits`);
  
  const results = [];
  const chunks = [];
  
  // Split subreddits into chunks
  for (let i = 0; i < subreddits.length; i += maxChunks) {
    chunks.push(subreddits.slice(i, i + maxChunks));
  }
  
  // Process each chunk
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(`📦 Processing chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} subreddits`);
    
    for (const subreddit of chunk) {
      try {
        const result = await processSingleSubreddit(subreddit);
        results.push({
          subreddit,
          success: result.success,
          processingTime: result.processingTime
        });
        
        // Add small delay between subreddits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ Failed to process r/${subreddit}:`, error);
        results.push({
          subreddit,
          success: false,
          error: error.message
        });
      }
    }
    
    // Add delay between chunks
    if (chunkIndex < chunks.length - 1) {
      console.log(`⏳ Waiting before next chunk...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`✅ Batch processing completed`);
  
  return {
    success: true,
    totalSubreddits: subreddits.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results: results
  };
};

// Export functions
export {
  processSingleSubreddit,
  processBatch,
  savePremiumLead
};

console.log('🚀 Reddit Chunked Processor Initialized');
console.log(`⚡ Optimized for Vercel: Timeouts set to ${AI_TIMEOUT_MS}ms (AI) and ${REDDIT_TIMEOUT_MS}ms (Reddit)`);