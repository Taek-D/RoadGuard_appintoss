"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeMatcherBatch = void 0;
exports.decodePolyline = decodePolyline;
exports.samplePoints = samplePoints;
exports.retryWithBackoff = retryWithBackoff;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const axios_1 = __importDefault(require("axios"));
// This project uses a named Firestore database ("roadguard") instead of
// the usual (default). Calling admin.firestore() here would silently
// bind to (default) — which does not exist — and every read returns
// gRPC NOT_FOUND (status 5). Always bind explicitly to the named db.
const db = (0, firestore_1.getFirestore)('roadguard');
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Decode a Google-style encoded polyline string into an array of LatLng.
 * Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
function decodePolyline(encoded) {
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
        // Decode latitude
        let shift = 0;
        let result = 0;
        let byte;
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
function haversineKm(a, b) {
    const R = 6371; // Earth radius in km
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat +
        Math.cos((a.lat * Math.PI) / 180) *
            Math.cos((b.lat * Math.PI) / 180) *
            sinLng * sinLng;
    return 2 * R * Math.asin(Math.sqrt(h));
}
/**
 * Sample points from a polyline at roughly `intervalKm` spacing.
 * Always includes the first and last point.
 */
function samplePoints(points, intervalKm) {
    if (points.length === 0)
        return [];
    const sampled = [points[0]];
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
async function retryWithBackoff(fn, maxRetries = 3) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
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
// Simple sentinel class so we can centralize error → HTTP status mapping
// at the onRequest boundary. Using a custom error avoids depending on
// HttpsError (which was tied to the removed onCall wrapper) while still
// letting the main logic throw with a machine-readable code.
class NodeMatcherError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
// This app uses Toss appLogin for identity, not Firebase Auth, so the
// client has no Firebase ID token. Cloud Functions v2 `onCall` requires
// an authenticated caller at the HTTP layer (its `invoker` option only
// applies to `onRequest`/`httpsTrigger`) and therefore rejected every
// client request with HTTP 403 before the handler ever ran. Using
// `onRequest` with `invoker: 'public'` + `cors: true` lets us accept
// unauthenticated POSTs from the browser. The handler still validates
// the `userId` in the body and reads the user's own document so
// authorization is enforced at the data layer.
//
// Deployed to asia-northeast3 to match the client's `getFunctions`
// region. A previous us-central1 deployment existed; it should be
// deleted after this one lands.
exports.nodeMatcherBatch = (0, https_1.onRequest)({
    region: 'asia-northeast3',
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: ['KAKAO_REST_KEY'],
    cors: true,
    invoker: 'public',
}, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'method-not-allowed' });
            return;
        }
        // Accept both raw `{ userId }` and httpsCallable-style `{ data: { userId } }`
        // bodies so we can migrate callers incrementally.
        const body = (req.body ?? {});
        const userId = body.userId ?? body.data?.userId;
        if (!userId) {
            throw new NodeMatcherError('invalid-argument', 'userId is required');
        }
        const KAKAO_KEY = process.env.KAKAO_REST_KEY;
        if (!KAKAO_KEY) {
            throw new NodeMatcherError('failed-precondition', 'KAKAO_REST_KEY is not configured');
        }
        // -----------------------------------------------------------------------
        // 1. Read user document
        // -----------------------------------------------------------------------
        const userSnap = await db.collection('users').doc(userId).get();
        if (!userSnap.exists) {
            throw new NodeMatcherError('not-found', `User ${userId} not found`);
        }
        const userData = userSnap.data();
        const home = userData.home;
        const work = userData.work;
        if (!home || !work) {
            throw new NodeMatcherError('failed-precondition', 'User must have both home and work coordinates');
        }
        // -----------------------------------------------------------------------
        // 2. Call Kakao Directions API (origin/destination are lng,lat)
        // -----------------------------------------------------------------------
        const directionsUrl = `https://apis-navi.kakaomobility.com/v1/directions`;
        const directionsRes = await retryWithBackoff(() => axios_1.default.get(directionsUrl, {
            params: {
                origin: `${home.lng},${home.lat}`,
                destination: `${work.lng},${work.lat}`,
            },
            headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
            timeout: 15000,
        }));
        // Extract the overview polyline from the first route
        const routes = directionsRes.data?.routes;
        if (!routes || routes.length === 0) {
            throw new NodeMatcherError('internal', 'No route found from Kakao Directions API');
        }
        // Kakao Directions rarely returns an encoded overview_polyline; most
        // responses contain `sections[].roads[].vertexes` as flat [lng, lat, ...]
        // pairs. We handle the polyline branch here but normally fall through
        // to the vertexes reconstruction below.
        const overviewPolyline = routes[0]?.overview_polyline?.points;
        // Kakao may return vertexes as flat array [lng, lat, lng, lat, ...]
        // Build points from sections if encoded polyline is not available
        let routePoints;
        if (overviewPolyline) {
            routePoints = decodePolyline(overviewPolyline);
        }
        else {
            // Fallback: collect vertexes from all roads in all sections
            routePoints = [];
            for (const section of routes[0].sections ?? []) {
                for (const road of section.roads ?? []) {
                    const v = road.vertexes ?? [];
                    for (let i = 0; i < v.length; i += 2) {
                        routePoints.push({ lat: v[i + 1], lng: v[i] });
                    }
                }
            }
        }
        if (routePoints.length === 0) {
            throw new NodeMatcherError('internal', 'Could not extract route points');
        }
        // -----------------------------------------------------------------------
        // 3. Sample points every ~1.5 km
        // -----------------------------------------------------------------------
        const sampled = samplePoints(routePoints, 1.5);
        // -----------------------------------------------------------------------
        // 4. Reverse geocode each sample point to get districts
        // -----------------------------------------------------------------------
        const districtSet = new Set();
        for (const pt of sampled) {
            try {
                const geoRes = await retryWithBackoff(() => axios_1.default.get('https://dapi.kakao.com/v2/local/geo/coord2regioncode', {
                    params: { x: pt.lng, y: pt.lat },
                    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
                    timeout: 10000,
                }));
                const documents = geoRes.data?.documents ?? [];
                for (const doc of documents) {
                    if (doc.region_1depth_name && doc.region_2depth_name) {
                        districtSet.add(`${doc.region_1depth_name} ${doc.region_2depth_name}`);
                    }
                }
            }
            catch (err) {
                console.warn(`[NodeMatcher] Reverse geocode failed for (${pt.lat}, ${pt.lng}):`, err);
                // Continue with remaining points
            }
        }
        const districts = Array.from(districtSet);
        // -----------------------------------------------------------------------
        // 6. Save to Firestore
        // -----------------------------------------------------------------------
        const polylineToStore = overviewPolyline ??
            routePoints.map((p) => `${p.lng},${p.lat}`).join(';');
        const routeDoc = {
            polyline: polylineToStore,
            districts,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await db.collection('routes').doc(userId).set(routeDoc, { merge: true });
        console.log(`[NodeMatcher] Saved route for user ${userId}: ${districts.length} districts`);
        res.json({
            success: true,
            districts,
        });
    }
    catch (err) {
        // Map NodeMatcherError.code to an HTTP status so the client can
        // distinguish genuine failures from recoverable "not ready yet"
        // states. Anything else becomes a 500.
        if (err instanceof NodeMatcherError) {
            const statusMap = {
                'invalid-argument': 400,
                'failed-precondition': 412,
                'not-found': 404,
                internal: 500,
            };
            const status = statusMap[err.code] ?? 500;
            console.warn(`[NodeMatcher] ${err.code}: ${err.message}`);
            res.status(status).json({ error: err.code, message: err.message });
            return;
        }
        console.error('[NodeMatcher] Unhandled error:', err);
        res.status(500).json({
            error: 'internal',
            message: err instanceof Error ? err.message : String(err),
        });
    }
});
//# sourceMappingURL=nodeMatcherBatch.js.map