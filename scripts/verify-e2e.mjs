#!/usr/bin/env node
// RoadGuard NodeMatcherBatch E2E verification.
//
// Usage:
//   node scripts/verify-e2e.mjs <userId>
//   node scripts/verify-e2e.mjs --seed=강남-판교   (creates a test user doc first)
//
// What it does:
//   1. Loads .env (same vars the web app uses).
//   2. Optionally seeds users/<userId> with home/work coords.
//   3. POSTs to the deployed nodeMatcherBatch (asia-northeast3).
//   4. Reads back routes/<userId> and asserts cctvNodes.length > 0.
//
// Run after any functions/src/nodeMatcherBatch.ts change to confirm the
// real-data path still reaches Kakao/ITS and writes to the named
// Firestore database "roadguard".

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// .env loader (minimal, no dotenv dep)
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) {
    throw new Error('.env not found at project root');
  }
  const raw = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, key, val] = m;
    env[key] = val.trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

// ---------------------------------------------------------------------------
// Preset coord pairs for quick seeding
// ---------------------------------------------------------------------------
const PRESETS = {
  '강남-판교': {
    home: { lat: 37.4979, lng: 127.0276 }, // 강남역
    work: { lat: 37.3948, lng: 127.1112 }, // 판교역
    commuteTime: '08:30',
  },
  '서울시청-성남': {
    home: { lat: 37.5663, lng: 126.9779 },
    work: { lat: 37.4450, lng: 127.1388 },
    commuteTime: '08:00',
  },
  '잠실-강남': {
    home: { lat: 37.5133, lng: 127.1000 },
    work: { lat: 37.4979, lng: 127.0276 },
    commuteTime: '09:00',
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  let userId = null;
  let preset = null;

  for (const a of args) {
    if (a.startsWith('--seed=')) preset = a.slice('--seed='.length);
    else if (!userId) userId = a;
  }

  if (!userId) {
    userId = preset
      ? `e2e_${preset.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}`
      : null;
  }

  if (!userId) {
    console.error(
      'Usage:\n  node scripts/verify-e2e.mjs <userId>\n  node scripts/verify-e2e.mjs --seed=강남-판교',
    );
    process.exit(1);
  }

  const env = loadEnv();
  const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID'];
  for (const k of required) {
    if (!env[k]) {
      console.error(`Missing ${k} in .env`);
      process.exit(1);
    }
  }

  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  const db = initializeFirestore(app, {}, 'roadguard');

  // -------------------------------------------------------------------------
  // Seed (optional)
  // -------------------------------------------------------------------------
  if (preset) {
    const data = PRESETS[preset];
    if (!data) {
      console.error(
        `Unknown preset "${preset}". Known: ${Object.keys(PRESETS).join(', ')}`,
      );
      process.exit(1);
    }
    console.log(`[seed] users/${userId}  home=${JSON.stringify(data.home)}`);
    await setDoc(
      doc(db, 'users', userId),
      {
        userId,
        home: data.home,
        work: data.work,
        commuteTime: data.commuteTime,
        createdAt: new Date().toISOString(),
      },
      { merge: true },
    );
  }

  // -------------------------------------------------------------------------
  // Call nodeMatcherBatch
  // -------------------------------------------------------------------------
  const url = `https://asia-northeast3-${env.VITE_FIREBASE_PROJECT_ID}.cloudfunctions.net/nodeMatcherBatch`;
  console.log(`[call] POST ${url}  body={userId:"${userId}"}`);
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  const elapsed = Date.now() - started;
  const text = await res.text();
  console.log(`[call] HTTP ${res.status} in ${elapsed}ms  body=${text}`);

  if (!res.ok) {
    console.error('nodeMatcherBatch failed — aborting');
    process.exit(2);
  }

  // -------------------------------------------------------------------------
  // Verify Firestore route document
  // -------------------------------------------------------------------------
  const routeSnap = await getDoc(doc(db, 'routes', userId));
  if (!routeSnap.exists()) {
    console.error(`[verify] routes/${userId} does not exist — function did not write`);
    process.exit(3);
  }
  const route = routeSnap.data();
  const cctvNodes = route.cctvNodes ?? [];
  const districts = route.districts ?? [];
  const polyline = route.polyline ?? '';

  console.log('\n=== Verification report ===');
  console.log(`userId:     ${userId}`);
  console.log(`polyline:   ${polyline.slice(0, 40)}${polyline.length > 40 ? '…' : ''} (len=${polyline.length})`);
  console.log(`districts:  ${districts.length}  [${districts.slice(0, 3).join(', ')}${districts.length > 3 ? ', …' : ''}]`);
  console.log(`cctvNodes:  ${cctvNodes.length}`);

  if (cctvNodes.length > 0) {
    const first = cctvNodes[0];
    console.log(`  first:    id=${first.id}  name="${first.name}"  url=${String(first.cctvurl).slice(0, 60)}…`);
  }

  const failures = [];
  if (polyline.length === 0) failures.push('polyline empty');
  if (polyline === 'MOCK') failures.push('polyline is MOCK — fell back to mock data');
  if (districts.length === 0) failures.push('districts empty — reverse geocode failed');
  if (cctvNodes.length === 0) failures.push('cctvNodes empty — ITS CCTV query returned nothing');

  if (failures.length > 0) {
    console.error(`\n❌ FAIL: ${failures.join('; ')}`);
    process.exit(4);
  }

  console.log('\n✅ PASS — real Kakao + ITS data reached Firestore');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(99);
});
