import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Handle private key formatting
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey
  }),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});

export const db = getFirestore(app);
export const storage = getStorage(app);