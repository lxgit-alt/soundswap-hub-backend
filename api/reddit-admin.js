import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';

const router = express.Router();

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

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

// ==================== AUTOMATION SYSTEM ====================

// In-memory storage for automation state (in production, use a database)
const automationState = {
  isRunning: false,
  lastRun: null,
  totalComments: 0,
  subredditStats: {},
  errorCount: 0
};

// Get current time in format needed for scheduling
const getCurrentTime = () => {
  const now = new Date();
  return {
    hour: now.getHours().toString().padStart(2, '0'),
    minute: now.getMinutes().toString().padStart(2, '0'),
    timeString: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
    day: now.toLocaleString('en-US', { weekday: 'long' }).toLowerCase()
  };
};

// Check if it's time to post for a subreddit
const shouldPostForSubreddit = (subreddit) => {
  const current = getCurrentTime();
  const schedule = redditTargets[subreddit]?.postingSchedule;
  
  if (!schedule || !schedule[current.day]) {
    return false;
  }
  
  return schedule[current.day].some(scheduleTime => {
    const [scheduleHour, scheduleMinute] = scheduleTime.split(':');
    return current.hour === scheduleHour && current.minute === scheduleMinute;
  });
};

// Get active subreddits for current time
const getActiveSubreddits = () => {
  const active = [];
  Object.keys(redditTargets).forEach(subreddit => {
    if (redditTargets[subreddit].active && shouldPostForSubreddit(subreddit)) {
      active.push(subreddit);
    }
  });
  return active;
};

// Simulate Reddit API interaction (replace with actual Reddit API)
const simulateRedditPost = async (subreddit, comment) => {
  // In production, integrate with actual Reddit API using:
  // - snoowrap (Node.js Reddit API wrapper)
  // - Proper OAuth authentication
  // - Rate limiting handling
  
  console.log(`📮 [SIMULATED] Posting to r/${subreddit}: ${comment}`);
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Simulate success (90% success rate)
  const success = Math.random() > 0.1;
  
  if (success) {
    return { success: true, postId: `t3_${Math.random().toString(36).substr(2, 9)}` };
  } else {
    throw new Error('Simulated Reddit API error');
  }
};

