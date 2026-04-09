import { MOCK_MODE, MOCK_SEARCH_RESULTS } from '@/lib/mockData';

export interface KakaoPlace {
  address_name: string;
  x: string; // longitude
  y: string; // latitude
  place_name?: string;
}

function mockSearch(query: string): KakaoPlace[] {
  const q = query.toLowerCase();
  if (q.includes('강남') || q.includes('역삼')) {
    return MOCK_SEARCH_RESULTS.home;
  }
  if (q.includes('판교') || q.includes('분당')) {
    return MOCK_SEARCH_RESULTS.work;
  }
  return [...MOCK_SEARCH_RESULTS.home, ...MOCK_SEARCH_RESULTS.work];
}

export async function searchAddress(
  query: string,
): Promise<KakaoPlace[]> {
  if (!query.trim()) return [];

  // Mock mode: return mock results without calling API
  if (MOCK_MODE) {
    return mockSearch(query);
  }

  const apiKey = import.meta.env.VITE_KAKAO_REST_KEY;
  if (!apiKey) {
    console.warn('[kakaoSearch] VITE_KAKAO_REST_KEY is not set');
    return [];
  }

  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword');
  url.searchParams.set('query', query);
  url.searchParams.set('size', '7');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Kakao API error: ${res.status}`);
  }

  const data = await res.json();

  return (data.documents ?? []).map(
    (doc: Record<string, string>) => ({
      address_name: doc.address_name || doc.road_address_name || '',
      place_name: doc.place_name || '',
      x: doc.x,
      y: doc.y,
    }),
  );
}
