import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { RouteData } from '@/business/store/globalStore';

export async function fetchRoute(userId: string): Promise<RouteData | null> {
  const routeDoc = await getDoc(doc(db, 'routes', userId));
  if (!routeDoc.exists()) return null;

  const data = routeDoc.data();
  return {
    polyline: data.polyline || '',
    districts: data.districts || [],
  };
}

// nodeMatcherBatch is now deployed as an `onRequest` (plain HTTPS) function
// in asia-northeast3 with public invoker. We cannot use `httpsCallable`
// anymore because that would require Firebase Auth and would also send
// the request as an onCall-style envelope. Plain `fetch` with a JSON
// body matches the onRequest handler's expectations exactly.
const FUNCTIONS_REGION = 'asia-northeast3';
const NODE_MATCHER_URL = `https://${FUNCTIONS_REGION}-${
  import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-roadguard'
}.cloudfunctions.net/nodeMatcherBatch`;

export async function triggerNodeMatcher(
  userId: string,
): Promise<{ success: boolean }> {
  const res = await fetch(NODE_MATCHER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  if (!res.ok) {
    // Surface the server's error code so callers can distinguish
    // "not ready yet" (412) from real failures (500).
    const text = await res.text().catch(() => '');
    throw new Error(
      `nodeMatcherBatch HTTP ${res.status}${text ? `: ${text}` : ''}`,
    );
  }

  return await res.json();
}
