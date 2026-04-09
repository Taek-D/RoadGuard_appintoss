import { useEffect, useRef } from 'react';
import { decodePolyline } from '@/lib/kakaoMap';
import { MOCK_ROUTE_COORDS } from '@/lib/mockData';
import type { WeatherAlert } from '@/business/store/globalStore';

interface UseRoutePolylineOptions {
  map: kakao.maps.Map | null;
  encodedPolyline: string;
  hazardAlerts: WeatherAlert[];
}

// Color constants
const SAFE_COLOR = '#94A3B8';
const HAZARD_COLOR = '#FF3B3B';
const SAFE_WEIGHT = 5;
const HAZARD_WEIGHT = 7;
const HAZARD_OPACITY = 0.9;
const SAFE_OPACITY = 0.7;

/**
 * Hook to manage route polyline rendering on a Kakao Map.
 * Draws the route with color coding:
 * - Default (safe): slate gray #94A3B8, strokeWeight 5
 * - Hazard segments: neon red #FF3B3B, strokeWeight 7
 *
 * Since we cannot determine exact hazard segments from coordinate-level data
 * in the MVP, we use a simple approach:
 * - If there are hazard alerts, we overlay a hazard-colored polyline on the
 *   entire route to indicate danger, with lower opacity safe line beneath.
 * - In a production version, segments would be matched to districts.
 */
export function useRoutePolyline({
  map,
  encodedPolyline,
  hazardAlerts,
}: UseRoutePolylineOptions) {
  const polylinesRef = useRef<kakao.maps.Polyline[]>([]);

  useEffect(() => {
    if (!map || !encodedPolyline) return;

    // Clean up previous polylines
    polylinesRef.current.forEach((pl) => pl.setMap(null));
    polylinesRef.current = [];

    // Use mock coordinates if polyline is 'MOCK', otherwise decode
    const points = encodedPolyline === 'MOCK'
      ? MOCK_ROUTE_COORDS
      : decodePolyline(encodedPolyline);
    if (points.length < 2) return;

    const path = points.map(
      (p) => new window.kakao.maps.LatLng(p.lat, p.lng)
    );

    const hasHazards = hazardAlerts.length > 0;

    // Base polyline (always drawn)
    const baseLine = new window.kakao.maps.Polyline({
      map,
      path,
      strokeWeight: SAFE_WEIGHT,
      strokeColor: SAFE_COLOR,
      strokeOpacity: SAFE_OPACITY,
      strokeStyle: 'solid',
    });
    polylinesRef.current.push(baseLine);

    if (hasHazards) {
      // For MVP: overlay hazard color on the full route to indicate danger
      // In production, this would be segmented by district boundaries
      const hazardLine = new window.kakao.maps.Polyline({
        map,
        path,
        strokeWeight: HAZARD_WEIGHT,
        strokeColor: HAZARD_COLOR,
        strokeOpacity: HAZARD_OPACITY,
        strokeStyle: 'solid',
      });
      polylinesRef.current.push(hazardLine);
    }

    // Fit map bounds to the route
    const bounds = new window.kakao.maps.LatLngBounds();
    path.forEach((latlng) => bounds.extend(latlng));
    map.setBounds(bounds, 60, 60, 120, 60);

    return () => {
      polylinesRef.current.forEach((pl) => pl.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, encodedPolyline, hazardAlerts]);
}

/**
 * Wrapper component for JSX-style usage (renders nothing, side-effect only).
 */
export default function RoutePolyline(props: UseRoutePolylineOptions) {
  useRoutePolyline(props);
  return null;
}
