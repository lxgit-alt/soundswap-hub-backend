import express from 'express';
import snoowrap from 'snoowrap';
import cors from 'cors';

const router = express.Router();

// CORS for your frontend domains
router.use(cors({
  origin: [
    'https://www.soundswap.live',
    'https://soundswap.onrender.com',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));

// Reddit configuration
const REDDIT_CONFIG = {
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
  userAgent: 'SoundSwapBot/1.0'
};

// Target subreddits and keywords
const TARGET_SUBREDDITS = [
  'WeAreTheMusicMakers',
  'IndieMusicFeedback', 
  'musicmarketing',
  'ThisIsOurMusic',
  'promoteyourmusic',
  'musicians'
];

const KEYWORDS = [
  'stuck on mix',
  'need honest feedback',
  'where to promote music',
  'bot streams',
  'music promotion',
  'grow audience',
  'get more listeners',
  'feedback on my track',
  'how to promote',
  'music marketing'
];

const RESPONSE_TEMPLATES = {
  feedback: `Hey! I saw you're looking for feedback. We built SoundSwap specifically for this - it's a platform where artists give each other constructive feedback in a gamified system. You might find it helpful: https://www.soundswap.live`,

  promotion: `Sounds like you're looking to promote your music! SoundSwap could help - it's designed to help artists grow organically without bot streams. Check it out: https://www.soundswap.live`,

  general: `This is exactly the problem we're solving with SoundSwap! It's a platform for musicians to share, get feedback, and grow their audience authentically. You might find it useful: https://www.soundswap.live`
};

// Initialize Reddit client
let reddit;
try {
  reddit = new snoowrap(REDDIT_CONFIG);
} catch (error) {
  console.warn('⚠️ Reddit client not initialized - check environment variables');
}

// Authentication middleware - only you can access
const authenticateAdmin = (req, res, next) => {
  const adminToken = process.env.ADMIN_SECRET_TOKEN;
  const providedToken = req.headers['x-admin-token'];
  
  if (!adminToken || providedToken !== adminToken) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin token required.'
    });
  }
  next();
};

// Apply admin authentication to all API routes
router.use(authenticateAdmin);

// Store found posts (in production, use a database)
let foundPosts = [];
let analytics = {
  totalScanned: 0,
  matchesFound: 0,
  responsesSent: 0,
  lastScan: null
};

// ========== API ROUTES ==========

