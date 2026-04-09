import type { RouteData, CctvNode, WeatherAlert } from '@/business/store/globalStore';

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

export const MOCK_ROUTE: RouteData = {
  polyline: '',
  districts: ['서울특별시 강남구', '서울특별시 서초구', '경기도 성남시 분당구'],
  cctvNodes: [
    { id: 'cctv-001', lat: 37.498095, lng: 127.028361, name: '강남대로 강남역 부근', cctvurl: 'https://picsum.photos/seed/cctv1/640/360' },
    { id: 'cctv-002', lat: 37.483021, lng: 127.034715, name: '경부고속도로 양재IC', cctvurl: 'https://picsum.photos/seed/cctv2/640/360' },
    { id: 'cctv-003', lat: 37.452344, lng: 127.056789, name: '경부고속도로 판교JC', cctvurl: 'https://picsum.photos/seed/cctv3/640/360' },
    { id: 'cctv-004', lat: 37.420156, lng: 127.089012, name: '분당내곡간도시고속화도로', cctvurl: 'https://picsum.photos/seed/cctv4/640/360' },
    { id: 'cctv-005', lat: 37.394879, lng: 127.111439, name: '판교역 부근 도로', cctvurl: 'https://picsum.photos/seed/cctv5/640/360' },
  ],
};

export const MOCK_WEATHER_ALERTS: WeatherAlert[] = [
  { district: '서울특별시 서초구', hasAlert: true, alertType: '안개', alertLevel: '주의보', message: '서울특별시 서초구 안개 주의보 발령' },
  { district: '경기도 성남시 분당구', hasAlert: true, alertType: '결빙', alertLevel: '주의보', message: '경기도 성남시 분당구 결빙 주의보 발령' },
];

// Hazard CCTV nodes: cctv-002 (양재IC), cctv-003 (판교JC), cctv-005 (판교역)
export const MOCK_HAZARD_NODES: CctvNode[] = MOCK_ROUTE.cctvNodes.filter(
  (node) => node.id === 'cctv-002' || node.id === 'cctv-003' || node.id === 'cctv-005'
);
