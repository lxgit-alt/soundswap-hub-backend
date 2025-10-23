const { getFirestore } = require('firebase-admin/firestore');
const { SUBSCRIPTION_TIERS } = require('../utils/subscriptionPlans');

// Initialize Firestore
const db = getFirestore();

/**
 * Subscription validation middleware
 * 
 * @param {Object} options Configuration options
 * @param {string} options.feature Feature being accessed (tracks, feedback, etc)
 * @param {string} options.minimumTier Minimum subscription tier required
 */
const subscriptionValidator = (options = {}) => {
  return async (req, res, next) => {
    try {
      const { feature = 'general', minimumTier = SUBSCRIPTION_TIERS.FREE } = options;
      const userId = req.user?.uid;
      
      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Authentication required' 
        });
      }
      
      // Get user's subscription tier
      const userDoc = await db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      const userData = userDoc.data();
      const userTier = userData.subscription || SUBSCRIPTION_TIERS.FREE;
      
      // Check if user has required tier
      if (!hasRequiredTier(userTier, minimumTier)) {
        return res.status(403).json({ 
          success: false, 
          message: `This action requires a ${minimumTier} subscription or higher` 
        });
      }
      
      // For track submissions and feedback, check usage limits
      if (['tracks', 'feedback'].includes(feature)) {
        const limitCheck = await checkUsageLimits(userId, userTier, feature);
        
        if (!limitCheck.withinLimits) {
          return res.status(429).json({ 
            success: false, 
            message: limitCheck.message,
            resetTime: limitCheck.resetTime,
            currentUsage: limitCheck.currentUsage,
            limit: limitCheck.limit
          });
        }
      }
      
      // All checks passed
      next();
      
    } catch (error) {
      console.error('Subscription validation error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to validate subscription' 
      });
    }
  };
};

// Helper function to check if user's tier meets the required tier
const hasRequiredTier = (userTier, requiredTier) => {
  const tierHierarchy = {
    [SUBSCRIPTION_TIERS.BASIC]: 0,
    [SUBSCRIPTION_TIERS.CREATOR]: 1,
    [SUBSCRIPTION_TIERS.PRO]: 2,
    [SUBSCRIPTION_TIERS.FOUNDER]: 3
  };
  
  const userLevel = tierHierarchy[userTier] || 0;
  const requiredLevel = tierHierarchy[requiredTier] || 0;
  
  return userLevel >= requiredLevel;
};

// Helper function to check usage limits
const checkUsageLimits = async (userId, userTier, feature) => {
  const now = new Date();
  let collection, timeField, timeValue, limitCount, resetMessage;
  
  // Set parameters based on the feature
  if (feature === 'tracks') {
    // For tracks, we check weekly limits
    collection = 'submissions';
    
    // Set the start of the week
    timeField = 'createdAt';
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Go back to Sunday
    timeValue = startOfWeek;
    
    // Set limit based on tier
    switch (userTier) {
      case SUBSCRIPTION_TIERS.FOUNDER:
      case SUBSCRIPTION_TIERS.PRO:
        limitCount = Infinity;
        break;
      case SUBSCRIPTION_TIERS.CREATOR:
        limitCount = 4; // 4 per week
        break;
      case SUBSCRIPTION_TIERS.BASIC:
      default:
        limitCount = 2; // 2 per week
    }
    
    resetMessage = "Weekly track submission limit reached. Resets on Sunday at midnight.";
    
  } else if (feature === 'feedback') {
    // For feedback, we check daily limits
    collection = 'feedback';
    
    // Set the start of the day
    timeField = 'createdAt';
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    timeValue = startOfDay;
    
    // Set limit based on tier
    switch (userTier) {
      case SUBSCRIPTION_TIERS.FOUNDER:
      case SUBSCRIPTION_TIERS.PRO:
        limitCount = Infinity;
        break;
      case SUBSCRIPTION_TIERS.CREATOR:
        limitCount = 6; // 6 per day
        break;
      case SUBSCRIPTION_TIERS.BASIC:
      default:
        limitCount = 3; // 3 per day
    }
    
    resetMessage = "Daily feedback limit reached. Resets at midnight.";
  }
  
  // If unlimited, return immediately
  if (limitCount === Infinity) {
    return { 
      withinLimits: true,
      limit: 'Unlimited'
    };
  }
  
  // Query for usage count
  const querySnapshot = await db.collection(collection)
    .where('userId', '==', userId)
    .where(timeField, '>=', timeValue)
    .count()
    .get();
  
  const currentUsage = querySnapshot.data().count;
  
  return {
    withinLimits: currentUsage < limitCount,
    currentUsage,
    limit: limitCount,
    message: resetMessage,
    resetTime: feature === 'tracks' ? getNextSunday() : getTomorrow()
  };
};

// Helper function to get next Sunday date
const getNextSunday = () => {
  const now = new Date();
  const daysUntilSunday = 7 - now.getDay();
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  nextSunday.setHours(0, 0, 0, 0);
  return nextSunday;
};

// Helper function to get tomorrow's date
const getTomorrow = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
};

module.exports = {
  subscriptionValidator,
  hasRequiredTier
};
