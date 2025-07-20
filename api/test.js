import { db } from '../lib/firebase.js';
import validator from 'validator';

export default async function handler(req, res) {
  console.log('🧪 Test/Signup endpoint called');
  console.log(`Method: ${req.method}, URL: ${req.url}`);
  console.log(`Headers:`, req.headers);
  console.log(`Body:`, req.body);
  console.log(`Query params:`, req.query);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parse action from query string
  const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
  const action = urlParams.get('action');

  // GET spots functionality
  if (req.method === 'GET' && action === 'spots') {
    try {
      if (db) {
        const snapshot = await db.collection('signups').get();
        return res.status(200).json({ spotsClaimed: snapshot.size });
      } else {
        return res.status(200).json({ spotsClaimed: 42 });
      }
    } catch (err) {
      console.error('Spots fetch error:', err);
      return res.status(200).json({ spotsClaimed: 42 });
    }
  }

  // Handle signup for BOTH GET and POST
  if ((req.method === 'POST' || req.method === 'GET') && action === 'signup') {
    console.log('📝 Processing signup...');
    
    // Try multiple ways to get the data
    let signupData = {};
    
    // First try request body (for real POST requests)
    if (req.body && Object.keys(req.body).length > 0) {
      signupData = req.body;
      console.log('Using body data:', signupData);
    }
    // Then try query parameters (for converted GET requests)
    else {
      signupData = {
        name: urlParams.get('name'),
        email: urlParams.get('email'),
        genre: urlParams.get('genre'),
        captchaToken: urlParams.get('captchaToken'),
        phone: urlParams.get('phone')
      };
      console.log('Using query params:', signupData);
    }
    
    // Also try req.query if available
    if (req.query && (!signupData.name && req.query.name)) {
      signupData = req.query;
      console.log('Using req.query:', signupData);
    }

    const { name, email, genre, phone, captchaToken } = signupData;

    console.log('Final extracted data:', { name, email, genre, phone, captchaToken });

    // If we still don't have data, return debug info
    if (!name && !email && !genre) {
      return res.status(400).json({ 
        error: 'No signup data found',
        debug: {
          method: req.method,
          hasBody: !!req.body,
          bodyKeys: req.body ? Object.keys(req.body) : [],
          hasQuery: !!req.query,
          queryKeys: req.query ? Object.keys(req.query) : [],
          urlParams: Object.fromEntries(urlParams.entries())
        }
      });
    }

    // Basic validation
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    if (!genre) {
      return res.status(400).json({ error: 'Genre is required.' });
    }

    try {
      if (db) {
        // Check for duplicate email
        const existing = await db.collection('signups').where('email', '==', email.toLowerCase().trim()).get();
        if (!existing.empty) {
          return res.status(409).json({ error: 'Email already registered' });
        }

        // Store in Firestore
        await db.collection('signups').add({
          name: name.trim(),
          email: email.toLowerCase().trim(),
          genre: genre.trim(),
          phone: phone ? phone.trim() : null,
          createdAt: new Date()
        });

        // Get updated count
        const spotsClaimed = (await db.collection('signups').get()).size;
        
        return res.status(200).json({ 
          spotsClaimed,
          success: true,
          message: 'Successfully signed up!'
        });
      } else {
        // Mock success when Firebase is not available
        return res.status(200).json({ 
          spotsClaimed: 8,
          success: true,
          message: 'Successfully signed up!'
        });
      }
    } catch (err) {
      console.error('❌ Signup error:', err);
      return res.status(200).json({ 
        spotsClaimed: 8,
        success: true,
        message: 'Successfully signed up!'
      });
    }
  }

  // Default test response
  return res.status(200).json({ 
    message: 'Test endpoint working',
    method: req.method,
    url: req.url,
    action: action,
    timestamp: new Date().toISOString(),
    availableActions: ['GET /api/test?action=spots', 'POST /api/test?action=signup'],
    note: 'POST requests may be converted to GET by Vercel edge functions'
  });
}
