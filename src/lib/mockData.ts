import type { RouteData, WeatherAlert } from '@/business/store/globalStore';

export const MOCK_MODE = !import.meta.env.VITE_KAKAO_JS_KEY;

export const MOCK_SEARCH_RESULTS: Record<string, Array<{ place_name: string; address_name: string; x: string; y: string }>> = {
  home: [
    { place_name: '강남역 2호선', address_name: '서울특별시 강남구 역삼동 858', x: '127.028361', y: '37.498095' },
    { place_name: '강남구청', address_name: '서울특별시 강남구 삼성동 160-10', x: '127.047367', y: '37.517209' },
    { place_name: '강남파이낸스센터', address_name: '서울특별시 강남구 역삼동 679', x: '127.039577', y: '37.503018' },
  ],
  work: [
    { place_name: '판교역', address_name: '경기도 성남시 분당구 삼평동 670', x: '127.111439', y: '37.394879' },
    { place_name: '네이버 1784', address_name: '경기도 성남시 분당구 정자동 178-4', x: '127.105399', y: '37.359554' },
    { place_name: '카카오 판교아지트', address_name: '경기도 성남시 분당구 백현동 242', x: '127.108679', y: '37.402056' },
  ],
};

// Coordinates for drawing route line (강남역→양재IC→판교JC→분당내곡→판교역)
export const MOCK_ROUTE_COORDS = [
  { lat: 37.498095, lng: 127.028361 },
  { lat: 37.491000, lng: 127.030500 },
  { lat: 37.483021, lng: 127.034715 },
  { lat: 37.470000, lng: 127.043000 },
  { lat: 37.452344, lng: 127.056789 },
  { lat: 37.438000, lng: 127.070000 },
  { lat: 37.420156, lng: 127.089012 },
  { lat: 37.408000, lng: 127.098000 },
  { lat: 37.394879, lng: 127.111439 },
];

export const MOCK_ROUTE: RouteData = {
  polyline: 'MOCK',
  districts: ['서울특별시 강남구', '서울특별시 서초구', '경기도 성남시 분당구'],
  cctvNodes: [],
};

export const MOCK_WEATHER_ALERTS: WeatherAlert[] = [
  { district: '서울특별시 서초구', hasAlert: true, alertType: '안개', alertLevel: '주의보', message: '서울특별시 서초구 안개 주의보 발령' },
  { district: '경기도 성남시 분당구', hasAlert: true, alertType: '결빙', alertLevel: '주의보', message: '경기도 성남시 분당구 결빙 주의보 발령' },
];