// Scan subreddits for keyword matches
router.post('/api/scan', async (req, res) => {
  try {
    console.log('🔍 Starting Reddit scan...');
    
    if (!reddit) {
      return res.status(500).json({
        success: false,
        message: 'Reddit client not configured. Check environment variables.'
      });
    }
    
    const newPosts = [];
    
    for (const subreddit of TARGET_SUBREDDITS) {
      try {
        console.log(`📊 Scanning r/${subreddit}...`);
        
        // Get recent posts
        const posts = await reddit.getSubreddit(subreddit).getNew({ limit: 25 });
        
        for (const post of posts) {
          analytics.totalScanned++;
          
          const content = `${post.title} ${post.selftext}`.toLowerCase();
          const matchedKeywords = KEYWORDS.filter(keyword => 
            content.includes(keyword.toLowerCase())
          );
          
          if (matchedKeywords.length > 0) {
            const existingPost = foundPosts.find(p => p.id === post.id);
            
            if (!existingPost) {
              const postData = {
                id: post.id,
                title: post.title,
                url: `https://reddit.com${post.permalink}`,
                subreddit: subreddit,
                author: post.author.name,
                content: post.selftext.substring(0, 500),
                keywords: matchedKeywords,
                score: post.score,
                commentCount: post.num_comments,
                created: new Date(post.created_utc * 1000),
                posted: false,
                responseType: determineResponseType(matchedKeywords)
              };
              
              foundPosts.unshift(postData);
              newPosts.push(postData);
              analytics.matchesFound++;
              
              console.log(`🎯 Found match in r/${subreddit}: "${post.title}"`);
            }
          }
        }
        
        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ Error scanning r/${subreddit}:`, error.message);
      }
    }
    
    analytics.lastScan = new Date();
    
    // Keep only last 100 posts to prevent memory issues
    foundPosts = foundPosts.slice(0, 100);
    
    res.json({
      success: true,
      scanned: analytics.totalScanned,
      newMatches: newPosts.length,
      newPosts: newPosts,
      analytics: analytics
    });
    
  } catch (error) {
    console.error('❌ Reddit scan error:', error);
    res.status(500).json({
      success: false,
      message: 'Scan failed',
      error: error.message
    });
  }
});

// Get all found posts
router.get('/api/posts', (req, res) => {
  const { limit = 50, posted = null } = req.query;
  
  let posts = foundPosts;
  
  if (posted !== null) {
    posts = posts.filter(post => post.posted === (posted === 'true'));
  }
  
  posts = posts.slice(0, parseInt(limit));
  
  res.json({
    success: true,
    posts: posts,
    total: foundPosts.length,
    analytics: analytics
  });
});

// Post response to a Reddit post
router.post('/api/respond/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const { responseType, customMessage } = req.body;
    
    if (!reddit) {
      return res.status(500).json({
        success: false,
        message: 'Reddit client not configured'
      });
    }
    
    const post = foundPosts.find(p => p.id === postId);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }
    
    if (post.posted) {
      return res.status(400).json({
        success: false,
        message: 'Response already posted'
      });
    }
    
    // Get the response message
    let message = customMessage || RESPONSE_TEMPLATES[responseType] || RESPONSE_TEMPLATES.general;
    
    // Add disclaimer
    message += '\n\n---\n*I\'m the founder of SoundSwap and built this to help musicians like yourself. Hope it helps!*';
    
    console.log(`📝 Posting response to: ${post.title}`);
    
    // Post the comment
    const submission = await reddit.getSubmission(postId);
    const comment = await submission.reply(message);
    
    // Update post status
    post.posted = true;
    post.response = message;
    post.respondedAt = new Date();
    post.commentId = comment.id;
    
    analytics.responsesSent++;
    
    res.json({
      success: true,
      message: 'Response posted successfully',
      commentUrl: `https://reddit.com${comment.permalink}`,
      post: post
    });
    
  } catch (error) {
    console.error('❌ Response posting error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to post response',
      error: error.message
    });
  }
});

// Get analytics
router.get('/api/analytics', (req, res) => {
  res.json({
    success: true,
    analytics: analytics,
    config: {
      subreddits: TARGET_SUBREDDITS,
      keywords: KEYWORDS,
      monitoringSince: analytics.lastScan
    }
  });
});

// Manual post addition
router.post('/api/posts/manual', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!reddit) {
      return res.status(500).json({
        success: false,
        message: 'Reddit client not configured'
      });
    }
    
    // Extract post ID from URL
    const postId = extractPostIdFromUrl(url);
    
    if (!postId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Reddit URL'
      });
    }
    
    const post = await reddit.getSubmission(postId).fetch();
    const content = `${post.title} ${post.selftext}`.toLowerCase();
    const matchedKeywords = KEYWORDS.filter(keyword => 
      content.includes(keyword.toLowerCase())
    );
    
    const postData = {
      id: post.id,
      title: post.title,
      url: `https://reddit.com${post.permalink}`,
      subreddit: post.subreddit.display_name,
      author: post.author.name,
      content: post.selftext.substring(0, 500),
      keywords: matchedKeywords,
      score: post.score,
      commentCount: post.num_comments,
      created: new Date(post.created_utc * 1000),
      posted: false,
      responseType: determineResponseType(matchedKeywords),
      manuallyAdded: true
    };
    
    foundPosts.unshift(postData);
    analytics.matchesFound++;
    
    res.json({
      success: true,
      post: postData,
      message: 'Post added manually'
    });
    
  } catch (error) {
    console.error('❌ Manual post addition error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add post',
      error: error.message
    });
  }
});

// ========== FRONTEND ADMIN PANEL ==========

