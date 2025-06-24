import express from 'express';
import admin from 'firebase-admin';
import { sendAuditAlertEmail } from '../src/utils/emailService.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const foundersSnapshot = await admin.firestore()
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
    const auditRef = admin.firestore().collection('audits').doc();
    await auditRef.set({
      timestamp: now.toISOString(),
      totalFounders: foundersSnapshot.size,
      issuesFound: auditResults.length,
      results: auditResults
    });
    
    res.status(200).json({
      success: true,
      audited: foundersSnapshot.size,
      issues: auditResults.length
    });
  } catch (error) {
    console.error('Audit error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;