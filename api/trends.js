import express from 'express';
import { TrendsService } from '../services/trendsService.js';

const router = express.Router();

// Get music industry trends
router.get('/api/trends/music', async (req, res) => {
  try {
    const trends = await TrendsService.getMusicTrends();
    res.json({
      success: true,
      data: trends,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Trends API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get real-time trends
router.get('/api/trends/realtime', async (req, res) => {
  try {
    const { geo = 'US', category = 'e' } = req.query; // 'e' for entertainment
    const trends = await TrendsService.getRealTimeTrends(geo, category);
    
    res.json({
      success: true,
      data: trends,
      geo: geo,
      category: category
    });
  } catch (error) {
    console.error('Real-time trends error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get trends for specific keywords
router.post('/api/trends/keywords', async (req, res) => {
  try {
    const { keywords, startTime, endTime } = req.body;
    
    if (!keywords || !Array.isArray(keywords)) {
      return res.status(400).json({
        success: false,
        error: 'Keywords array is required'
      });
    }

    const trends = await TrendsService.getInterestOverTime(keywords, startTime, endTime);
    
    res.json({
      success: true,
      data: trends,
      keywords: keywords
    });
  } catch (error) {
    console.error('Keywords trends error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get content ideas based on trends
router.get('/api/trends/content-ideas', async (req, res) => {
  try {
    const musicTrends = await TrendsService.getMusicTrends();
    
    // Analyze trends to generate content ideas
    const contentIdeas = generateContentIdeas(musicTrends);
    
    res.json({
      success: true,
      data: contentIdeas,
      source: 'Google Trends Analysis'
    });
  } catch (error) {
    console.error('Content ideas error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to generate content ideas from trends
function generateContentIdeas(trendsData) {
  const ideas = [];
  
  // Extract rising related queries
  const relatedQueries = trendsData.relatedQueries;
  
  Object.keys(relatedQueries).forEach(keyword => {
    const queries = relatedQueries[keyword];
    
    if (queries && queries.default && queries.default.rankedList) {
      queries.default.rankedList.forEach(list => {
        list.rankedKeyword.forEach(item => {
          if (item.value && item.formattedValue) {
            // Look for rising queries (you might need to adjust based on actual data structure)
            if (item.value.hasOwnProperty('isRising')) {
              ideas.push({
                topic: item.value.query,
                trend: 'rising',
                sourceKeyword: keyword,
                suggestion: `Write about: "${item.value.query}" in context of ${keyword}`
              });
            }
          }
        });
      });
    }
  });
  
  // Add some default content ideas based on common trends
  const defaultIdeas = [
    {
      topic: 'Music Promotion Strategies 2024',
      trend: 'seasonal',
      suggestion: 'Annual strategy update post'
    },
    {
      topic: 'Social Media for Musicians',
      trend: 'consistent',
      suggestion: 'Guide to platform-specific promotion'
    },
    {
      topic: 'Streaming Platform Algorithms',
      trend: 'rising',
      suggestion: 'How to optimize for Spotify/Apple Music'
    }
  ];
  
  return [...ideas, ...defaultIdeas].slice(0, 10); // Return top 10 ideas
}

export default router;