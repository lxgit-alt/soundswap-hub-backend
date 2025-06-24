const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const setupWebSocket = (server) => {
  const wss = new WebSocket.Server({ server });

  const clients = new Map();

  wss.on('connection', async (ws, req) => {
    // Extract token from query string
    const token = new URL(req.url, 'ws://localhost').searchParams.get('token');
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      clients.set(decoded.id, ws);

      ws.on('close', () => {
        clients.delete(decoded.id);
      });

    } catch (error) {
      ws.close();
    }
  });

  // Helper function to broadcast updates
  const broadcastUpdate = (userId, data) => {
    const client = clients.get(userId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  };

  return { broadcastUpdate };
};

module.exports = setupWebSocket;