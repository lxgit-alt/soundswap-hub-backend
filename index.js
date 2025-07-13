import express from 'express';
import cors from 'cors'; // Add this at the top
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

const app = express();

app.use(cors()); // Add this before your routes
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
  res.send('SoundSwap backend is running!');
});

app.post('/api/signup', async (req, res) => {
  const { name, email, genre, phone, captchaToken } = req.body;
  if (!name || !email || !genre) {
    return res.status(400).json({ error: 'Name, email, and genre are required.' });
  }

  try {
    // Check if user already exists
    const userSnapshot = await db.collection('users').where('email', '==', email).get();
    if (!userSnapshot.empty) {
      return res.status(409).json({ error: 'User already signed up.' });
    }

    // Create new user
    const userRef = db.collection('users').doc();
    const userData = {
      id: userRef.id,
      name,
      email,
      genre,
      phone: phone || null,
      createdAt: FieldValue.serverTimestamp(),
    };
    await userRef.set(userData);

    // Optionally, update spotsClaimed
    const spotsSnapshot = await db.collection('users').get();
    const spotsClaimed = spotsSnapshot.size;

    res.status(201).json({ message: 'Signup successful!', user: { id: userRef.id, name, email, genre, phone }, spotsClaimed });
  } catch (error) {
    res.status(500).json({ error: 'Signup failed.', details: error.message });
  }
});

app.get('/api/spots', async (req, res) => {
  try {
    const usersSnapshot = await db.collection('users').get();
    const spotsClaimed = usersSnapshot.size;
    res.json({ spotsClaimed });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch spots claimed.' });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Change CommonJS export to ES module export
export default app;
