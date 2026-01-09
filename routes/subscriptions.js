import { db, auth } from '../lib/firebase.js';

export default async function handler(req, res) {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  try {
    const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
    const action = urlParams.get('action');

    // Authenticate user
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const idToken = authHeader.split(' ')[1];
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = decodedToken.uid;

    // --- GET: /api/subscriptions?action=current ---
    if (req.method === 'GET' && action === 'current') {
      try {
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
          return res.status(404).json({ error: 'User not found' });
        }

        const userData = userDoc.data();
        const subscription = userData.subscription || {
          plan: 'free',
          status: 'active',
          features: {
            maxTracks: 3,
            feedbackRequests: 10,
            prioritySupport: false,
            analyticsAccess: false,
            collaborationTools: false
          }
        };

        return res.status(200).json({ subscription });
      } catch (error) {
        console.error('Get subscription error:', error);
        return res.status(500).json({ error: 'Failed to get subscription' });
      }
    }

    // --- POST: /api/subscriptions?action=upgrade ---
    if (req.method === 'POST' && action === 'upgrade') {
      const { plan, paymentMethod } = req.body;

      if (!plan || !['creator', 'pro'].includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan' });
      }

      try {
        // Define plan features
        const planFeatures = {
          creator: {
            maxTracks: 25,
            feedbackRequests: 100,
            prioritySupport: false,
            analyticsAccess: true,
            collaborationTools: true,
            price: 19
          },
          pro: {
            maxTracks: -1, // unlimited
            feedbackRequests: -1, // unlimited
            prioritySupport: true,
            analyticsAccess: true,
            collaborationTools: true,
            advancedAnalytics: true,
            price: 49
          }
        };

        // Mock payment processing (replace with Stripe/PayPal)
        const paymentResult = await processPayment(paymentMethod, planFeatures[plan].price);
        
        if (!paymentResult.success) {
          return res.status(400).json({ error: 'Payment failed' });
        }

        // Update user subscription
        const subscription = {
          plan,
          status: 'active',
          features: planFeatures[plan],
          paymentId: paymentResult.paymentId,
          startDate: new Date(),
          nextBilling: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          updatedAt: new Date()
        };

        await db.collection('users').doc(userId).update({ subscription });

        // Log the upgrade
        await db.collection('subscriptionHistory').add({
          userId,
          action: 'upgrade',
          fromPlan: 'free',
          toPlan: plan,
          paymentId: paymentResult.paymentId,
          timestamp: new Date()
        });

        return res.status(200).json({ 
          success: true, 
          subscription,
          message: `Successfully upgraded to ${plan} plan!`
        });
      } catch (error) {
        console.error('Upgrade error:', error);
        return res.status(500).json({ error: 'Failed to upgrade subscription' });
      }
    }

    // --- GET: /api/subscriptions?action=features ---
    if (req.method === 'GET' && action === 'features') {
      try {
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const subscription = userData.subscription || { plan: 'free' };

        // Check feature access based on plan
        const hasFeatureAccess = (feature) => {
          switch (subscription.plan) {
            case 'pro':
              return true; // All features
            case 'creator':
              return ['maxTracks', 'feedbackRequests', 'analyticsAccess', 'collaborationTools'].includes(feature);
            default:
              return ['maxTracks', 'feedbackRequests'].includes(feature);
          }
        };

        return res.status(200).json({
          plan: subscription.plan,
          features: subscription.features || {},
          access: {
            canUploadTrack: hasFeatureAccess('maxTracks'),
            canRequestFeedback: hasFeatureAccess('feedbackRequests'),
            canAccessAnalytics: hasFeatureAccess('analyticsAccess'),
            canUseCollaborationTools: hasFeatureAccess('collaborationTools'),
            hasPrioritySupport: hasFeatureAccess('prioritySupport')
          }
        });
      } catch (error) {
        console.error('Features check error:', error);
        return res.status(500).json({ error: 'Failed to check features' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Subscriptions handler error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Mock payment processing function
async function processPayment(paymentMethod, amount) {
  // In production, integrate with Stripe, PayPal, etc.
  console.log(`Processing payment: $${amount} with method:`, paymentMethod);
  
  // Simulate payment processing
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return {
    success: true,
    paymentId: `pay_${Date.now()}`,
    amount,
    currency: 'USD'
  };
}
