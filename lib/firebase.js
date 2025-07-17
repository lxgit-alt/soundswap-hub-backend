import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase only once
if (!getApps().length) {
  console.log('🔥 Initializing Firebase Admin (shared)...');
  
  try {
    const firebaseConfig = {
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID || 'soundswap-7e780',
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL || 'firebase-adminsdk-xxxxx@soundswap-7e780.iam.gserviceaccount.com',
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
      projectId: process.env.FIREBASE_PROJECT_ID || 'soundswap-7e780',
    };
    
    initializeApp(firebaseConfig);
    console.log('✅ Firebase initialized successfully (shared)');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
  }
}

export const db = getFirestore();
export const auth = getAuth();
export { getApps };
