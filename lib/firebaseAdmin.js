import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const credentials = JSON.parse(process.env.FIREBASE_PRIVATE_KEY);

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: credentials,
  }),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});

export const db = getFirestore(app);
export const storage = getStorage(app);