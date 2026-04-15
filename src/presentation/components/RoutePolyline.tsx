import { useEffect, useRef } from 'react';
import { decodePolyline } from '@/lib/kakaoMap';
import { MOCK_ROUTE_COORDS } from '@/lib/mockData';
import type { WeatherAlert } from '@/business/store/globalStore';

/**
 * The server stores `polyline` in one of three shapes:
 *   1. 'MOCK' sentinel
 *   2. Google-style encoded polyline (rare — Kakao Directions seldom returns one)
 *   3. CSV lng,lat;lng,lat;... fallback built from section vertexes (the
 *      typical production case)
 *
 * The old implementation only handled (1) and (2), so every real user's
 * polyline silently collapsed to zero points and nothing got drawn on the
 * map. We detect (3) by scanning for a comma in the first token.
 */
function parseRoutePolyline(polyline: string): Array<{ lat: number; lng: number }> {
  if (polyline === 'MOCK') return MOCK_ROUTE_COORDS;
  if (!polyline) return [];

  const firstSegment = polyline.split(';', 1)[0];
  if (firstSegment.includes(',')) {
    return polyline
      .split(';')
      .map((pair) => pair.split(','))
      .filter((parts) => parts.length >= 2)
      .map(([lng, lat]) => ({ lat: parseFloat(lat), lng: parseFloat(lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  }

  return decodePolyline(polyline);
}

interface UseRoutePolylineOptions {
  map: kakao.maps.Map | null;
  encodedPolyline: string;
  hazardAlerts: WeatherAlert[];
  districts?: string[];
}

// Palette
const BASE_BLUE = '#1D4ED8'; // 진한 파랑 (blue-700) — default route color
const BASE_WEIGHT = 7;
const BASE_OPACITY = 0.95;

const SAFE_COLOR = '#10B981'; // emerald-500
const SAFE_WEIGHT = 8;
const SAFE_OPACITY = 0.95;

const WARN_COLOR = '#F59E0B'; // amber-500 — 주의보
const WARN_WEIGHT = 9;
const WARN_OPACITY = 1.0;

const DANGER_COLOR = '#EF4444'; // red-500 — 경보
const DANGER_WEIGHT = 10;
const DANGER_OPACITY = 1.0;

type SegmentStyle = { color: string; weight: number; opacity: number };

function statusStyle(alert: WeatherAlert | undefined): SegmentStyle {
  if (!alert || !alert.hasAlert) {
    return { color: SAFE_COLOR, weight: SAFE_WEIGHT, opacity: SAFE_OPACITY };
  }
  if (alert.alertLevel === '경보') {
    return { color: DANGER_COLOR, weight: DANGER_WEIGHT, opacity: DANGER_OPACITY };
  }
  return { color: WARN_COLOR, weight: WARN_WEIGHT, opacity: WARN_OPACITY };
}

/**
 * Split a path into N consecutive slices (with 1-point overlap between
 * neighbors so the segments render as a continuous line without gaps).
 */
function splitPath<T>(path: T[], n: number): T[][] {
  if (n <= 1 || path.length < 2) return [path];
  const slices: T[][] = [];
  const step = path.length / n;
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * step);
    const end = i === n - 1 ? path.length : Math.floor((i + 1) * step) + 1;
    slices.push(path.slice(start, end));
  }
  return slices;
}

function endpointMarkerHtml(
  label: string,
  color: string,
  bgColor: string,
): string {
  return `
    <div style="
      display:flex; align-items:center; gap:6px;
      transform: translateY(-2px);
      pointer-events:none;
    ">
      <div style="
        width:22px; height:22px; border-radius:9999px;
        background:${color};
        border:3px solid #fff;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35), 0 0 0 3px ${color}33;
      "></div>
      <div style="
        background:${bgColor};
        color:#fff;
        font-size:11px; font-weight:700;
        padding:3px 8px; border-radius:9999px;
        letter-spacing:0.3px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      ">${label}</div>
    </div>
  `;
}

/**
 * Hook to manage route polyline rendering on a Kakao Map.
 * - Default segments: vivid blue.
 * - When weather alerts are evaluated, each district segment is recolored
 *   by status: green (safe), amber (주의보), red (경보).
 * - Start/end points get enlarged labeled markers.
 */
export function useRoutePolyline({
  map,
  encodedPolyline,
  hazardAlerts,
  districts,
}: UseRoutePolylineOptions) {
  const polylinesRef = useRef<kakao.maps.Polyline[]>([]);
  const overlaysRef = useRef<kakao.maps.CustomOverlay[]>([]);

  useEffect(() => {
    if (!map || !encodedPolyline) return;

    // Clean up previous overlays
    polylinesRef.current.forEach((pl) => pl.setMap(null));
    polylinesRef.current = [];
    overlaysRef.current.forEach((ov) => ov.setMap(null));
    overlaysRef.current = [];

    const points = parseRoutePolyline(encodedPolyline);
    if (points.length < 2) return;

    const path = points.map(
      (p) => new window.kakao.maps.LatLng(p.lat, p.lng),
    );

    const districtList = districts ?? [];
    const hasDistrictData = districtList.length > 0 && hazardAlerts.length > 0;

    if (!hasDistrictData) {
      // Default rendering — vivid blue polyline for the whole route.
      const baseLine = new window.kakao.maps.Polyline({
        map,
        path,
        strokeWeight: BASE_WEIGHT,
        strokeColor: BASE_BLUE,
        strokeOpacity: BASE_OPACITY,
        strokeStyle: 'solid',
      });
      polylinesRef.current.push(baseLine);
    } else {
      // Segmented rendering by district status.
      const slices = splitPath(path, districtList.length);
      const alertByDistrict = new Map<string, WeatherAlert>();
      hazardAlerts.forEach((a) => alertByDistrict.set(a.district, a));

      slices.forEach((slice, idx) => {
        if (slice.length < 2) return;
        const district = districtList[idx];
        const style = statusStyle(alertByDistrict.get(district));
        const segment = new window.kakao.maps.Polyline({
          map,
          path: slice,
          strokeWeight: style.weight,
          strokeColor: style.color,
          strokeOpacity: style.opacity,
          strokeStyle: 'solid',
        });
        polylinesRef.current.push(segment);
      });
    }

    // Enlarged start/end endpoint markers
    const startOverlay = new window.kakao.maps.CustomOverlay({
      map,
      position: path[0],
      content: endpointMarkerHtml('출발', '#10B981', '#059669'),
      yAnchor: 0.5,
      xAnchor: 0.5,
      zIndex: 10,
    });
    const endOverlay = new window.kakao.maps.CustomOverlay({
      map,
      position: path[path.length - 1],
      content: endpointMarkerHtml('도착', '#2563EB', '#1D4ED8'),
      yAnchor: 0.5,
      xAnchor: 0.5,
      zIndex: 10,
    });
    overlaysRef.current.push(startOverlay, endOverlay);

    // Fit map bounds to the route
    const bounds = new window.kakao.maps.LatLngBounds();
    path.forEach((latlng) => bounds.extend(latlng));
    map.setBounds(bounds, 60, 60, 120, 60);

    return () => {
      polylinesRef.current.forEach((pl) => pl.setMap(null));
      polylinesRef.current = [];
      overlaysRef.current.forEach((ov) => ov.setMap(null));
      overlaysRef.current = [];
    };
  }, [map, encodedPolyline, hazardAlerts, districts]);
}

/**
 * Wrapper component for JSX-style usage (renders nothing, side-effect only).
 */
export default function RoutePolyline(props: UseRoutePolylineOptions) {
  useRoutePolyline(props);
  return null;
}
