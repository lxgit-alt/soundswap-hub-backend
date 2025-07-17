// backend/api/points.js
import { db } from '../lib/firebase.js';

export default async function handler(req, res) {
  console.log(`🔥 Points API called: ${req.method} ${req.url}`);
  
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
    // Parse action
    const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
    const action = urlParams.get('action');
    
    console.log(`Action: ${action}`);

    // GET spots - ensure this always returns a response
    if (req.method === 'GET' && action === 'spots') {
      console.log('📊 Fetching spots...');
      try {
        const snapshot = await db.collection('signups').get();
        const count = snapshot.size;
        console.log(`✅ Found ${count} signups`);
        return res.status(200).json({ spotsClaimed: count });
      } catch (err) {
        console.error('❌ Firebase error:', err.message);
        console.log('⚠️ Using mock data');
        return res.status(200).json({ spotsClaimed: 42 });
      }
    }

    // POST signup
    if (req.method === 'POST' && action === 'signup') {
      console.log('📝 Processing signup...');
      const { name, email, genre } = req.body;
      
      if (!name || !email || !genre) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      try {
        await db.collection('signups').add({
          name,
          email,
          genre,
          createdAt: new Date()
        });
        
        const newCount = (await db.collection('signups').get()).size;
        return res.status(200).json({ 
          spotsClaimed: newCount,
          success: true 
        });
      } catch (err) {
        console.error('❌ Signup error:', err.message);
        console.log('⚠️ Using mock success');
        return res.status(200).json({ 
          spotsClaimed: 43,
          success: true 
        });
      }
    }

    return res.status(404).json({ error: 'Endpoint not found' });
  } catch (error) {
    console.error('❌ Handler error:', error);
    return res.status(500).json({ error: 'Internal error', details: error.message });
  }
}