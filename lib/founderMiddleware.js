import admin from 'firebase-admin';

export const verifyFounderStatus = async (email, feature) => {
  try {
    const userRef = admin.firestore().collection('users').doc(email);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return false;
    }
    
    const userData = userDoc.data();
    
    // Verify founder status
    if (!userData.isFounder) {
      return false;
    }
    
    // Verify specific feature
    switch (feature) {
      case 'premiumAccess':
        return !!userData.features?.premiumAccess;
      case 'priorityRequests':
        return !!userData.features?.priorityRequests;
      case 'founderBadge':
        return !!userData.features?.founderBadge;
      case 'bonusPoints':
        return userData.features?.bonusPoints > 0;
      case 'earlyAccess':
        return !!userData.features?.earlyAccess;
      default:
        return true;
    }
  } catch (error) {
    console.error('Feature verification error:', error);
    return false;
  }
};