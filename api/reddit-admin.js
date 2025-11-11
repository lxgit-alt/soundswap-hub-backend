import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import cron from 'node-cron';

const router = express.Router();

// Initialize Google Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

// ==================== AUTOMATION SYSTEM ====================

// Automation state
let automationState = {
  isRunning: false,
  lastRun: null,
  nextRun: null,
  totalCommentsPosted: 0,
  totalRepliesSent: 0,
  activeSubreddits: [],
  currentStatus: 'idle',
  cronJob: null
};

// Mock Reddit API client
class RedditBot {
  constructor() {
    this.authenticated = false;
    this.rateLimit = {
      comments: 0,
      lastReset: new Date()
    };
  }

  async authenticate() {
    console.log('🔐 Authenticating with Reddit...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    this.authenticated = true;
    console.log('✅ Reddit authentication successful');
    return true;
  }

  async postComment(subreddit, postId, comment) {
    if (!this.authenticated) {
      throw new Error('Not authenticated with Reddit');
    }

    console.log(`📝 Posting comment to r/${subreddit}:`, comment);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const success = Math.random() > 0.1;
    if (success) {
      console.log(`✅ Comment posted successfully to r/${subreddit}`);
      return { success: true, commentId: `t1_${Date.now()}` };
    } else {
      console.log(`❌ Failed to post comment to r/${subreddit}`);
      return { success: false, error: 'Rate limited or post locked' };
    }
  }

  async replyToMessage(messageId, reply) {
    if (!this.authenticated) {
      throw new Error('Not authenticated with Reddit');
    }

    console.log(`💬 Replying to message:`, reply);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const success = Math.random() > 0.05;
    if (success) {
      console.log('✅ Reply sent successfully');
      return { success: true, messageId: `t4_${Date.now()}` };
    } else {
      console.log('❌ Failed to send reply');
      return { success: false, error: 'Message not found' };
    }
  }
}

// Initialize Reddit bot
const redditBot = new RedditBot();

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

// ==================== AUTOMATION FUNCTIONS ====================

// Mock function to find relevant posts
async function findRelevantPosts(subreddit, keywords) {
  console.log(`🔍 Finding posts in r/${subreddit} with keywords:`, keywords);
  
  const mockPosts = [
    {
      id: `t3_${Date.now()}_1`,
      title: `Just released my first ${keywords[0]} track, would love feedback`,
      content: `I've been working on this for months and finally feel ready to share. Looking for constructive feedback on the ${keywords[0]} and overall composition.`,
      url: `https://reddit.com/r/${subreddit}/mock_post_1`,
      score: 15,
      commentCount: 8
    },
    {
      id: `t3_${Date.now()}_2`,
      title: `Struggling with ${keywords[1]}, any advice?`,
      content: `I've been having trouble with my ${keywords[1]} process. Anyone have tips or resources that helped them improve?`,
      url: `https://reddit.com/r/${subreddit}/mock_post_2`,
      score: 23,
      commentCount: 12
    },
    {
      id: `t3_${Date.now()}_3`,
      title: `My journey learning ${keywords[2]}`,
      content: `Wanted to share my experience learning ${keywords[2]} over the past year. It's been challenging but incredibly rewarding!`,
      url: `https://reddit.com/r/${subreddit}/mock_post_3`,
      score: 45,
      commentCount: 25
    }
  ];

  await new Promise(resolve => setTimeout(resolve, 1000));
  return mockPosts.slice(0, 2);
}

// Generate AI comment using Gemini
async function generateAIComment(post, subredditConfig) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    
    const shouldMentionSoundSwap = Math.random() < subredditConfig.soundswapMentionRate;
    const selectedStyle = subredditConfig.preferredStyles[
      Math.floor(Math.random() * subredditConfig.preferredStyles.length)
    ];

    const stylePrompts = {
      helpful: `You are a helpful and knowledgeable Reddit user in r/${subredditConfig.name}. Write a genuine, helpful comment that adds value to the discussion. Be specific and provide useful insights.`,
      enthusiastic: `You are an enthusiastic Reddit user who's excited about this topic. Write an engaging comment that shows genuine interest and adds positive energy to the conversation.`,
      thoughtful: `You are a thoughtful and reflective Reddit user. Write a considerate comment that shows deep understanding and adds meaningful perspective to the discussion.`,
      casual: `You are a casual Reddit user having a friendly conversation. Write a natural, relaxed comment that feels authentic and human-like.`,
      expert: `You are an expert in this field sharing valuable insights. Write an informative comment that demonstrates expertise while being accessible to other users.`,
      supportive: `You are a supportive community member who wants to encourage other creators. Write an uplifting comment that motivates and supports the poster.`,
      technical: `You are a technically skilled musician/producer. Write a detailed comment that focuses on technical aspects and provides specific, actionable advice.`
    };

