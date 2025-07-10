import express from 'express';
const router = express.Router();

// Dummy data for now; replace with real DB query later
const leaders = [
  { name: 'NeonDreams', points: 2890 },
  { name: 'EchoBeats', points: 2500 },
  { name: 'SynthWave', points: 2100 },
  { name: 'GrooveMaster', points: 1800 },
  { name: 'Bassline', points: 1500 }
];

router.get('/', (req, res) => {
  res.json({ leaders });
});

export default router;