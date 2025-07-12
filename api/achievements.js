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

export default function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ achievements: achievementsData });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}