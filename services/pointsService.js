import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

// Constants for point rules
const POINT_RULES = {
  TRACK_SUBMISSION: { points: 30, limit: 2, period: 'week' },
  QUALITY_FEEDBACK: { points: 10, limit: 3, period: 'day' },
  VERIFIED_HELPFUL_FEEDBACK: { points: 15, limit: null }, // unlimited
  PROFILE_COMPLETION: { points: 20, limit: 1, period: 'lifetime' },
  SHARE_TRACK: { points: 2, limit: 10, period: 'day' },
  STREAK_BONUS: { points: 25, limit: 1, period: 'week' },
  REFERRAL: { points: 50, limit: null } // unlimited
};

// Function to check if the user has reached their limit for a specific action
export async function checkActionLimit(userId, actionType) {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return { canPerform: false, reason: 'User not found' };
    }
    
    const userData = userDoc.data();
    const pointsHistory = userData.pointsHistory || [];
    const rule = POINT_RULES[actionType];
    
    if (!rule) {
      return { canPerform: false, reason: 'Invalid action type' };
    }
    
    // If no limit, user can always perform the action
    if (!rule.limit) {
      return { canPerform: true };
    }
    
    // Filter actions by type and period
    const relevantActions = pointsHistory.filter(entry => {
      if (entry.type !== actionType) return false;
      
      const now = new Date();
      const actionDate = new Date(entry.timestamp);
      
      switch (rule.period) {
        case 'day':
          return actionDate.toDateString() === now.toDateString();
        case 'week':
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay());
          return actionDate >= weekStart;
        case 'lifetime':
          return true; // All actions of this type ever recorded
        default:
          return false;
      }
    });
    
    if (relevantActions.length >= rule.limit) {
      return { 
        canPerform: false, 
        reason: `Limit of ${rule.limit} per ${rule.period} reached`,
        current: relevantActions.length,
        limit: rule.limit
      };
    }
    
    return { 
      canPerform: true,
      current: relevantActions.length,
      limit: rule.limit
    };
  } catch (error) {
    console.error('Error checking action limit:', error);
    throw error;
  }
}

// Award points for an action
export async function awardPointsForAction(userId, actionType, metadata = {}) {
  try {
    // Check if user can perform this action
    const limitCheck = await checkActionLimit(userId, actionType);
    if (!limitCheck.canPerform) {
      return { success: false, reason: limitCheck.reason };
    }
    
    const rule = POINT_RULES[actionType];
    if (!rule) {
      return { success: false, reason: 'Invalid action type' };
    }
    
    const pointsToAward = rule.points;
    const userRef = db.collection('users').doc(userId);
    
    // Get user data
    const userDoc = await userRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};
    
    // Update points
    const currentPoints = userData.points || 0;
    const newPoints = currentPoints + pointsToAward;
    
    // Record the action in history
    const pointAction = {
      type: actionType,
      points: pointsToAward,
      timestamp: Timestamp.now(),
      metadata
    };
    
    // Update user document
    await userRef.set({
      points: newPoints,
      pointsHistory: FieldValue.arrayUnion(pointAction),
      lastPointsActivity: Timestamp.now()
    }, { merge: true });
    
    return {
      success: true,
      awarded: pointsToAward,
      newTotal: newPoints
    };
  } catch (error) {
    console.error('Error awarding points:', error);
    throw error;
  }
}

