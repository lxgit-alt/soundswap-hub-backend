import rateLimit from 'express-rate-limit';

// Create rate limiter for doodle art generation
export const doodleRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Please wait 15 minutes before generating more artwork'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to your route
// In doodleArtRoutes.js:
// import { doodleRateLimiter } from '../middleware/rateLimiter.js';
// router.post('/generate', doodleRateLimiter, async (req, res) => { ... });