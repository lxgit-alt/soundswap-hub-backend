import express from 'express';

const router = express.Router();

// Dummy data for demonstration. Replace with real DB queries as needed.
const achievementsData = [
  {
    type: 'first_review',
    title: 'First Review',
    desc: 'Complete your first track review',
    progress: 100
  },
  {
    type: 'power_reviewer',
    title: 'Power Reviewer',
    desc: 'Review 50 tracks',
    progress: 65
  },
  {
    type: 'top_10_percent',
    title: 'Top 10%',
    desc: 'Be in the top 10% of reviewers',
    progress: 20
  }
];

// GET /api/achievements
router.get('/', (req, res) => {
  res.json({ achievements: achievementsData });
});

export default router;