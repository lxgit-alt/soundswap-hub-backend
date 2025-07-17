import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase only once
if (!getApps().length) {
  console.log('🔥 Initializing Firebase Admin (shared)...');
  
  try {
    // Check if we have the required environment variables
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      console.error('❌ Missing Firebase environment variables');
      throw new Error('Firebase credentials not configured');
    }

    const firebaseConfig = {
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Fix private key parsing for production
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      projectId: process.env.FIREBASE_PROJECT_ID,
    };
    
    initializeApp(firebaseConfig);
    console.log('✅ Firebase initialized successfully (shared)');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    // Don't throw in production, just log the error
    console.log('⚠️ Firebase will not be available');
  }
}

// Export with safety checks
export const db = getApps().length > 0 ? getFirestore() : null;
export const auth = getApps().length > 0 ? getAuth() : null;
export { getApps };
