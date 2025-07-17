import pointsHandler from './points.js';
import analyticsHandler from './analytics.js';
import feedbackHandler from './feedback.js';
import userHandler from './user.js';
import pairingsHandler from './pairings.js';
import testHandler from './test.js';

export default async function handler(req, res) {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  try {
    const { pathname, search } = new URL(req.url, `http://${req.headers.host}`);
    
    console.log(`API Request: ${req.method} ${pathname}${search}`);

    // Create a new request object with the correct URL
    const modifiedReq = {
      ...req,
      url: pathname + (search || '')
    };

    // Route to appropriate handler
    if (pathname.startsWith('/api/points')) {
      return await pointsHandler(modifiedReq, res);
    } else if (pathname.startsWith('/api/analytics')) {
      return await analyticsHandler(modifiedReq, res);
    } else if (pathname.startsWith('/api/feedback')) {
      return await feedbackHandler(modifiedReq, res);
    } else if (pathname.startsWith('/api/user')) {
      return await userHandler(modifiedReq, res);
    } else if (pathname.startsWith('/api/pairings')) {
      return await pairingsHandler(modifiedReq, res);
    } else if (pathname.startsWith('/api/test')) {
      return await testHandler(modifiedReq, res);
    } else if (pathname === '/health') {
      return res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
    }

    return res.status(404).json({ error: 'API endpoint not found', path: pathname });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message,
      stack: error.stack 
    });
  }
}
