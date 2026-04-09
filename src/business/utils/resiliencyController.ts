import { create } from 'zustand';

interface ApiStatus {
  weather: 'ok' | 'degraded' | 'down';
  cctv: 'ok' | 'degraded' | 'down';
  kakaoMap: 'ok' | 'degraded' | 'down';
}

interface ResiliencyState {
  apiStatus: ApiStatus;
  lastChecked: number;
  setApiStatus: (key: keyof ApiStatus, status: ApiStatus[keyof ApiStatus]) => void;
}

export const useResiliencyStore = create<ResiliencyState>((set) => ({
  apiStatus: { weather: 'ok', cctv: 'ok', kakaoMap: 'ok' },
  lastChecked: Date.now(),
  setApiStatus: (key, status) =>
    set((state) => ({
      apiStatus: { ...state.apiStatus, [key]: status },
      lastChecked: Date.now(),
    })),
}));

export function getFallbackMessage(apiKey: keyof ApiStatus): string {
  const messages: Record<keyof ApiStatus, string> = {
    weather: '공공 기상망 응답 지연, CCTV 정보만 제공됩니다.',
    cctv: 'CCTV 데이터를 불러올 수 없습니다. 기상 정보만 제공됩니다.',
    kakaoMap: '지도 로딩에 실패했습니다. 잠시 후 다시 시도해주세요.',
  };
  return messages[apiKey];
}
