/**
 * Kakao Maps SDK loader utility & polyline decoder
 */

let loadPromise: Promise<void> | null = null;

/**
 * Dynamically load the Kakao Maps JavaScript SDK.
 * Resolves immediately if already loaded. Caches the promise to avoid duplicate loads.
 */
export function loadKakaoMapSdk(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    if (window.kakao?.maps) {
      window.kakao.maps.load(() => resolve());
      return;
    }

    const appKey = import.meta.env.VITE_KAKAO_JS_KEY;
    if (!appKey) {
      reject(new Error('[KakaoMap] VITE_KAKAO_JS_KEY is not set'));
      return;
    }

    const script = document.createElement('script');
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`;
    script.async = true;

    script.onload = () => {
      window.kakao.maps.load(() => resolve());
    };

    script.onerror = () => {
      loadPromise = null;
      reject(new Error('[KakaoMap] Failed to load Kakao Maps SDK'));
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Decode a Google-style encoded polyline string into an array of {lat, lng}.
 * Reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
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

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    // Decode longitude
    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5,
    });
  }

  return points;
}

/**
 * Compute the midpoint between two coordinates.
 */
export function getMidpoint(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): { lat: number; lng: number } {
  return {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  };
}
