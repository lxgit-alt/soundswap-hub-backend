import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import cron from 'node-cron';

const router = express.Router();

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// ==================== REDDIT TARGET CONFIGURATION ====================

const redditTargets = {
  // Primary music communities
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
    preferredStyles: ['helpful', 'expert', 'thoughtful'],
    soundswapMentionRate: 0.3,
    dailyCommentLimit: 8,
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
    preferredStyles: ['expert', 'helpful', 'technical'],
    soundswapMentionRate: 0.4,
    dailyCommentLimit: 6,
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
    preferredStyles: ['supportive', 'helpful', 'enthusiastic'],
    soundswapMentionRate: 0.5,
    dailyCommentLimit: 10,
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
    preferredStyles: ['enthusiastic', 'supportive', 'casual'],
    soundswapMentionRate: 0.4,
    dailyCommentLimit: 8,
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
    preferredStyles: ['enthusiastic', 'casual', 'supportive'],
    soundswapMentionRate: 0.6,
    dailyCommentLimit: 12,
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
    preferredStyles: ['supportive', 'casual', 'enthusiastic'],
    soundswapMentionRate: 0.5,
    dailyCommentLimit: 8,
    keywords: ['share', 'new track', 'feedback', 'collaboration']
  }
};

// ==================== CRON SCHEDULER ====================

// Track posting activity
const postingActivity = {
  dailyCounts: {},
  lastPosted: {},
  totalComments: 0
};

// Initialize daily counts
Object.keys(redditTargets).forEach(subreddit => {
  postingActivity.dailyCounts[subreddit] = 0;
});

// Function to get current schedule for all active subreddits
const getCurrentSchedule = () => {
  const now = new Date();
  const day = now.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
  const time = now.toTimeString().slice(0, 5); // HH:MM format
  
  const scheduledPosts = [];
  
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active && config.postingSchedule[day]) {
      const times = config.postingSchedule[day];
      if (times.includes(time)) {
        scheduledPosts.push({
          subreddit,
          time,
          style: config.preferredStyles[Math.floor(Math.random() * config.preferredStyles.length)],
          dailyLimit: config.dailyCommentLimit,
          currentCount: postingActivity.dailyCounts[subreddit] || 0
        });
      }
    }
  });
  
  return scheduledPosts;
};

// Function to simulate posting to Reddit (you'll integrate with actual Reddit API)
const simulateRedditPost = async (subreddit, comment, style) => {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
  
  // Simulate success (90% success rate)
  const success = Math.random() > 0.1;
  
  if (success) {
    postingActivity.dailyCounts[subreddit] = (postingActivity.dailyCounts[subreddit] || 0) + 1;
    postingActivity.lastPosted[subreddit] = new Date().toISOString();
    postingActivity.totalComments++;
    
    console.log(`✅ Posted to r/${subreddit}: ${comment.substring(0, 100)}...`);
    return { success: true, comment };
  } else {
    console.log(`❌ Failed to post to r/${subreddit}`);
    return { success: false, error: 'Simulated failure' };
  }
};

