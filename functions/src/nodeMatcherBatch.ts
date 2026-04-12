import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import axios, { AxiosResponse } from 'axios';

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LatLng {
  lat: number;
  lng: number;
}

interface CctvNode {
  id: string;
  lat: number;
  lng: number;
  name: string;
  cctvurl: string;
}

interface RouteDoc {
  polyline: string;
  districts: string[];
  cctvNodes: CctvNode[];
  updatedAt: FirebaseFirestore.FieldValue;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode a Google-style encoded polyline string into an array of LatLng.
 * Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Decode latitude
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    // Decode longitude
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/**
 * Haversine distance in kilometres between two points.
 */
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // Earth radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Sample points from a polyline at roughly `intervalKm` spacing.
 * Always includes the first and last point.
 */
export function samplePoints(points: LatLng[], intervalKm: number): LatLng[] {
  if (points.length === 0) return [];
  const sampled: LatLng[] = [points[0]];
  let accumulated = 0;

  for (let i = 1; i < points.length; i++) {
    accumulated += haversineKm(points[i - 1], points[i]);
    if (accumulated >= intervalKm) {
      sampled.push(points[i]);
      accumulated = 0;
    }
  }

  // Always include the last point if it wasn't already added
  const last = points[points.length - 1];
  const lastSampled = sampled[sampled.length - 1];
  if (last.lat !== lastSampled.lat || last.lng !== lastSampled.lng) {
    sampled.push(last);
  }

  return sampled;
}

/**
 * Generic retry wrapper with exponential backoff.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 500; // 500ms, 1s, 2s
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Main Cloud Function
// ---------------------------------------------------------------------------

export const nodeMatcherBatch = onCall(
  { timeoutSeconds: 300, memory: '512MiB', secrets: ['KAKAO_REST_KEY', 'ITS_API_KEY'] },
  async (request) => {
    const userId: string | undefined = request.data?.userId;
    if (!userId) {
      throw new HttpsError('invalid-argument', 'userId is required');
    }

    const KAKAO_KEY = process.env.KAKAO_REST_KEY;
    const ITS_KEY = process.env.ITS_API_KEY;
    if (!KAKAO_KEY) {
      throw new HttpsError('failed-precondition', 'KAKAO_REST_KEY is not configured');
    }
    if (!ITS_KEY) {
      throw new HttpsError('failed-precondition', 'ITS_API_KEY is not configured');
    }

    // -----------------------------------------------------------------------
    // 1. Read user document
    // -----------------------------------------------------------------------
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) {
      throw new HttpsError('not-found', `User ${userId} not found`);
    }

    const userData = userSnap.data()!;
    const home: LatLng | undefined = userData.home;
    const work: LatLng | undefined = userData.work;
    if (!home || !work) {
      throw new HttpsError(
        'failed-precondition',
        'User must have both home and work coordinates',
      );
    }

    // -----------------------------------------------------------------------
    // 2. Call Kakao Directions API (origin/destination are lng,lat)
    // -----------------------------------------------------------------------
    const directionsUrl = `https://apis-navi.kakaomobility.com/v1/directions`;
    const directionsRes: AxiosResponse = await retryWithBackoff(() =>
      axios.get(directionsUrl, {
        params: {
          origin: `${home.lng},${home.lat}`,
          destination: `${work.lng},${work.lat}`,
        },
        headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
      }),
    );

    // Extract the overview polyline from the first route
    const routes = directionsRes.data?.routes;
    if (!routes || routes.length === 0) {
      throw new HttpsError('internal', 'No route found from Kakao Directions API');
    }

    // Kakao Directions rarely returns an encoded overview_polyline; most
    // responses contain `sections[].roads[].vertexes` as flat [lng, lat, ...]
    // pairs. We handle the polyline branch here but normally fall through
    // to the vertexes reconstruction below.
    const overviewPolyline: string | undefined =
      routes[0]?.overview_polyline?.points;

    // Kakao may return vertexes as flat array [lng, lat, lng, lat, ...]
    // Build points from sections if encoded polyline is not available
    let routePoints: LatLng[];
    if (overviewPolyline) {
      routePoints = decodePolyline(overviewPolyline);
    } else {
      // Fallback: collect vertexes from all roads in all sections
      routePoints = [];
      for (const section of routes[0].sections ?? []) {
        for (const road of section.roads ?? []) {
          const v: number[] = road.vertexes ?? [];
          for (let i = 0; i < v.length; i += 2) {
            routePoints.push({ lat: v[i + 1], lng: v[i] });
          }
        }
      }
    }

    if (routePoints.length === 0) {
      throw new HttpsError('internal', 'Could not extract route points');
    }

    // -----------------------------------------------------------------------
    // 3. Sample points every ~1.5 km
    // -----------------------------------------------------------------------
    const sampled = samplePoints(routePoints, 1.5);

    // -----------------------------------------------------------------------
    // 4. Reverse geocode each sample point to get districts
    // -----------------------------------------------------------------------
    const districtSet = new Set<string>();

    for (const pt of sampled) {
      try {
        const geoRes: AxiosResponse = await retryWithBackoff(() =>
          axios.get('https://dapi.kakao.com/v2/local/geo/coord2regioncode', {
            params: { x: pt.lng, y: pt.lat },
            headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
          }),
        );
        const documents = geoRes.data?.documents ?? [];
        for (const doc of documents) {
          if (doc.region_1depth_name && doc.region_2depth_name) {
            districtSet.add(
              `${doc.region_1depth_name} ${doc.region_2depth_name}`,
            );
          }
        }
      } catch (err) {
        console.warn(`[NodeMatcher] Reverse geocode failed for (${pt.lat}, ${pt.lng}):`, err);
        // Continue with remaining points
      }
    }

    const districts = Array.from(districtSet);

    // -----------------------------------------------------------------------
    // 5. Find nearby CCTVs via ITS API
    // -----------------------------------------------------------------------
    // Compute bounding box from route points
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const pt of routePoints) {
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lng < minLng) minLng = pt.lng;
      if (pt.lng > maxLng) maxLng = pt.lng;
    }

    // Add a small margin (~500m)
    const margin = 0.005;
    minLat -= margin;
    maxLat += margin;
    minLng -= margin;
    maxLng += margin;

    // ITS API returns CCTVs filtered by road type. We query BOTH 'its'
    // (국도) AND 'ex' (고속도로) and merge the results, otherwise commute
    // routes that run primarily on highways (e.g. 강남→판교 via 경부고속도로)
    // return an empty cctvNodes list.
    const seenCctvIds = new Set<string>();
    let cctvNodes: CctvNode[] = [];

    const fetchCctvs = async (roadType: 'its' | 'ex'): Promise<CctvNode[]> => {
      const res: AxiosResponse = await retryWithBackoff(() =>
        axios.get('https://openapi.its.go.kr/api/NCCTVInfo', {
          params: {
            apiKey: ITS_KEY,
            type: roadType,
            cctvType: 2, // 1: 실시간 스트리밍, 2: 스냅샷 이미지
            minX: minLng,
            maxX: maxLng,
            minY: minLat,
            maxY: maxLat,
            getType: 'json',
          },
        }),
      );
      const data = res.data;
      // ITS JSON response structure: { response: { data: [...] } }
      const items: any[] = data?.response?.data ?? data?.data ?? [];
      return items.map((item: any) => ({
        id: String(item.cctvid ?? item.id ?? ''),
        lat: Number(item.coordy ?? item.lat ?? 0),
        lng: Number(item.coordx ?? item.lng ?? 0),
        name: String(item.cctvname ?? item.name ?? ''),
        cctvurl: String(item.cctvurl ?? ''),
      }));
    };

    for (const roadType of ['its', 'ex'] as const) {
      try {
        const nodes = await fetchCctvs(roadType);
        for (const node of nodes) {
          // Dedup across both queries; fall back to a coord-based key if
          // ITS omits the cctvid so we still avoid exact duplicates.
          const key =
            node.id && node.id !== 'undefined'
              ? node.id
              : `${node.lat.toFixed(5)},${node.lng.toFixed(5)}`;
          if (seenCctvIds.has(key)) continue;
          seenCctvIds.add(key);
          cctvNodes.push(node);
        }
      } catch (err) {
        console.warn(`[NodeMatcher] ITS CCTV API (${roadType}) failed:`, err);
        // Continue with whatever we have; the other road type may still work
      }
    }

    console.log(
      `[NodeMatcher] CCTVs fetched: ${cctvNodes.length} (bbox: ${minLng},${minLat} → ${maxLng},${maxLat})`,
    );

    // -----------------------------------------------------------------------
    // 6. Save to Firestore
    // -----------------------------------------------------------------------
    const polylineToStore =
      overviewPolyline ??
      routePoints.map((p) => `${p.lng},${p.lat}`).join(';');

    const routeDoc: RouteDoc = {
      polyline: polylineToStore,
      districts,
      cctvNodes,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('routes').doc(userId).set(routeDoc, { merge: true });

    console.log(
      `[NodeMatcher] Saved route for user ${userId}: ${districts.length} districts, ${cctvNodes.length} CCTVs`,
    );

    return {
      success: true,
      districts,
      cctvCount: cctvNodes.length,
    };
  },
);