    const mentionContext = shouldMentionSoundSwap ? 
      `\nIMPORTANT: Naturally mention SoundSwap (a music community platform for feedback and collaboration) in a helpful, non-promotional way. Focus on how it helps musicians get feedback, collaborate, and grow their audience. Make it sound like a genuine recommendation from personal experience.` : 
      `\nIMPORTANT: Do NOT mention SoundSwap or any other platforms in this comment. Focus purely on providing value to the discussion.`;

    const prompt = `
${stylePrompts[selectedStyle] || stylePrompts.helpful}
${mentionContext}

Post Title: "${post.title}"
${post.content ? `Post Content: "${post.content.substring(0, 800)}"` : ''}

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
    return {
      comment: response.text().trim(),
      style: selectedStyle,
      mentionSoundSwap: shouldMentionSoundSwap
    };
  } catch (error) {
    console.error('❌ Error generating AI comment:', error);
    throw error;
  }
}

// Main automation function
async function runAutomationCycle() {
  if (!automationState.isRunning) {
    console.log('⏸️  Automation is paused');
    return;
  }

  console.log('🔄 Starting automation cycle...');
  automationState.currentStatus = 'running';
  
  const now = new Date();
  const currentDay = now.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
  const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);

  try {
    if (!redditBot.authenticated) {
      await redditBot.authenticate();
    }

    let totalCommentsPosted = 0;

    for (const [subredditName, config] of Object.entries(redditTargets)) {
      if (!config.active) continue;

      const scheduledTimes = config.postingSchedule[currentDay] || [];
      
      const isScheduledTime = scheduledTimes.some(scheduledTime => {
        const [scheduledHour, scheduledMinute] = scheduledTime.split(':').map(Number);
        const [currentHour, currentMinute] = currentTime.split(':').map(Number);
        
        return Math.abs((currentHour * 60 + currentMinute) - (scheduledHour * 60 + scheduledMinute)) <= 2;
      });

      if (isScheduledTime) {
        console.log(`⏰ Time to post in r/${subredditName} at ${currentTime}`);
        
        try {
          const posts = await findRelevantPosts(subredditName, config.keywords);
          
          for (const post of posts) {
            if (totalCommentsPosted >= 3) break;
            
            const aiResult = await generateAIComment(post, config);
            const postResult = await redditBot.postComment(subredditName, post.id, aiResult.comment);
            
            if (postResult.success) {
              totalCommentsPosted++;
              automationState.totalCommentsPosted++;
              
              console.log(`✅ Posted comment to r/${subredditName}`);
              console.log(`   Style: ${aiResult.style}`);
              console.log(`   SoundSwap Mention: ${aiResult.mentionSoundSwap}`);
              console.log(`   Comment: ${aiResult.comment.substring(0, 100)}...`);
              
              if (posts.length > 1) {
                const delay = Math.floor(Math.random() * 180000) + 120000;
                console.log(`⏳ Waiting ${Math.round(delay/1000/60)} minutes before next comment...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
          }
        } catch (error) {
          console.error(`❌ Error processing r/${subredditName}:`, error.message);
        }
      }
    }

    automationState.lastRun = new Date().toISOString();
    automationState.currentStatus = 'idle';
    
    if (totalCommentsPosted > 0) {
      console.log(`🎉 Automation cycle completed: ${totalCommentsPosted} comments posted`);
    } else {
      console.log('ℹ️  No comments posted this cycle');
    }

  } catch (error) {
    console.error('❌ Automation cycle failed:', error);
    automationState.currentStatus = 'error';
  }
}

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

// ==================== AUTOMATION ENDPOINTS ====================

// Start automation
router.post('/automation/start', async (req, res) => {
  try {
    if (automationState.isRunning) {
      return res.json({
        success: false,
        message: 'Automation is already running'
      });
    }

    automationState.isRunning = true;
    automationState.currentStatus = 'starting';
    
    console.log('🚀 Starting Reddit automation system...');
    
    if (!automationState.cronJob) {
      automationState.cronJob = cron.schedule('*/2 * * * *', runAutomationCycle);
    }

    res.json({
      success: true,
      message: 'Reddit automation system started',
      state: automationState,
      nextRun: '2 minutes from now',
      targets: Object.keys(redditTargets).filter(k => redditTargets[k].active)
    });

  } catch (error) {
    console.error('❌ Failed to start automation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start automation',
      error: error.message
    });
  }
});

