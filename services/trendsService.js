import googleTrends from 'google-trends-api';

export class TrendsService {
  
  // Get real-time trending searches
  static async getRealTimeTrends(geo = 'US', category = 'h') {
    try {
      const results = await googleTrends.realTimeTrends({
        geo: geo,
        category: category, // 'h' for all categories, 'e' for entertainment
        timezone: -420 // UTC-7
      });
      
      return JSON.parse(results);
    } catch (error) {
      console.error('Error fetching real-time trends:', error);
      throw new Error('Failed to fetch trends data');
    }
  }

  // Get daily trends for music-related topics
  static async getDailyTrends(geo = 'US') {
    try {
      const results = await googleTrends.dailyTrends({
        trendDate: new Date(),
        geo: geo,
      });
      
      return JSON.parse(results);
    } catch (error) {
      console.error('Error fetching daily trends:', error);
      throw new Error('Failed to fetch daily trends');
    }
  }

  // Get interest over time for specific music keywords
  static async getInterestOverTime(keywords, startTime, endTime) {
    try {
      const results = await googleTrends.interestOverTime({
        keyword: keywords,
        startTime: startTime || new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)), // Last 30 days
        endTime: endTime || new Date(),
        geo: 'US',
      });
      
      return JSON.parse(results);
    } catch (error) {
      console.error('Error fetching interest over time:', error);
      throw new Error('Failed to fetch interest data');
    }
  }

  // Get related queries for music topics
  static async getRelatedQueries(keyword) {
    try {
      const results = await googleTrends.relatedQueries({
        keyword: keyword,
        startTime: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)),
        endTime: new Date(),
        geo: 'US',
      });
      
      return JSON.parse(results);
    } catch (error) {
      console.error('Error fetching related queries:', error);
      throw new Error('Failed to fetch related queries');
    }
  }

  // Music-specific trend analysis
  static async getMusicTrends() {
    const musicKeywords = [
      'music promotion',
      'how to promote music',
      'independent music',
      'music marketing',
      'spotify promotion',
      'music distribution',
      'music streaming',
      'artist promotion'
    ];

    try {
      const trends = await this.getInterestOverTime(musicKeywords);
      const relatedQueries = await Promise.all(
        musicKeywords.map(keyword => this.getRelatedQueries(keyword))
      );

      return {
        overallTrends: trends,
        relatedQueries: relatedQueries.reduce((acc, curr, index) => {
          acc[musicKeywords[index]] = curr;
          return acc;
        }, {}),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error in getMusicTrends:', error);
      throw error;
    }
  }
}