// Generate AI-powered comment for Reddit posts
const generateAIContent = async (postTitle, postContent, subreddit, style = 'helpful') => {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    throw new Error('Google Gemini API key not configured');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
  const targetConfig = redditTargets[subreddit];
  const shouldMentionSoundSwap = targetConfig && Math.random() < targetConfig.soundswapMentionRate;

  const stylePrompts = {
    helpful: `You are a helpful and knowledgeable Reddit user in r/${subreddit}. Write a genuine, helpful comment that adds value to the discussion. Be specific and provide useful insights.`,
    enthusiastic: `You are an enthusiastic Reddit user who's excited about this topic. Write an engaging comment that shows genuine interest and adds positive energy to the conversation.`,
    thoughtful: `You are a thoughtful and reflective Reddit user. Write a considerate comment that shows deep understanding and adds meaningful perspective to the discussion.`,
    casual: `You are a casual Reddit user having a friendly conversation. Write a natural, relaxed comment that feels authentic and human-like.`,
    expert: `You are an expert in this field sharing valuable insights. Write an informative comment that demonstrates expertise while being accessible to other users.`,
    supportive: `You are a supportive community member who wants to encourage other creators. Write an uplifting comment that motivates and supports the poster.`,
    technical: `You are a technically skilled musician/producer. Write a detailed comment that focuses on technical aspects and provides specific, actionable advice.`
  };

  const systemPrompt = stylePrompts[style] || stylePrompts.helpful;
  const mentionContext = shouldMentionSoundSwap ? 
    `\nIMPORTANT: Naturally mention SoundSwap (a music community platform for feedback and collaboration) in a helpful, non-promotional way. Focus on how it helps musicians get feedback, collaborate, and grow their audience. Make it sound like a genuine recommendation from personal experience.` : 
    `\nIMPORTANT: Do NOT mention SoundSwap or any other platforms in this comment. Focus purely on providing value to the discussion.`;

  const prompt = `
${systemPrompt}
${mentionContext}

Post Title: "${postTitle}"
${postContent ? `Post Content: "${postContent.substring(0, 1000)}"` : ''}

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
  return response.text().trim();
};

// Main automation function
const runAutomation = async () => {
  if (automationState.isRunning) {
    console.log('🔄 Automation already running, skipping...');
    return { success: false, message: 'Automation already running' };
  }

  automationState.isRunning = true;
  automationState.lastRun = new Date();
  
  console.log('🚀 Starting Reddit automation...');
  
  const activeSubreddits = getActiveSubreddits();
  
  if (activeSubreddits.length === 0) {
    console.log('⏰ No active subreddits for current time');
    automationState.isRunning = false;
    return { success: true, message: 'No active subreddits for current time' };
  }

  console.log(`🎯 Active subreddits: ${activeSubreddits.join(', ')}`);
  
  const results = [];
  
  for (const subreddit of activeSubreddits) {
    try {
      console.log(`🔍 Processing r/${subreddit}...`);
      
      // Simulate finding relevant posts (in production, fetch from Reddit API)
      const simulatedPosts = [
        {
          title: "Just released my first EP after years of producing!",
          content: "Finally gathered the courage to release my electronic EP. Would love some feedback on the mixing and overall sound design.",
          id: "post_1"
        },
        {
          title: "Struggling with vocal mixing - any tips?",
          content: "I've been having trouble making my vocals sit well in the mix. They either sound too dry or too washed out with reverb.",
          id: "post_2"
        },
        {
          title: "What's your favorite piece of music production gear under $500?",
          content: "Looking to expand my home studio setup without breaking the bank. Curious what everyone recommends!",
          id: "post_3"
        }
      ];
      
      const targetConfig = redditTargets[subreddit];
      const selectedStyle = targetConfig.preferredStyles[
        Math.floor(Math.random() * targetConfig.preferredStyles.length)
      ];
      
      // Select a random post to comment on
      const selectedPost = simulatedPosts[Math.floor(Math.random() * simulatedPosts.length)];
      
      console.log(`🤖 Generating AI comment for r/${subreddit}...`);
      const aiComment = await generateAIContent(
        selectedPost.title,
        selectedPost.content,
        subreddit,
        selectedStyle
      );
      
      console.log(`📮 Posting to r/${subreddit}...`);
      const postResult = await simulateRedditPost(subreddit, aiComment);
      
      // Update statistics
      automationState.totalComments++;
      automationState.subredditStats[subreddit] = (automationState.subredditStats[subreddit] || 0) + 1;
      
      results.push({
        subreddit,
        success: true,
        comment: aiComment,
        postId: selectedPost.id,
        style: selectedStyle
      });
      
      console.log(`✅ Successfully posted to r/${subreddit}`);
      
      // Add delay between posts to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 5000));
      
    } catch (error) {
      console.error(`❌ Error processing r/${subreddit}:`, error.message);
      automationState.errorCount++;
      results.push({
        subreddit,
        success: false,
        error: error.message
      });
    }
  }
  
  automationState.isRunning = false;
  console.log(`🎉 Automation completed. Processed ${results.length} subreddits`);
  
  return {
    success: true,
    message: `Automation completed for ${results.length} subreddits`,
    results,
    statistics: {
      totalComments: automationState.totalComments,
      errorCount: automationState.errorCount,
      subredditStats: automationState.subredditStats
    }
  };
};

// ==================== AUTOMATION ENDPOINTS ====================

// Start automation manually
router.post('/automation/start', async (req, res) => {
  try {
    console.log('🚀 Manual automation trigger received');
    const result = await runAutomation();
    
    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Automation error:', error);
    res.status(500).json({
      success: false,
      message: 'Automation failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get automation status
router.get('/automation/status', (req, res) => {
  const activeSubreddits = getActiveSubreddits();
  
  res.json({
    success: true,
    automation: {
      isRunning: automationState.isRunning,
      lastRun: automationState.lastRun,
      totalComments: automationState.totalComments,
      errorCount: automationState.errorCount,
      subredditStats: automationState.subredditStats
    },
    currentTime: getCurrentTime(),
    activeSubreddits: activeSubreddits,
    nextRun: 'Scheduled via serverless functions',
    timestamp: new Date().toISOString()
  });
});

// Serverless automation trigger (for Vercel cron jobs)
router.get('/automation/trigger', async (req, res) => {
  try {
    console.log('⏰ Serverless automation trigger received');
    
    // This endpoint is designed to be called by Vercel cron jobs
    // It runs the automation and returns immediately (fire and forget)
    
    // Run automation in background
    runAutomation().catch(error => {
      console.error('❌ Background automation error:', error);
    });
    
    // Return immediate response
    res.json({
      success: true,
      message: 'Automation triggered successfully',
      triggeredAt: new Date().toISOString(),
      activeSubreddits: getActiveSubreddits()
    });
    
  } catch (error) {
    console.error('❌ Automation trigger error:', error);
    res.status(500).json({
      success: false,
      message: 'Automation trigger failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== CONFIGURATION ENDPOINTS ====================

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
        dailyLimit: config.dailyCommentLimit
      };
    }
  });
  
  res.json({
    success: true,
    day: today,
    schedule: schedule,
    timestamp: new Date().toISOString()
  });
});

// ==================== AI ENDPOINTS ====================

// Reddit admin health check
router.get('/admin', (req, res) => {
  const activeSubreddits = getActiveSubreddits();
  
  res.json({
    success: true,
    message: 'Reddit Admin API is running',
    service: 'reddit-admin',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    features: {
      gemini_ai: process.env.GOOGLE_GEMINI_API_KEY ? 'enabled' : 'disabled',
      comment_generation: 'active',
      dm_replies: 'active',
      content_analysis: 'active',
      target_configuration: 'active',
      automation_system: 'active',
      serverless_functions: 'active'
    },
    targets: {
      total: Object.keys(redditTargets).length,
      active: Object.values(redditTargets).filter(t => t.active).length,
      total_audience: Object.values(redditTargets).reduce((sum, target) => sum + target.memberCount, 0),
      currently_active: activeSubreddits.length
    },
    automation: {
      status: automationState.isRunning ? 'running' : 'idle',
      last_run: automationState.lastRun,
      total_comments: automationState.totalComments
    },
    endpoints: {
      health: '/api/reddit-admin/admin',
      targets: '/api/reddit-admin/targets',
      schedule: '/api/reddit-admin/schedule/today',
      automation_status: '/api/reddit-admin/automation/status',
      automation_start: '/api/reddit-admin/automation/start',
      automation_trigger: '/api/reddit-admin/automation/trigger',
      generate_comment: '/api/reddit-admin/generate-comment',
      generate_reply: '/api/reddit-admin/generate-reply',
      analyze_post: '/api/reddit-admin/analyze-post'
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

    const targetConfig = redditTargets[subreddit];
    const selectedStyle = style || (targetConfig ? targetConfig.preferredStyles[0] : 'helpful');

    console.log('🤖 Generating AI comment for post:', { 
      subreddit, 
      style: selectedStyle,
      titleLength: postTitle.length,
      contentLength: postContent?.length || 0
    });

    const comment = await generateAIContent(postTitle, postContent, subreddit, selectedStyle);

    console.log('✅ Generated AI comment:', comment);

    res.json({
      success: true,
      comment: comment,
      style: selectedStyle,
      subreddit: subreddit,
      timestamp: new Date().toISOString()
    });

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

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

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

    const recommendations = {
      postType: 'discussion',
      suggestedTone: 'helpful',
      focusAreas: [],
      avoidTopics: []
    };

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