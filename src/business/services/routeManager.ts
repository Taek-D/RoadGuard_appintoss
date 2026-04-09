import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import type { RouteData } from '@/business/store/globalStore';

export async function fetchRoute(userId: string): Promise<RouteData | null> {
  const routeDoc = await getDoc(doc(db, 'routes', userId));
  if (!routeDoc.exists()) return null;

  const data = routeDoc.data();
  return {
    polyline: data.polyline || '',
    districts: data.districts || [],
    cctvNodes: data.cctvNodes || [],
  };
}

export async function triggerNodeMatcher(userId: string): Promise<{ success: boolean }> {
  const nodeMatcherFn = httpsCallable<{ userId: string }, { success: boolean }>(
    functions,
    'nodeMatcherBatch'
  );
  const result = await nodeMatcherFn({ userId });
  return result.data;
}
