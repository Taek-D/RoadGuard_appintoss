import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { WeatherAlert } from '@/business/store/globalStore';

export interface HazardResult {
  isHazardous: boolean;
  alerts: WeatherAlert[];
}

export async function evaluateHazards(
  districts: string[],
): Promise<HazardResult> {
  if (districts.length === 0) {
    return { isHazardous: false, alerts: [] };
  }

  const alertsRef = collection(db, 'weatherAlerts');
  const alerts: WeatherAlert[] = [];

  // Firestore 'in' query supports up to 30 items
  const chunks = chunkArray(districts, 30);
  for (const chunk of chunks) {
    const q = query(alertsRef, where('__name__', 'in', chunk));
    const snapshot = await getDocs(q);
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.hasAlert) {
        alerts.push({
          district: doc.id,
          hasAlert: data.hasAlert,
          alertType: data.alertType,
          alertLevel: data.alertLevel,
          message: data.message,
        });
      }
    });
  }

  return {
    isHazardous: alerts.length > 0,
    alerts,
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
