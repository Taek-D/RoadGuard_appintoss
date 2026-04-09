import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { CctvNode, WeatherAlert } from '@/business/store/globalStore';

export interface HazardResult {
  isHazardous: boolean;
  alerts: WeatherAlert[];
  hazardCctvNodes: CctvNode[];
}

export async function evaluateHazards(
  districts: string[],
  cctvNodes: CctvNode[]
): Promise<HazardResult> {
  if (districts.length === 0) {
    return { isHazardous: false, alerts: [], hazardCctvNodes: [] };
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

  const hazardDistricts = new Set(alerts.map((a) => a.district));
  const hazardCctvNodes = cctvNodes.filter((node) => {
    // CCTV 노드의 행정구역이 위험 구역에 포함되는지 확인
    // 실제로는 좌표 기반 매칭이 필요하나 MVP에서는 name 필드로 근사
    return Array.from(hazardDistricts).some((d) => node.name.includes(d));
  });

  return {
    isHazardous: alerts.length > 0,
    alerts,
    hazardCctvNodes,
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
