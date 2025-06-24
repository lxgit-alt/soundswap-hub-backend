const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const router = express.Router();

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

router.use(cors(corsOptions));

// Auth middleware
const validateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

router.post('/analytics', validateToken, async (req, res) => {
  try {
    const { eventType, trackUrl, timestamp } = req.body;
    
    // Log analytics event to your database
    await db.analytics.create({
      userId: req.user.id,
      eventType,
      trackUrl,
      timestamp
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to log analytics' });
  }
});

module.exports = router;