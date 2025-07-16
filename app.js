import express from 'express';
import cors from 'cors';
import spotsRoutes from './api/spots.js';
import pairingsRoutes from './api/pairings.js';
import feedbackRoutes from './api/feedback.js'; // Add this import
import achievementsRoutes from './api/achievements.js';
import founderActivationRoutes from './api/founder-activation.js';
import auditFoundersRoutes from './api/audit-founders.js';
import leaderboardRoutes from './api/leaderboard.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({
  origin: 'http://localhost:5173', // or '*' for all origins (not recommended for production)
  credentials: true
}));

app.use('/api/spots', spotsRoutes);
app.use('/api/pairings', pairingsRoutes);
app.use('/api/feedback', feedbackRoutes); // Add this line
app.use('/api/achievements', achievementsRoutes);
app.use('/api/founder-activation', founderActivationRoutes);
app.use('/api/audit-founders', auditFoundersRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

app.listen(3000, () => {
  console.log('Backend running on http://localhost:3000');
});