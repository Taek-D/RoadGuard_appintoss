import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-roadguard',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-roadguard.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:000000000000',
};

// The holdem-ranking project uses a named Firestore database called
// "roadguard" rather than the usual (default) database. Calling
// getFirestore(app) without the second argument targets (default),
// which does not exist in this project, so every read/write silently
// times out and the app falls back to MOCK data. Always pass the
// database name so reads/writes hit the real backing store.
const FIRESTORE_DB_ID = 'roadguard';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, FIRESTORE_DB_ID);
export const functions = getFunctions(app, 'asia-northeast3');

export default app;
