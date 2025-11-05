// backend/services/trendsCron.js
import cron from 'node-cron';
import { TrendsService } from './trendsService.js';

// Run every 6 hours to get fresh trends
cron.schedule('0 */6 * * *', async () => {
  console.log('🔄 Updating music trends...');
  try {
    const trends = await TrendsService.getMusicTrends();
    // You could save this to a database or send to your admin panel
    console.log('✅ Trends updated successfully');
  } catch (error) {
    console.error('❌ Failed to update trends:', error);
  }
});