// Stop automation
router.post('/automation/stop', (req, res) => {
  try {
    if (!automationState.isRunning) {
      return res.json({
        success: false,
        message: 'Automation is not running'
      });
    }

    automationState.isRunning = false;
    automationState.currentStatus = 'stopped';
    
    if (automationState.cronJob) {
      automationState.cronJob.stop();
    }

    console.log('🛑 Reddit automation system stopped');
    
    res.json({
      success: true,
      message: 'Reddit automation system stopped',
      state: automationState,
      summary: {
        totalCommentsPosted: automationState.totalCommentsPosted,
        totalRepliesSent: automationState.totalRepliesSent
      }
    });

  } catch (error) {
    console.error('❌ Failed to stop automation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop automation',
      error: error.message
    });
  }
});

// Get automation status
router.get('/automation/status', (req, res) => {
  const now = new Date();
  const currentDay = now.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
  const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);

  const todaySchedule = {};
  Object.entries(redditTargets).forEach(([subreddit, config]) => {
    if (config.active && config.postingSchedule[currentDay]) {
      todaySchedule[subreddit] = {
        times: config.postingSchedule[currentDay],
        nextPost: config.postingSchedule[currentDay].find(time => time > currentTime) || 'Tomorrow',
        dailyLimit: config.dailyCommentLimit,
        mentionRate: config.soundswapMentionRate
      };
    }
  });

  res.json({
    success: true,
    automation: automationState,
    schedule: {
      currentDay,
      currentTime,
      todaySchedule
    },
    statistics: {
      totalSubreddits: Object.keys(redditTargets).length,
      activeSubreddits: Object.keys(redditTargets).filter(k => redditTargets[k].active).length,
      totalAudience: Object.values(redditTargets).reduce((sum, target) => sum + target.memberCount, 0),
      estimatedDailyTraffic: Math.round(automationState.totalCommentsPosted * 25)
    },
    timestamp: new Date().toISOString()
  });
});

// Manual trigger for testing
router.post('/automation/trigger-now', async (req, res) => {
  try {
    console.log('🔴 Manual trigger requested');
    await runAutomationCycle();
    
    res.json({
      success: true,
      message: 'Manual automation cycle completed',
      state: automationState
    });
  } catch (error) {
    console.error('❌ Manual trigger failed:', error);
    res.status(500).json({
      success: false,
      message: 'Manual trigger failed',
      error: error.message
    });
  }
});

// Test Reddit connection
router.get('/automation/test-reddit', async (req, res) => {
  try {
    const authResult = await redditBot.authenticate();
    
    res.json({
      success: true,
      message: 'Reddit connection test successful',
      authenticated: authResult,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Reddit connection test failed',
      error: error.message
    });
  }
});

// ==================== AI ENDPOINTS ====================

// Reddit admin health check
router.get('/admin', (req, res) => {
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
      automation_system: 'active'
    },
    targets: {
      total: Object.keys(redditTargets).length,
      active: Object.values(redditTargets).filter(t => t.active).length,
      total_audience: Object.values(redditTargets).reduce((sum, target) => sum + target.memberCount, 0)
    },
    automation: {
      running: automationState.isRunning,
      status: automationState.currentStatus,
      total_comments: automationState.totalCommentsPosted
    },
    endpoints: {
      health: '/api/reddit-admin/admin',
      targets: '/api/reddit-admin/targets',
      schedule: '/api/reddit-admin/schedule/today',
      generate_comment: '/api/reddit-admin/generate-comment',
      generate_reply: '/api/reddit-admin/generate-reply',
      analyze_post: '/api/reddit-admin/analyze-post',
      automation_start: '/api/reddit-admin/automation/start',
      automation_status: '/api/reddit-admin/automation/status',
      automation_stop: '/api/reddit-admin/automation/stop'
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

    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: 'Google Gemini API key not configured'
      });
    }

    const targetConfig = redditTargets[subreddit];
    const shouldMentionSoundSwap = targetConfig && Math.random() < targetConfig.soundswapMentionRate;
    const selectedStyle = style || (targetConfig ? targetConfig.preferredStyles[0] : 'helpful');

    console.log('🤖 Generating AI comment for post:', { 
      subreddit, 
      style: selectedStyle,
      mentionSoundSwap: shouldMentionSoundSwap,
      titleLength: postTitle.length,
      contentLength: postContent?.length || 0
    });

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

    console.log('✅ Generated AI comment:', comment);

    res.json({
      success: true,
      comment: comment,
      style: selectedStyle,
      subreddit: subreddit,
      mentionSoundSwap: shouldMentionSoundSwap,
      config: targetConfig ? {
        dailyLimit: targetConfig.dailyCommentLimit,
        mentionRate: targetConfig.soundswapMentionRate
      } : null,
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