// Cron job that runs every minute to check for scheduled posts
cron.schedule('* * * * *', async () => {
  try {
    const scheduledPosts = getCurrentSchedule();
    
    if (scheduledPosts.length > 0) {
      console.log(`🕒 Checking scheduled posts at ${new Date().toLocaleTimeString()}:`, 
        scheduledPosts.map(p => `r/${p.subreddit}`).join(', '));
      
      for (const scheduled of scheduledPosts) {
        const { subreddit, style, dailyLimit, currentCount } = scheduled;
        
        // Check daily limit
        if (currentCount >= dailyLimit) {
          console.log(`⏸️  Daily limit reached for r/${subreddit} (${currentCount}/${dailyLimit})`);
          continue;
        }
        
        // Check if we recently posted to this subreddit (avoid rapid posting)
        const lastPost = postingActivity.lastPosted[subreddit];
        if (lastPost) {
          const timeSinceLastPost = Date.now() - new Date(lastPost).getTime();
          if (timeSinceLastPost < 30 * 60 * 1000) { // 30 minutes cooldown
            console.log(`⏸️  Cooldown active for r/${subreddit}`);
            continue;
          }
        }
        
        console.log(`🚀 Preparing to post to r/${subreddit} with style: ${style}`);
        
        // Generate sample post content based on subreddit
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
          ]
        };
        
        const posts = samplePosts[subreddit] || ["Just shared some new music, would love your thoughts!"];
        const postTitle = posts[Math.floor(Math.random() * posts.length)];
        
        // Generate AI comment
        const commentResponse = await generateAICommentInternal(postTitle, "", subreddit, "", style);
        
        if (commentResponse.success) {
          // Simulate posting to Reddit
          const postResult = await simulateRedditPost(subreddit, commentResponse.comment, style);
          
          if (postResult.success) {
            console.log(`🎉 Successfully posted to r/${subreddit}`);
          }
        }
        
        // Add delay between posts to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  } catch (error) {
    console.error('❌ Error in cron job:', error);
  }
});

console.log('⏰ Reddit Auto-Poster cron scheduler started');

// ==================== HELPER FUNCTIONS ====================

