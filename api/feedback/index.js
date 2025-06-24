import WebSocket from 'ws';
import { verifyIdToken } from '../../lib/firebaseAdmin';
import { db } from '../../lib/firebaseAdmin';

// WebSocket server setup
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
  let userId = null;
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'auth') {
        const decoded = await verifyIdToken(data.token);
        userId = decoded.uid;
        console.log(`Authenticated user: ${userId}`);
      }
    } catch (error) {
      console.error('WebSocket auth error:', error);
      ws.close();
    }
  });
  
  // Listen for Firestore changes
  const feedbackRef = db.collection('feedback');
  const pairingRef = db.collection('pairings');
  
  const unsubscribeFeedback = feedbackRef
    .where('toUserId', '==', userId)
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          ws.send(JSON.stringify({
            type: 'feedback',
            feedback: change.doc.data()
          }));
        }
      });
    });
  
  const unsubscribePairing = pairingRef
    .where('participants', 'array-contains', userId)
    .where('status', '==', 'active')
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          ws.send(JSON.stringify({
            type: 'pairing',
            pairing: change.doc.data()
          }));
        }
      });
    });
  
  // Handle points updates
  const userRef = db.collection('users').doc(userId);
  const unsubscribePoints = userRef.onSnapshot(doc => {
    const points = doc.data()?.feedbackPoints || 0;
    ws.send(JSON.stringify({
      type: 'points',
      points
    }));
  });
  
  ws.on('close', () => {
    unsubscribeFeedback();
    unsubscribePairing();
    unsubscribePoints();
    console.log(`Connection closed for user: ${userId}`);
  });
});

export default function handler(req, res) {
  // Handle HTTP to WebSocket upgrade
  if (!req.headers.upgrade || req.headers.upgrade.toLowerCase() !== 'websocket') {
    return res.status(400).json({ error: 'WebSocket upgrade required' });
  }

  res.socket.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  });
  
  res.end();
}

export const config = {
  api: {
    bodyParser: false
  }
};