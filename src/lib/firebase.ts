import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// Trim every env value to guard against trailing whitespace / newlines
// that Vercel or other CI environments may inject. A stray "\n" in
// projectId causes the Firestore JS SDK to build a malformed database
// path (`projects/holdem-ranking\n/databases/roadguard`), which silently
// fails every read/write.
const env = (key: string, fallback: string) =>
  (import.meta.env[key] || fallback).trim();

const firebaseConfig = {
  apiKey: env('VITE_FIREBASE_API_KEY', 'demo-api-key'),
  authDomain: env('VITE_FIREBASE_AUTH_DOMAIN', 'demo.firebaseapp.com'),
  projectId: env('VITE_FIREBASE_PROJECT_ID', 'demo-roadguard'),
  storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET', 'demo-roadguard.appspot.com'),
  messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID', '000000000000'),
  appId: env('VITE_FIREBASE_APP_ID', '1:000000000000:web:000000000000'),
};

// The holdem-ranking project uses a named Firestore database called
// "roadguard" rather than the usual (default) database. Using
// initializeFirestore with explicit settings and database ID ensures
// the SDK constructs the correct database path without encoding issues
// that getFirestore(app, databaseId) sometimes introduces.
const FIRESTORE_DB_ID = 'roadguard';

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {}, FIRESTORE_DB_ID);
export const functions = getFunctions(app, 'asia-northeast3');

export default app;
