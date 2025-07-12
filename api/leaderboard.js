const leaders = [
  { name: 'NeonDreams', points: 2890 },
  { name: 'EchoBeats', points: 2500 },
  { name: 'SynthWave', points: 2100 },
  { name: 'GrooveMaster', points: 1800 },
  { name: 'Bassline', points: 1500 }
];

export default function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ leaders });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}