// Check and award streak bonus if applicable
export async function checkAndAwardStreakBonus(userId) {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return { success: false, reason: 'User not found' };
    }
    
    const userData = userDoc.data();
    const currentDate = new Date();
    const streakData = userData.streakData || {
      lastActivity: null,
      currentStreak: 0,
      lastStreakBonusDate: null
    };
    
    // Update streak if user is active today
    if (streakData.lastActivity) {
      const lastActivityDate = streakData.lastActivity.toDate();
      const yesterday = new Date();
      yesterday.setDate(currentDate.getDate() - 1);
      
      if (lastActivityDate.toDateString() === yesterday.toDateString()) {
        // User was active yesterday, increment streak
        streakData.currentStreak += 1;
      } else if (lastActivityDate.toDateString() !== currentDate.toDateString()) {
        // Not consecutive days, reset streak
        streakData.currentStreak = 1;
      }
    } else {
      // First activity
      streakData.currentStreak = 1;
    }
    
    // Update last activity date
    streakData.lastActivity = Timestamp.now();
    
    // Check if we should award streak bonus (7-day streak)
    let bonusAwarded = false;
    if (streakData.currentStreak >= 7) {
      // Check if we already awarded a bonus this week
      const canAwardBonus = await checkActionLimit(userId, 'STREAK_BONUS');
      
      if (canAwardBonus.canPerform) {
        // Award the bonus
        const bonusResult = await awardPointsForAction(userId, 'STREAK_BONUS', {
          streakDays: streakData.currentStreak
        });
        
        if (bonusResult.success) {
          streakData.lastStreakBonusDate = Timestamp.now();
          bonusAwarded = true;
        }
      }
    }
    
    // Update streak data
    await userRef.update({ streakData });
    
    return {
      success: true,
      streakDays: streakData.currentStreak,
      bonusAwarded
    };
  } catch (error) {
    console.error('Error updating streak:', error);
    throw error;
  }
}

// Main function to redeem a boost
export const redeemBoost = async (userId, boostType) => {
  const userRef = db.collection('users').doc(userId);
  const boostRef = db.collection('boosts').doc(boostType);

  return await db.runTransaction(async (transaction) => {
    // 1. Fetch user and boost
    const [userDoc, boostDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(boostRef)
    ]);

    if (!userDoc.exists) {
      throw new Error('User not found');
    }
    if (!boostDoc.exists) {
      throw new Error('Boost not found');
    }

    const userData = userDoc.data();
    const boostData = boostDoc.data();

    // 2. Check points
    const points = userData.feedbackPoints || 0;
    if (points < boostData.cost) {
      throw new Error('Not enough points');
    }

    // 3. Calculate new boosts
    const updatedBoosts = calculateBoostEffect(userData.boosts || {}, boostData.effect);

    // 4. Update user data
    transaction.update(userRef, {
      feedbackPoints: points - boostData.cost,
      boosts: updatedBoosts
    });

    return updatedBoosts;
  });
};

// Helper: how boost affects user data
const calculateBoostEffect = (currentBoosts, effect) => {
  const boosts = { ...currentBoosts };

  switch (effect.type) {
    case 'profileHighlight':
      boosts.profileHighlight = {
        expiresAt: Timestamp.fromDate(
          new Date(Date.now() + effect.durationHours * 60 * 60 * 1000)
        )
      };
      break;

    case 'priorityPairing':
      boosts.priorityPairing = {
        remainingUses: (boosts.priorityPairing?.remainingUses || 0) + effect.maxUses
      };
      break;
  }

  return boosts;
};

export async function getUserPoints(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return 0;
    }
    return userDoc.data().points || 0;
  } catch (error) {
    console.error('Error getting user points:', error);
    throw error;
  }
}

// Get user's points history with pagination
export async function getUserPointsHistory(userId, limit = 20, startAfter = null) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return { history: [], hasMore: false };
    }
    
    const userData = userDoc.data();
    const pointsHistory = userData.pointsHistory || [];
    
    // Sort by timestamp descending (newest first)
    pointsHistory.sort((a, b) => b.timestamp.seconds - a.timestamp.seconds);
    
    // Apply pagination
    let startIndex = 0;
    if (startAfter) {
      startIndex = pointsHistory.findIndex(entry => 
        entry.timestamp.seconds === startAfter.seconds && 
        entry.timestamp.nanoseconds === startAfter.nanoseconds
      );
      
      if (startIndex !== -1) {
        startIndex += 1; // Start after this item
      } else {
        startIndex = 0;
      }
    }
    
    const paginatedHistory = pointsHistory.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < pointsHistory.length;
    
    return {
      history: paginatedHistory,
      hasMore
    };
  } catch (error) {
    console.error('Error getting user points history:', error);
    throw error;
  }
}

// ...other existing functions...

