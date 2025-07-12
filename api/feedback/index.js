import WebSocket from 'ws';
import { verifyIdToken } from '../../lib/firebaseAdmin.js';
import { db } from '../../lib/firebaseAdmin.js';

// WebSocket server setup (singleton pattern for hot reloads in dev)
const wss = global.wss || new WebSocket.Server({ noServer: true });
if (!global.wss) global.wss = wss;

wss.on('connection', (ws, req) => {
  let userId = null;
  let unsubscribeFeedback = null;
  let unsubscribePairing = null;
  let unsubscribePoints = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'auth') {
        const decoded = await verifyIdToken(data.token);
        userId = decoded.uid;
        console.log(`Authenticated user: ${userId}`);

        // Listen for Firestore changes after auth
        const feedbackRef = db.collection('feedback');
        const pairingRef = db.collection('pairings');
        const userRef = db.collection('users').doc(userId);

        unsubscribeFeedback = feedbackRef
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

        unsubscribePairing = pairingRef
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

        unsubscribePoints = userRef.onSnapshot(doc => {
          const points = doc.data()?.feedbackPoints || 0;
          ws.send(JSON.stringify({
            type: 'points',
            points
          }));
        });
      }
    } catch (error) {
      console.error('WebSocket auth error:', error);
      ws.close();
    }
  });

  ws.on('close', () => {
    if (unsubscribeFeedback) unsubscribeFeedback();
    if (unsubscribePairing) unsubscribePairing();
    if (unsubscribePoints) unsubscribePoints();
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