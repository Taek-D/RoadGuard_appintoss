import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import axios from 'axios';

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WeatherAlert {
  alertType: string;
  alertLevel: string;
  region: string;
  message: string;
}

interface WeatherAlertDoc {
  hasAlert: boolean;
  alertType?: string;
  alertLevel?: string;
  message?: string;
  updatedAt: FirebaseFirestore.FieldValue;
}

// ---------------------------------------------------------------------------
// Alert parsing helpers
// ---------------------------------------------------------------------------

/**
 * Known weather alert types relevant to commute hazards.
 */
const ALERT_TYPE_KEYWORDS: Record<string, string> = {
  '안개': '안개',
  '대설': '대설',
  '한파': '한파',
  '폭풍': '폭풍',
  '강풍': '강풍',
  '호우': '호우',
  '태풍': '태풍',
  '폭염': '폭염',
  '건조': '건조',
  '풍랑': '풍랑',
  '황사': '황사',
};

/**
 * Parse alert type from the title string (e.g., "대설주의보", "한파경보").
 */
function parseAlertType(title: string): string {
  for (const keyword of Object.keys(ALERT_TYPE_KEYWORDS)) {
    if (title.includes(keyword)) {
      return ALERT_TYPE_KEYWORDS[keyword];
    }
  }
  return '기타';
}

/**
 * Parse alert level from the title string.
 */
function parseAlertLevel(title: string): string {
  if (title.includes('경보')) return '경보';
  if (title.includes('주의보')) return '주의보';
  return '알수없음';
}

/**
 * Parse region names from the KMA alert area string.
 * KMA typically returns comma-separated region names like:
 *   "서울특별시, 경기도 수원시, 경기도 성남시"
 * We extract the top-level district (시/도 + 시/군/구).
 */
function parseRegions(areaName: string): string[] {
  if (!areaName) return [];
  return areaName
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/**
 * Normalise a region string to a Firestore-safe document ID.
 * Replaces spaces with underscores since Firestore doc IDs cannot contain '/'.
 */
function regionToDocId(region: string): string {
  return region.replace(/\//g, '_').replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------
// Main Cloud Function (runs every 10 minutes)
// ---------------------------------------------------------------------------

export const weatherCollectorBatch = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const KMA_KEY = process.env.KMA_API_KEY;
    if (!KMA_KEY) {
      console.error('[WeatherCollector] KMA_API_KEY is not configured');
      return;
    }

    // ---------------------------------------------------------------------
    // 1. Call KMA weather alert API
    // ---------------------------------------------------------------------
    let items: any[] = [];
    try {
      const res = await axios.get(
        'http://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList',
        {
          params: {
            serviceKey: KMA_KEY,
            numOfRows: 100,
            pageNo: 1,
            dataType: 'JSON',
          },
          timeout: 15000,
        },
      );

      items =
        res.data?.response?.body?.items?.item ?? [];

      // KMA sometimes returns a single object instead of an array
      if (!Array.isArray(items)) {
        items = items ? [items] : [];
      }

      console.log(`[WeatherCollector] Fetched ${items.length} alert item(s) from KMA`);
    } catch (err) {
      console.error('[WeatherCollector] Failed to fetch KMA alerts — keeping existing cache:', err);
      // Do NOT clear existing data; just return
      return;
    }

    // ---------------------------------------------------------------------
    // 2. Parse alerts and group by district
    // ---------------------------------------------------------------------
    const activeAlerts = new Map<string, WeatherAlert>();

    for (const item of items) {
      const title: string = item.t6 ?? item.title ?? '';
      const areaName: string = item.t7 ?? item.areaName ?? '';

      const alertType = parseAlertType(title);
      const alertLevel = parseAlertLevel(title);
      const regions = parseRegions(areaName);

      for (const region of regions) {
        // If multiple alerts hit the same region, keep the most severe
        const existing = activeAlerts.get(region);
        if (
          !existing ||
          (alertLevel === '경보' && existing.alertLevel !== '경보')
        ) {
          activeAlerts.set(region, {
            alertType,
            alertLevel,
            region,
            message: title,
          });
        }
      }
    }

    console.log(
      `[WeatherCollector] ${activeAlerts.size} district(s) with active alerts`,
    );

    // ---------------------------------------------------------------------
    // 3. Write active alerts to Firestore
    // ---------------------------------------------------------------------
    const batch = db.batch();
    const updatedDistricts = new Set<string>();

    for (const [region, alert] of activeAlerts) {
      const docId = regionToDocId(region);
      updatedDistricts.add(docId);
      const ref = db.collection('weatherAlerts').doc(docId);
      const doc: WeatherAlertDoc = {
        hasAlert: true,
        alertType: alert.alertType,
        alertLevel: alert.alertLevel,
        message: alert.message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      batch.set(ref, doc, { merge: true });
    }

    // ---------------------------------------------------------------------
    // 4. Clear alerts for districts that no longer have active warnings
    // ---------------------------------------------------------------------
    try {
      const existingSnap = await db
        .collection('weatherAlerts')
        .where('hasAlert', '==', true)
        .get();

      for (const docSnap of existingSnap.docs) {
        if (!updatedDistricts.has(docSnap.id)) {
          const ref = db.collection('weatherAlerts').doc(docSnap.id);
          const clearDoc: WeatherAlertDoc = {
            hasAlert: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          batch.set(ref, clearDoc, { merge: true });
        }
      }
    } catch (err) {
      console.warn('[WeatherCollector] Failed to query existing alerts for cleanup:', err);
      // Non-fatal — active alerts will still be written
    }

    // Commit all writes
    await batch.commit();

    console.log('[WeatherCollector] Firestore update complete');
  },
);