// Serve the admin panel HTML
router.get('/admin', (req, res) => {
  const adminToken = process.env.ADMIN_SECRET_TOKEN;
  
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>SoundSwap Reddit Monitor</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        header {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        
        h1 {
            color: #fd4e2f;
            margin-bottom: 10px;
        }
        
        .controls {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
        }
        
        button {
            background: #fd4e2f;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.3s;
        }
        
        button:hover {
            background: #e63946;
        }
        
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        
        .analytics {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        
        .stat {
            text-align: center;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
        }
        
        .stat-number {
            font-size: 24px;
            font-weight: bold;
            color: #fd4e2f;
        }
        
        .posts-container {
            display: grid;
            gap: 15px;
        }
        
        .post {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            border-left: 4px solid #fd4e2f;
        }
        
        .post.posted {
            border-left-color: #28a745;
            background: #f8fff9;
        }
        
        .post-header {
            display: flex;
            justify-content: between;
            align-items: start;
            margin-bottom: 10px;
            gap: 10px;
        }
        
        .post-title {
            font-size: 16px;
            font-weight: 600;
            color: #1a1a1a;
            flex: 1;
        }
        
        .post-meta {
            font-size: 12px;
            color: #666;
        }
        
        .post-content {
            margin: 10px 0;
            color: #555;
            line-height: 1.4;
        }
        
        .keywords {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin: 10px 0;
        }
        
        .keyword {
            background: #e9ecef;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            color: #495057;
        }
        
        .post-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
            flex-wrap: wrap;
        }
        
        .status {
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
        }
        
        .status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .status.info {
            background: #cce7ff;
            color: #004085;
            border: 1px solid #b3d7ff;
        }
        
        .loading {
            opacity: 0.6;
            pointer-events: none;
        }
        
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            
            .controls {
                flex-direction: column;
                align-items: stretch;
            }
            
            .post-header {
                flex-direction: column;
            }
            
            .post-actions {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🎯 SoundSwap Reddit Monitor</h1>
            <p>Monitor music subreddits for promotion opportunities</p>
        </header>
        
        <div class="controls">
            <button onclick="scanReddit()" id="scanBtn">🔍 Scan Reddit Now</button>
            <button onclick="loadPosts()">📋 Refresh Posts</button>
            <button onclick="loadAnalytics()">📊 Refresh Analytics</button>
            <div style="flex: 1"></div>
            <span id="status"></span>
        </div>
        
        <div class="analytics" id="analytics">
            <div class="stat">
                <div class="stat-number" id="totalScanned">0</div>
                <div>Posts Scanned</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="matchesFound">0</div>
                <div>Matches Found</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="responsesSent">0</div>
                <div>Responses Sent</div>
            </div>
            <div class="stat">
                <div class="stat-number" id="lastScan">-</div>
                <div>Last Scan</div>
            </div>
        </div>
        
        <div id="posts" class="posts-container">
            <div class="status info">Click "Scan Reddit Now" to find posts...</div>
        </div>
    </div>

    <script>
        const ADMIN_TOKEN = '${adminToken}';
        const API_BASE = window.location.origin + '/api/reddit-admin';
        
        let isLoading = false;
        
        async function apiCall(endpoint, options = {}) {
            if (isLoading) return;
            
            isLoading = true;
            document.body.classList.add('loading');
            
            try {
                const response = await fetch(API_BASE + endpoint, {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-token': ADMIN_TOKEN
                    },
                    ...options
                });
                
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
                
                return await response.json();
            } catch (error) {
                showStatus('Error: ' + error.message, 'error');
                throw error;
            } finally {
                isLoading = false;
                document.body.classList.remove('loading');
            }
        }
        
        function showStatus(message, type = 'info') {
            const statusEl = document.getElementById('status');
            statusEl.textContent = message;
            statusEl.className = \`status \${type}\`;
            setTimeout(() => {
                statusEl.textContent = '';
                statusEl.className = 'status';
            }, 5000);
        }
        
        async function scanReddit() {
            const btn = document.getElementById('scanBtn');
            btn.disabled = true;
            btn.textContent = 'Scanning...';
            
            try {
                const result = await apiCall('/api/scan', { method: 'POST' });
                showStatus(\`Scan complete: \${result.newMatches} new matches found!\`, 'success');
                loadPosts();
                loadAnalytics();
            } catch (error) {
                // Error already handled in apiCall
            } finally {
                btn.disabled = false;
                btn.textContent = '🔍 Scan Reddit Now';
            }
        }
        
        async function loadPosts() {
            try {
                const result = await apiCall('/api/posts?limit=50');
                displayPosts(result.posts);
            } catch (error) {
                // Error already handled
            }
        }
        
        async function loadAnalytics() {
            try {
                const result = await apiCall('/api/analytics');
                const analytics = result.analytics;
                
                document.getElementById('totalScanned').textContent = analytics.totalScanned.toLocaleString();
                document.getElementById('matchesFound').textContent = analytics.matchesFound.toLocaleString();
                document.getElementById('responsesSent').textContent = analytics.responsesSent.toLocaleString();
                document.getElementById('lastScan').textContent = analytics.lastScan ? 
                    new Date(analytics.lastScan).toLocaleTimeString() : 'Never';
            } catch (error) {
                // Error already handled
            }
        }
        
        function displayPosts(posts) {
            const container = document.getElementById('posts');
            
            if (posts.length === 0) {
                container.innerHTML = '<div class="status info">No posts found. Try scanning Reddit.</div>';
                return;
            }
            
            container.innerHTML = posts.map(post => \`
                <div class="post \${post.posted ? 'posted' : ''}">
                    <div class="post-header">
                        <div class="post-title">
                            <a href="\${post.url}" target="_blank" style="color: inherit; text-decoration: none;">
                                \${post.title}
                            </a>
                        </div>
                        <div class="post-meta">
                            r/\${post.subreddit} • \${post.score} pts • \${post.commentCount} comments
                        </div>
                    </div>
                    
                    <div class="post-meta">
                        by \${post.author} • \${new Date(post.created).toLocaleDateString()}
                    </div>
                    
                    <div class="post-content">
                        \${post.content}\${post.content.length === 500 ? '...' : ''}
                    </div>
                    
                    <div class="keywords">
                        \${post.keywords.map(keyword => \`<span class="keyword">\${keyword}</span>\`).join('')}
                    </div>
                    
                    \${!post.posted ? \`
                        <div class="post-actions">
                            <button onclick="postResponse('\${post.id}', 'feedback')">
                                💬 Respond (Feedback)
                            </button>
                            <button onclick="postResponse('\${post.id}', 'promotion')">
                                📢 Respond (Promotion)
                            </button>
                            <button onclick="postResponse('\${post.id}', 'general')">
                                🔗 Respond (General)
                            </button>
                        </div>
                    \` : \`
                        <div class="status success">
                            ✓ Response sent on \${new Date(post.respondedAt).toLocaleString()}
                        </div>
                    \`}
                </div>
            \`).join('');
        }
        
        async function postResponse(postId, responseType) {
            if (!confirm('Are you sure you want to post this response to Reddit?')) {
                return;
            }
            
            try {
                const result = await apiCall(\`/api/respond/\${postId}\`, {
                    method: 'POST',
                    body: JSON.stringify({ responseType })
                });
                
                showStatus('Response posted successfully!', 'success');
                loadPosts();
                loadAnalytics();
                
                // Open the comment in a new tab
                if (result.commentUrl) {
                    window.open(result.commentUrl, '_blank');
                }
            } catch (error) {
                // Error already handled
            }
        }
        
        // Load initial data
        loadPosts();
        loadAnalytics();
        
        // Auto-refresh every 2 minutes
        setInterval(loadPosts, 120000);
        setInterval(loadAnalytics, 120000);
    </script>
</body>
</html>
  `);
});

// Helper functions
function determineResponseType(keywords) {
  if (keywords.some(k => k.includes('feedback'))) return 'feedback';
  if (keywords.some(k => k.includes('promote') || k.includes('marketing'))) return 'promotion';
  return 'general';
}

function extractPostIdFromUrl(url) {
  const match = url.match(/comments\/([a-z0-9]+)/);
  return match ? match[1] : null;
}

export default router;