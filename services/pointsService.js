import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase only once per cold start
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
  });
}
const db = getFirestore();

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

export async function updateUserPoints(userId, points) {
  try {
    const userRef = db.collection('users').doc(userId);
    await userRef.update({ points });
    return points;
  } catch (error) {
    console.error('Error updating user points:', error);
    throw error;
  }
}

export async function addUserPoints(userId, pointsToAdd) {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    const currentPoints = userDoc.exists ? (userDoc.data().points || 0) : 0;
    const newPoints = currentPoints + pointsToAdd;
    
    await userRef.set({ points: newPoints }, { merge: true });
    return newPoints;
  } catch (error) {
    console.error('Error adding user points:', error);
    throw error;
  }
}

// test.js
import { getUserPoints } from './pointsService.js';
console.log('getUserPoints:', typeof getUserPoints);

