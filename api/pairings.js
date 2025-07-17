import { db } from '../lib/firebase.js';

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(200).end();
  }

  // Set CORS headers for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  try {
    // Parse action from query string
    const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
    const action = urlParams.get('action');
    
    console.log(`🔄 Pairings API - Action: ${action}`);

    // --- GET: /api/pairings?action=current (get latest pairing) ---
    if (req.method === 'GET' && action === 'current') {
      try {
        console.log('🎯 Fetching current pairing...');
        const snapshot = await db.collection('pairings')
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        
        if (!snapshot.empty) {
          const current = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
          console.log(`✅ Current pairing found: ${current.id}`);
          return res.status(200).json({ current });
        } else {
          console.log('⚠️ No current pairings found, creating sample data');
          // Create a sample pairing for demonstration
          const samplePairing = {
            user1Id: 'user-demo-1',
            user2Id: 'user-demo-2',
            user1Name: 'Alex Producer',
            user2Name: 'Taylor Artist',
            genre: 'Electronic',
            status: 'active',
            createdAt: new Date(),
            deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            feedbackExchanged: {
              user1ToUser2: false,
              user2ToUser1: false
            }
          };
          
          const docRef = await db.collection('pairings').add(samplePairing);
          console.log(`✅ Created sample pairing: ${docRef.id}`);
          return res.status(200).json({ current: { id: docRef.id, ...samplePairing } });
        }
      } catch (err) {
        console.error('❌ Pairing fetch error:', err);
        return res.status(500).json({ error: 'Failed to fetch current pairing' });
      }
    }

    // --- GET: /api/pairings?action=history (get user's pairing history) ---
    if (req.method === 'GET' && action === 'history') {
      const userId = urlParams.get('userId');
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      try {
        console.log(`📜 Fetching pairing history for user: ${userId}`);
        
        // Query for pairings where user is either user1 or user2
        const snapshot1 = await db.collection('pairings')
          .where('user1Id', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get();
        
        const snapshot2 = await db.collection('pairings')
          .where('user2Id', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(5)
          .get();
        
        // Combine and deduplicate results
        const allDocs = [...snapshot1.docs, ...snapshot2.docs];
        const uniqueDocs = allDocs.filter((doc, index, self) => 
          self.findIndex(d => d.id === doc.id) === index
        );
        
        const history = uniqueDocs
          .sort((a, b) => {
            const aTime = a.data().createdAt?.toDate?.() || new Date(a.data().createdAt);
            const bTime = b.data().createdAt?.toDate?.() || new Date(b.data().createdAt);
            return bTime - aTime;
          })
          .slice(0, 10)
          .map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt
          }));
        
        console.log(`✅ Found ${history.length} past pairings for user ${userId}`);
        return res.status(200).json({ history });
      } catch (err) {
        console.error('❌ History fetch error:', err);
        return res.status(500).json({ error: 'Failed to fetch pairing history' });
      }
    }

    // --- POST: /api/pairings?action=create (create new pairing) ---
    if (req.method === 'POST' && action === 'create') {
      const { user1Id, user2Id, user1Name, user2Name, genre } = req.body;
      
      if (!user1Id || !user2Id) {
        return res.status(400).json({ error: 'user1Id and user2Id are required' });
      }

      try {
        console.log(`🔗 Creating pairing: ${user1Id} <-> ${user2Id}`);
        const newPairing = {
          user1Id,
          user2Id,
          user1Name: user1Name || 'Unknown Artist',
          user2Name: user2Name || 'Unknown Artist',
          genre: genre || 'Mixed',
          status: 'active',
          createdAt: new Date(),
          deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          feedbackExchanged: {
            user1ToUser2: false,
            user2ToUser1: false
          },
          tracks: {
            user1Track: null,
            user2Track: null
          }
        };

        const docRef = await db.collection('pairings').add(newPairing);
        console.log(`✅ Pairing created with ID: ${docRef.id}`);
        
        return res.status(201).json({ 
          id: docRef.id,
          ...newPairing,
          success: true 
        });
      } catch (err) {
        console.error('❌ Pairing creation error:', err);
        return res.status(500).json({ error: 'Failed to create pairing' });
      }
    }

    // --- GET: /api/pairings?action=stats (get pairing statistics) ---
    if (req.method === 'GET' && action === 'stats') {
      try {
        console.log('📊 Fetching real pairing stats...');
        
        // Get total pairings
        const totalSnapshot = await db.collection('pairings').get();
        const totalPairings = totalSnapshot.size;
        
        // Get active pairings
        const activeSnapshot = await db.collection('pairings')
          .where('status', '==', 'active')
          .get();
        const activePairings = activeSnapshot.size;
        
        // Get completed pairings
        const completedSnapshot = await db.collection('pairings')
          .where('status', '==', 'completed')
          .get();
        const completedPairings = completedSnapshot.size;
        
        // Calculate completion rate
        const completionRate = totalPairings > 0 ? 
          (completedPairings / totalPairings * 100).toFixed(1) : 0;
        
        const stats = {
          total: totalPairings,
          active: activePairings,
          completed: completedPairings,
          completionRate: parseFloat(completionRate)
        };
        
        console.log(`✅ Real stats: ${JSON.stringify(stats)}`);
        return res.status(200).json({ stats });
      } catch (err) {
        console.error('❌ Stats fetch error:', err);
        return res.status(500).json({ error: 'Failed to fetch pairing stats' });
      }
    }

    // --- POST: /api/pairings?action=complete (mark pairing as completed) ---
    if (req.method === 'POST' && action === 'complete') {
      const { pairingId } = req.body;
      
      if (!pairingId) {
        return res.status(400).json({ error: 'pairingId is required' });
      }

      try {
        await db.collection('pairings').doc(pairingId).update({
          status: 'completed',
          completedAt: new Date()
        });
        
        console.log(`✅ Pairing ${pairingId} marked as completed`);
        return res.status(200).json({ success: true });
      } catch (err) {
        console.error('❌ Complete pairing error:', err);
        return res.status(500).json({ error: 'Failed to complete pairing' });
      }
    }

    return res.status(404).json({ error: 'Endpoint not found' });
  } catch (error) {
    console.error('❌ Pairings handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}