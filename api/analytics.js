import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import jwt from 'jsonwebtoken';
import { sendAuditAlertEmail } from '../src/utils/emailService.js';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parse action from query string
  let action;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    action = url.searchParams.get('action');
  } catch {
    action = undefined;
  }

  // --- GET: /api/analytics?action=achievements ---
  if (req.method === 'GET' && action === 'achievements') {
    try {
      const snapshot = await db.collection('achievements').get();
      const achievements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json({ achievements });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch achievements' });
    }
  }

  // --- GET: /api/analytics?action=leaderboard ---
  if (req.method === 'GET' && action === 'leaderboard') {
    try {
      const snapshot = await db.collection('users')
        .orderBy('points', 'desc')
        .limit(5)
        .get();

      const leaders = snapshot.docs.map(doc => ({
        name: doc.data().name,
        points: doc.data().points || 0,
      }));

      return res.json({ leaders });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to fetch leaderboard', details: error.message });
    }
  }

  // --- POST: /api/analytics?action=audit-founder ---
  if (req.method === 'POST' && action === 'audit-founder') {
    try {
      const foundersSnapshot = await db
        .collection('users')
        .where('isFounder', '==', true)
        .get();

      const auditResults = [];
      const now = new Date();

      for (const doc of foundersSnapshot.docs) {
        const user = doc.data();
        const issues = [];

        if (!user.features?.premiumAccess) issues.push('Permanent premium access');
        if (!user.features?.priorityRequests) issues.push('Priority feature requests');
        if (!user.features?.founderBadge) issues.push('Exclusive founder badge');
        if (user.features?.bonusPoints !== 500) issues.push(`Bonus points (${user.features?.bonusPoints || 0}/500)`);
        if (!user.features?.earlyAccess) issues.push('Early access privileges');

        if (issues.length > 0) {
          auditResults.push({
            email: user.email,
            issues,
            lastChecked: now.toISOString()
          });

          // Send alert to admin
          await sendAuditAlertEmail(
            process.env.ADMIN_EMAIL,
            issues,
            user.email
          );
        }
      }

      // Save audit results to Firestore
      const auditRef = db.collection('audits').doc();
      await auditRef.set({
        timestamp: now.toISOString(),
        totalFounders: foundersSnapshot.size,
        issuesFound: auditResults.length,
        results: auditResults
      });

      return res.status(200).json({
        success: true,
        audited: foundersSnapshot.size,
        issues: auditResults.length
      });
    } catch (error) {
      console.error('Audit error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // --- POST: /api/analytics (default: log analytics event) ---
  if (req.method === 'POST') {
    // Auth middleware
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Log analytics event to Firestore
    try {
      const { eventType, trackUrl, timestamp } = req.body;
      await db.collection('analytics').add({
        userId: decoded.id,
        eventType,
        trackUrl,
        timestamp: timestamp || new Date(),
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Analytics error:', error);
      return res.status(500).json({ error: 'Failed to log analytics' });
    }
  }

  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
}