// Internal function for AI comment generation
const generateAICommentInternal = async (postTitle, postContent, subreddit, context, style) => {
  try {
    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return { success: false, message: 'Google Gemini API key not configured' };
    }

    const targetConfig = redditTargets[subreddit];
    const shouldMentionSoundSwap = targetConfig && Math.random() < targetConfig.soundswapMentionRate;
    const selectedStyle = style || (targetConfig ? targetConfig.preferredStyles[0] : 'helpful');

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const stylePrompts = {
      helpful: `You are a helpful and knowledgeable Reddit user in r/${subreddit}. Write a genuine, helpful comment that adds value to the discussion. Be specific and provide useful insights.`,
      enthusiastic: `You are an enthusiastic Reddit user who's excited about this topic. Write an engaging comment that shows genuine interest and adds positive energy to the conversation.`,
      thoughtful: `You are a thoughtful and reflective Reddit user. Write a considerate comment that shows deep understanding and adds meaningful perspective to the discussion.`,
      casual: `You are a casual Reddit user having a friendly conversation. Write a natural, relaxed comment that feels authentic and human-like.`,
      expert: `You are an expert in this field sharing valuable insights. Write an informative comment that demonstrates expertise while being accessible to other users.`,
      supportive: `You are a supportive community member who wants to encourage other creators. Write an uplifting comment that motivates and supports the poster.`,
      technical: `You are a technically skilled musician/producer. Write a detailed comment that focuses on technical aspects and provides specific, actionable advice.`
    };

    const systemPrompt = stylePrompts[selectedStyle] || stylePrompts.helpful;
    const mentionContext = shouldMentionSoundSwap ? 
      `\nIMPORTANT: Naturally mention SoundSwap (a music community platform for feedback and collaboration) in a helpful, non-promotional way. Focus on how it helps musicians get feedback, collaborate, and grow their audience. Make it sound like a genuine recommendation from personal experience.` : 
      `\nIMPORTANT: Do NOT mention SoundSwap or any other platforms in this comment. Focus purely on providing value to the discussion.`;

    const prompt = `
${systemPrompt}
${mentionContext}

Post Title: "${postTitle}"
${postContent ? `Post Content: "${postContent.substring(0, 1000)}"` : ''}
${context ? `Additional Context: ${context}` : ''}

Guidelines:
- Keep it natural and conversational (1-3 sentences)
- Add genuine value to the discussion
- Don't sound like marketing or promotion
- Use appropriate emojis sparingly (1 max)
- Sound like a real human user
- Reference specific points from the post when relevant
- Avoid generic responses like "great post" or "thanks for sharing"
- Don't mention that you're an AI
${shouldMentionSoundSwap ? '- Mention SoundSwap naturally as a helpful resource, not as an advertisement' : '- Do not mention any platforms or services'}

Write a comment that follows these guidelines:
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const comment = response.text().trim();

    return {
      success: true,
      comment: comment,
      style: selectedStyle,
      subreddit: subreddit,
      mentionSoundSwap: shouldMentionSoundSwap
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

// ==================== CRON MANAGEMENT ENDPOINTS ====================

// Get cron job status and activity
router.get('/cron-status', (req, res) => {
  const now = new Date();
  const scheduledPosts = getCurrentSchedule();
  
  res.json({
    success: true,
    cron: {
      status: 'active',
      nextCheck: new Date(now.getTime() + 60000).toISOString(), // Next minute
      totalComments: postingActivity.totalComments,
      dailyActivity: postingActivity.dailyCounts,
      lastPosted: postingActivity.lastPosted
    },
    scheduled: {
      currentTime: now.toTimeString().slice(0, 5),
      scheduledPosts: scheduledPosts.length,
      details: scheduledPosts
    },
    timestamp: new Date().toISOString()
  });
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
    
    // Simulate posting
    const postResult = await simulateRedditPost(subreddit, commentResponse.comment, style);
    
    res.json({
      success: postResult.success,
      comment: commentResponse.comment,
      subreddit: subreddit,
      posted: postResult.success,
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
router.post('/reset-counts', (req, res) => {
  Object.keys(postingActivity.dailyCounts).forEach(key => {
    postingActivity.dailyCounts[key] = 0;
  });
  
  res.json({
    success: true,
    message: 'Daily counts reset',
    counts: postingActivity.dailyCounts,
    timestamp: new Date().toISOString()
  });
});

// ==================== EXISTING ENDPOINTS (UPDATED) ====================

// Reddit admin health check (updated with cron info)
router.get('/admin', (req, res) => {
  res.json({
    success: true,
    message: 'Reddit Admin API is running',
    service: 'reddit-admin',
    version: '2.2.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    features: {
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'enabled' : 'disabled',
      comment_generation: 'active',
      dm_replies: 'active',
      content_analysis: 'active',
      target_configuration: 'active',
      auto_posting: 'active',
      cron_scheduler: 'active'
    },
    targets: {
      total: Object.keys(redditTargets).length,
      active: Object.values(redditTargets).filter(t => t.active).length,
      total_audience: Object.values(redditTargets).reduce((sum, target) => sum + target.memberCount, 0)
    },
    cron: {
      status: 'running',
      total_comments: postingActivity.totalComments,
      daily_limits: Object.fromEntries(
        Object.entries(redditTargets).map(([k, v]) => [k, v.dailyCommentLimit])
      )
    },
    endpoints: {
      health: '/api/reddit-admin/admin',
      targets: '/api/reddit-admin/targets',
      schedule: '/api/reddit-admin/schedule/today',
      cron_status: '/api/reddit-admin/cron-status',
      manual_post: '/api/reddit-admin/manual-post',
      reset_counts: '/api/reddit-admin/reset-counts',
      generate_comment: '/api/reddit-admin/generate-comment',
      generate_reply: '/api/reddit-admin/generate-reply',
      analyze_post: '/api/reddit-admin/analyze-post'
    }
  });
});

// Generate AI-powered comment for Reddit posts (uses internal function)
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

// ... (Keep all the existing endpoints below unchanged - generate-reply, analyze-post, test-gemini, targets, schedule, etc.)
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

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

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
- Use appropriate emojis sparingly
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

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

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

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
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

// Get posting schedule for today
router.get('/schedule/today', (req, res) => {
  const today = new Date().toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
  const schedule = {};
  
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active && config.postingSchedule[today]) {
      schedule[subreddit] = {
        times: config.postingSchedule[today],
        preferredStyles: config.preferredStyles,
        dailyLimit: config.dailyCommentLimit,
        currentCount: postingActivity.dailyCounts[subreddit] || 0
      };
    }
  });
  
  res.json({
    success: true,
    day: today,
    schedule: schedule,
    activity: postingActivity.dailyCounts,
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