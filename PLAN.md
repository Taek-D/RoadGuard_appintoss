# RoadGuard MVP 구현 계획서

> Seed: `seed_886da26e8f95` | Interview: `interview_20260409_094108` | Ambiguity: 0.198

---

## 1. 프로젝트 개요

**RoadGuard**는 사용자의 출퇴근 경로 상 기상 위험 요소(안개, 눈, 결빙 등)를 CCTV 데이터와 결합하여 직관적으로 제공하는 앱인토스(Apps-in-Toss) 미니앱이다.

### MVP 핵심 가치
- **빠른 확인**: 출근 30분 전 위험 알림으로 사전 대비
- **시각적 안도감**: 지도 위 위험/안전 구간을 한눈에 파악
- **실시간 확인**: CCTV 스냅샷으로 실제 도로 상황 직접 확인

### 5대 유스케이스
| UC | 설명 |
|----|------|
| UC1 | 경로 설정: 집/회사 좌표 + 출근 알림 시간 설정 (최초 1회) |
| UC2 | 사전 매칭: 경로 → 행정구역 매핑 + CCTV 좌표 매핑 (1회성, DB 캐싱) |
| UC3 | 위험 알림: 출근 30분 전, 경로 행정구역에 기상특보 발령 시 스마트 발송 |
| UC4 | 상황 확인: 지도에 경로 표시 + 위험 구간 시각적 하이라이트 |
| UC5 | CCTV 조회: 위험 구간 마커 클릭 → CCTV 스냅샷 + 요약 팝업 |

---

## 2. 확정된 기술 결정사항

인터뷰 15라운드를 통해 확정된 아키텍처 결정이다. **모든 미결 항목이 해소된 상태.**

| 영역 | 최종 결정 | 근거 |
|------|-----------|------|
| 위험 판정 | 기상청 특보 기반 이진 (안전/위험) | MVP 단순화, 세부 임계값은 후속 버전 |
| 공간 매핑 | 행정구역(특보) + 좌표(CCTV) 이원 구조 | 기상특보가 시·군·구 단위로 발령 |
| 경로→행정구역 | 1-2km 샘플링 → Kakao 역지오코딩 → DB 캐싱 | 1회성 연산, Kakao API 활용 |
| 특보 캐싱 | WeatherCollectorBatch, Cloud Scheduler 10분 → Firestore | 실시간성 vs 비용 균형 |
| 알림 발송 | PushNotifier, 1분 cron → 앱인토스 스마트 발송 API | FCM 직접 사용 불가 (미니앱 제약) |
| 인증 흐름 | 인트로 → "시작하기" → appLogin() → OnboardingForm | 토스 심사 규칙 준수 |
| 서버리스 | Firebase Cloud Functions + Cloud Scheduler + Firestore | 동일 생태계, 운영 단순화 |
| 지도 SDK | Kakao Maps SDK (스타일 맵 무채색) | 역지오코딩 동일 생태계, 국내 도로/POI 품질 |
| CCTV 표시 | ITS cctvurl → 정적 스냅샷 JPEG | MVP 스냅샷 우선 + fallback |
| 프론트엔드 | React + Zustand + Kakao Maps SDK + GSAP | Lenis 제외, GSAP은 BottomSheet/Pulse만 |
| 상태 관리 | Zustand (selective subscribe) | 렌더링 최적화, 경량 |

---

## 3. 아키텍처

### 3.1 계층 구조

```
┌──────────────────────────────────────────────────────┐
│                  Presentation Layer                   │
│  IntroView · OnboardingForm · MapView · BottomSheet  │
├──────────────────────────────────────────────────────┤
│                Business Logic Layer                   │
│  RouteManager · HazardEvaluator · GlobalStore(Zustand)│
│  ResiliencyController                                 │
├──────────────────────────────────────────────────────┤
│              Backend Layer (Firebase)                  │
│  NodeMatcherBatch · WeatherCollectorBatch · PushNotifier│
│  Firestore · Cloud Scheduler                          │
├──────────────────────────────────────────────────────┤
│                  External APIs                        │
│  KMA 기상특보 · ITS CCTV · Kakao Maps/Geocoding       │
│  앱인토스 스마트 발송 API                              │
└──────────────────────────────────────────────────────┘
```

### 3.2 데이터 흐름

```
[사용자] ──→ IntroView ──→ appLogin() ──→ OnboardingForm
                                              │
                                    집/회사 좌표 + 출근시간
                                              │
                                              ▼
                                    [NodeMatcherBatch]
                                     ├─ 경로 폴리라인 획득 (Kakao Directions)
                                     ├─ 1-2km 샘플링 → 역지오코딩 → 행정구역 목록
                                     ├─ ITS CCTV 좌표 기반 매핑
                                     └─ DB 캐싱 (1회성)

[Cloud Scheduler 10분] ──→ [WeatherCollectorBatch]
                                     ├─ KMA 특보 API 폴링
                                     └─ 행정구역별 특보 현황 → Firestore 캐싱

[Cloud Scheduler 1분] ──→ [PushNotifier]
                                     ├─ "지금+30분 = 출근시간" 사용자 필터링
                                     ├─ 해당 사용자 행정구역에 특보 있는지 확인
                                     └─ 위험 시 → 스마트 발송 API (userKey 기반)

[사용자 앱 진입] ──→ MapView
                        ├─ HazardEvaluator: DB에서 위험 데이터 조회
                        ├─ 무채색 지도 + 네온 레드 위험 구간 렌더링
                        └─ 마커 클릭 → BottomSheetViewer (CCTV 스냅샷)
```

### 3.3 Firestore 데이터 모델

```
/users/{userId}
  ├─ home: { lat, lng }
  ├─ work: { lat, lng }
  ├─ commuteTime: "07:30"
  ├─ userKey: "toss_user_key_xxx"
  └─ createdAt: timestamp

/routes/{userId}
  ├─ polyline: encoded_polyline
  ├─ districts: ["서울특별시 강남구", "성남시 분당구", ...]
  ├─ cctvNodes: [{ id, lat, lng, name, cctvurl }, ...]
  └─ updatedAt: timestamp

/weatherAlerts/{district}
  ├─ hasAlert: boolean
  ├─ alertType: "안개" | "대설" | "한파" | ...
  ├─ alertLevel: "주의보" | "경보"
  ├─ message: "서울특별시 강남구 안개 주의보 발령"
  └─ updatedAt: timestamp

/notificationLog/{logId}
  ├─ userId: string
  ├─ sentAt: timestamp
  ├─ alertType: string
  └─ status: "sent" | "failed"
```

---

## 4. 구현 단계 (Phase)

### Phase 0: 프로젝트 초기화
**목표**: 토스 심사 반려 방지 기본 세팅 완료

| 작업 | 상세 |
|------|------|
| 0-1 | `_scenario-template` 복사하여 RoadGuard 프로젝트 스캐폴딩 |
| 0-2 | `granite.config.ts` 설정 (displayName: "로드가드", primaryColor, navigationBar) |
| 0-3 | `index.html` viewport 메타태그 (`user-scalable=no`) |
| 0-4 | 브랜딩 통일 (granite.config.ts, index.html title/og:title 일치) |
| 0-5 | SDK dynamic import 패턴 + `isSupported()` 체크 유틸 작성 |
| 0-6 | Tailwind CSS 4.x 설정 |
| 0-7 | Firebase 프로젝트 생성 + Functions/Firestore 초기 설정 |
| 0-8 | `/harness-init` 스킬로 반려방지 세팅 자동 검증 |

**산출물**: 빌드 가능한 빈 프로젝트, 심사 기본 규칙 충족

---

### Phase 1: 인증 + 인트로 화면
**목표**: UC 시작점, 토스 로그인 연동

| 작업 | 상세 |
|------|------|
| 1-1 | `IntroView` 컴포넌트: 앱 소개 + "시작하기" CTA 버튼 |
| 1-2 | "시작하기" 클릭 → `appLogin()` 호출 (dynamic import + isSupported) |
| 1-3 | 로그인 성공 → userKey 서버 전송 → Firestore `/users/{userId}` 저장 |
| 1-4 | `appLogin` unlink callback → 로그아웃 처리 + 재로그인 흐름 |
| 1-5 | 웹 환경 mock: `isSupported()` 실패 시 mock userKey로 폴백 |
| 1-6 | 라우팅: 미인증 → IntroView, 인증완료+온보딩미완 → OnboardingForm, 인증+온보딩완료 → MapView |

**토스 심사 체크**:
- [x] 인트로 화면 먼저 노출 후 로그인 (NEVER: 앱 시작 직후 appLogin)
- [x] 공통 네비게이션바만 사용 (NEVER: 자체 헤더/백버튼)
- [x] 첫 화면 백버튼 → 미니앱 종료 (ALWAYS)

---

### Phase 2: 온보딩 (경로 설정)
**목표**: UC1 완성, 사용자 출발/도착지 + 알림 시간 입력

| 작업 | 상세 |
|------|------|
| 2-1 | `OnboardingForm` 컴포넌트: 출발지/도착지 입력 + 알림 시간 선택 |
| 2-2 | Kakao Maps SDK 통합: 지도 위 핀 드래그 또는 주소 검색으로 좌표 입력 |
| 2-3 | 시간 선택 UI (토스 스타일 바텀시트 또는 시간 피커) |
| 2-4 | 입력값 유효성 검증 → Firestore `/users/{userId}` 저장 |
| 2-5 | 저장 완료 → NodeMatcherBatch 트리거 (HTTP Callable Function) |
| 2-6 | `GlobalStore` (Zustand): 사용자 정보, 경로, 온보딩 상태 관리 |

**Kakao Maps SDK 세팅**:
```
- SDK 로드: script 태그 동적 삽입 또는 @react-kakao-maps-sdk 패키지
- API Key: REST API 키 (역지오코딩) + JavaScript 키 (지도 렌더링)
- 웹 환경 폴백: mock 좌표 + mock 지도 컴포넌트
```

---

### Phase 3: 백엔드 - 경로 매칭 (NodeMatcherBatch)
**목표**: UC2 완성, 경로→행정구역/CCTV 매핑

| 작업 | 상세 |
|------|------|
| 3-1 | Firebase Cloud Function: `onCall` 트리거 (온보딩 완료 시 호출) |
| 3-2 | Kakao Directions API 호출 → 경로 폴리라인 획득 |
| 3-3 | 폴리라인 1-2km 간격 샘플링 → 좌표 배열 생성 |
| 3-4 | 각 샘플 좌표 → Kakao 역지오코딩 API → 행정구역(시·군·구) 추출 |
| 3-5 | 중복 제거 → 행정구역 목록 생성 → Firestore `/routes/{userId}.districts` 저장 |
| 3-6 | ITS CCTV API: 경로 반경 N km 내 CCTV 노드 조회 → `/routes/{userId}.cctvNodes` 저장 |
| 3-7 | 에러 핸들링: API 장애 시 재시도 (exponential backoff, 최대 3회) |

**API 호출 순서**:
```
Kakao Directions → polyline decode → sampling → Kakao Geocoding (batch)
                                                         │
                                    ITS CCTV API ────────┤
                                                         ▼
                                               Firestore 저장
```

**비용 고려**: Kakao 역지오코딩은 무료 30만건/일. 50km 경로 기준 약 25-50개 샘플포인트 → 사용자 1명당 최대 50건. 일 6,000명까지 무료 티어 내 처리 가능.

---

### Phase 4: 백엔드 - 기상특보 수집 (WeatherCollectorBatch)
**목표**: UC3 준비, 기상특보 데이터 캐싱

| 작업 | 상세 |
|------|------|
| 4-1 | Cloud Scheduler: 10분 주기 cron → Cloud Function 트리거 |
| 4-2 | KMA 기상특보 API 호출 (기상청 RSS 또는 공공데이터포털 API) |
| 4-3 | 응답 파싱: 행정구역별 특보 발령 여부 + 특보 유형 + 등급 추출 |
| 4-4 | Firestore `/weatherAlerts/{district}` 배치 업데이트 |
| 4-5 | 이전 특보 해제 처리: hasAlert → false 업데이트 |
| 4-6 | 에러 핸들링: KMA API 장애 시 이전 캐시 유지 + 로그 기록 |

**KMA API 참고**:
```
- 기상특보 현황 조회: 공공데이터포털 기상특보 API
- 응답: 특보 종류(풍랑, 대설, 한파, 안개 등), 발령 지역(시·군·구), 발효 시간
- 호출 빈도: 10분 → 일 144건 (무료 티어 내)
```

---

### Phase 5: 백엔드 - 알림 발송 (PushNotifier)
**목표**: UC3 완성, 출근 30분 전 위험 알림

| 작업 | 상세 |
|------|------|
| 5-1 | Cloud Scheduler: 1분 주기 cron → Cloud Function 트리거 |
| 5-2 | Firestore 쿼리: `commuteTime == now() + 30분` 인 사용자 필터링 |
| 5-3 | 각 사용자의 `routes.districts` → `weatherAlerts` 조회 → 위험 여부 판정 |
| 5-4 | 위험 감지 시: 앱인토스 스마트 발송 API 호출 |
| 5-5 | 중복 발송 방지: `/notificationLog` 에 당일 발송 기록 확인 |
| 5-6 | 에러 핸들링: API 실패 시 재시도 + 로그 기록 |

**스마트 발송 API 연동**:
```
POST /api-partner/v1/apps-in-toss/messenger/send-message
Headers:
  x-toss-user-key: {userKey}
Body:
  templateSetCode: "ROADGUARD_HAZARD_ALERT"
  context: {
    routeName: "집 → 회사",
    alertType: "안개 주의보",
    district: "성남시 분당구"
  }
```

**사전 준비**: 템플릿 문구 작성 → 앱인토스 콘솔에서 templateSetCode 등록 → 검수 (2-3일 소요)

---

### Phase 6: 프론트엔드 - 메인 지도 (MapView)
**목표**: UC4 완성, 위험 구간 시각화

| 작업 | 상세 |
|------|------|
| 6-1 | `MapView` 컴포넌트: Kakao Maps SDK 기반 전체화면 지도 |
| 6-2 | Kakao 스타일 맵: 무채색(Dark/Light muted) 기본 스타일 적용 |
| 6-3 | 경로 폴리라인 렌더링 (Firestore에서 로드) |
| 6-4 | 위험 구간 하이라이트: 특보 발령 행정구역과 겹치는 경로 구간을 네온 레드로 표시 |
| 6-5 | 위험 마커: GSAP Pulse 애니메이션 (심장 박동 효과) |
| 6-6 | 안전 구간: 기본 색상 (회색/녹색 계열) |
| 6-7 | `HazardEvaluator`: Firestore에서 weatherAlerts + cctvNodes 조회 → 위험 모델 가공 |
| 6-8 | `GlobalStore` 연동: MapView는 위험 노드 배열만 selective subscribe |

**디자인 원칙 적용**:
- **대비(Contrast)**: 무채색 지도 vs 고채도 네온 레드 위험 구간
- **계층(Hierarchy)**: 위험 마커 > 경로 폴리라인 > 지도 배경
- **움직임(Movement)**: 마커 Pulse 효과 (GSAP, scale 0.9↔1.1 반복)

---

### Phase 7: 프론트엔드 - CCTV 바텀시트 (BottomSheetViewer)
**목표**: UC5 완성, CCTV 스냅샷 확인

| 작업 | 상세 |
|------|------|
| 7-1 | `BottomSheetViewer` 컴포넌트: 마커 클릭 시 슬라이드업 |
| 7-2 | GSAP Stagger 애니메이션: 시트 등장 시 내부 콘텐츠 순차 페이드인 |
| 7-3 | CCTV 스냅샷 이미지 로드 (ITS cctvurl → `<img>` 태그) |
| 7-4 | 기상 정보 요약: 특보 유형, 등급, 발효 시간 |
| 7-5 | 카메라 줌인: 마커 클릭 시 지도 카메라가 해당 위치로 이동 (GSAP easing) |
| 7-6 | `ResiliencyController`: CCTV 이미지 로드 실패 시 fallback (에러 아이콘이 아닌 "정보 없음" 안내) |
| 7-7 | 기상 API 장애 시 fallback UI: "공공 기상망 응답 지연, CCTV 정보만 제공" |

---

### Phase 8: 통합 테스트 + 심사 준비
**목표**: 전체 흐름 검증 + 토스 심사 통과 준비

| 작업 | 상세 |
|------|------|
| 8-1 | E2E 흐름 테스트: IntroView → 로그인 → 온보딩 → 매칭 → 지도 → CCTV |
| 8-2 | 알림 흐름 테스트: 스마트 발송 템플릿 검수 완료 확인 → 실제 발송 테스트 |
| 8-3 | `/harness-validate` 실행: NEVER/ALWAYS 규칙 자동 위반 탐지 |
| 8-4 | `/appintoss-nongame-launch-checklist` 실행: 11단계 최종 검수 |
| 8-5 | 브랜딩 최종 확인: 앱 이름 "로드가드" 일치 (config, html, 메타태그, 공유) |
| 8-6 | 기능 스킴 URL 등록 + 랜딩 페이지 정상 렌더링 확인 |
| 8-7 | 로고 확인: 600x600px 각진 정사각형, 라이트/다크 가시성 |
| 8-8 | Edge case: 네트워크 단절, API 장애, 빈 경로, 특보 없음 상태 처리 |

---

## 5. 모듈별 상세 명세

### 5.1 Presentation Layer

| 모듈 | 경로 | 역할 |
|------|------|------|
| `IntroView` | `/src/presentation/views/IntroView.tsx` | 앱 소개 + 시작하기 버튼 |
| `OnboardingForm` | `/src/presentation/views/OnboardingForm.tsx` | 출발지/도착지/시간 입력 |
| `MapView` | `/src/presentation/views/MapView.tsx` | 메인 지도 + 위험구간 렌더링 |
| `BottomSheetViewer` | `/src/presentation/components/BottomSheetViewer.tsx` | CCTV 스냅샷 + 기상 요약 팝업 |
| `HazardMarker` | `/src/presentation/components/HazardMarker.tsx` | 위험 마커 + Pulse 애니메이션 |
| `RoutePolyline` | `/src/presentation/components/RoutePolyline.tsx` | 경로 폴리라인 + 위험구간 색상 |

### 5.2 Business Logic Layer

| 모듈 | 경로 | 역할 |
|------|------|------|
| `GlobalStore` | `/src/business/store/globalStore.ts` | Zustand 전역 상태 (사용자, 경로, 위험 노드) |
| `RouteManager` | `/src/business/services/routeManager.ts` | 경로 데이터 페칭 + 가공 |
| `HazardEvaluator` | `/src/business/services/hazardEvaluator.ts` | 기상/CCTV 데이터 → 위험 모델 변환 |
| `ResiliencyController` | `/src/business/utils/resiliencyController.ts` | API 장애 시 fallback 상태 관리 |
| `AuthService` | `/src/business/services/authService.ts` | appLogin 래핑 + userKey 관리 |

### 5.3 Backend Layer (Firebase Cloud Functions)

| 모듈 | 경로 | 트리거 | 주기 |
|------|------|--------|------|
| `NodeMatcherBatch` | `/functions/src/nodeMatcherBatch.ts` | onCall (온보딩 완료) | 1회성 |
| `WeatherCollectorBatch` | `/functions/src/weatherCollectorBatch.ts` | Cloud Scheduler | 10분 |
| `PushNotifier` | `/functions/src/pushNotifier.ts` | Cloud Scheduler | 1분 |

---

## 6. 외부 API 연동 명세

| API | 용도 | 엔드포인트 | 인증 | 호출 빈도 |
|-----|------|-----------|------|----------|
| Kakao Directions | 경로 폴리라인 | `https://apis-navi.kakaomobility.com/v1/directions` | REST API Key | 사용자당 1회 |
| Kakao Geocoding | 좌표→행정구역 | `https://dapi.kakao.com/v2/local/geo/coord2regioncode` | REST API Key | 사용자당 25-50회 |
| Kakao Maps JS | 지도 렌더링 | Script SDK | App Key | 클라이언트 |
| KMA 기상특보 | 특보 현황 | 공공데이터포털 API | 서비스 키 | 10분 (144회/일) |
| ITS CCTV | CCTV 목록/URL | `https://openapi.its.go.kr/api/NCCTVInfo` | API Key | 사용자당 1회 + 갱신 |
| 스마트 발송 | 푸시 알림 | `POST /api-partner/v1/apps-in-toss/messenger/send-message` | x-toss-user-key | 사용자당 최대 1회/일 |

---

## 7. 토스 심사 컴플라이언스 매트릭스

### NEVER 규칙 대응

| 규칙 | 대응 방안 | Phase |
|------|-----------|-------|
| alert/confirm/prompt 금지 | 커스텀 모달 또는 TDS Dialog 사용 | 전체 |
| 자체 헤더/백버튼 금지 | granite.config.ts navigationBar만 사용 | P0 |
| 앱 시작 직후 appLogin 금지 | IntroView 노출 후 사용자 액션 시 로그인 | P1 |
| 외부 앱/브라우저 이동 금지 | 미니앱 내 완결 (지도, CCTV 모두 인앱) | P6-7 |
| 핀치줌 금지 | viewport user-scalable=no | P0 |
| 1개 초과 accessory 버튼 금지 | 최대 1개 모노톤 아이콘 | P0 |

### ALWAYS 규칙 대응

| 규칙 | 대응 방안 | Phase |
|------|-----------|-------|
| navigationBar withBackButton/withHomeButton | granite.config.ts 설정 | P0 |
| 첫 화면 백버튼 → 앱 종료 | IntroView에서 백버튼 = 미니앱 종료 | P1 |
| 앱 이름 통일 ("로드가드") | config, html, og:title, 공유 메시지 일치 | P0, P8 |
| primaryColor 6자리 hex | granite.config.ts에 #XXXXXX 형태 | P0 |
| appLogin unlink callback | 로그아웃 + 재로그인 흐름 구현 | P1 |
| 데이터 즉시 반영 | 온보딩 저장 후 즉시 경로 표시 | P2, P6 |

---

## 8. 의존성 그래프 및 구현 순서

```
Phase 0 (초기화)
    │
    ▼
Phase 1 (인증 + 인트로) ───────────────────────┐
    │                                           │
    ▼                                           │
Phase 2 (온보딩/경로설정)                        │
    │                                           │
    ├──────────────┐                            │
    ▼              ▼                            │
Phase 3         Phase 4                         │
(NodeMatcher)   (WeatherCollector)              │
    │              │                            │
    └──────┬───────┘                            │
           ▼                                    │
        Phase 5 (PushNotifier)                  │
           │                                    │
    ┌──────┴──────────────────────────┘         │
    ▼                                           │
Phase 6 (MapView) ◀─────────── Phase 3, 4 데이터│
    │
    ▼
Phase 7 (BottomSheet/CCTV)
    │
    ▼
Phase 8 (통합 테스트 + 심사 준비)
```

**병렬 가능 구간**:
- Phase 3 (NodeMatcher)과 Phase 4 (WeatherCollector)는 독립적으로 병렬 구현 가능
- Phase 6 (MapView)는 Phase 3, 4의 Firestore 스키마만 확정되면 mock 데이터로 선행 개발 가능

---

## 9. 리스크 및 완화 전략

| 리스크 | 영향도 | 완화 전략 |
|--------|--------|-----------|
| KMA API 장애/지연 | 높음 | WeatherCollectorBatch: 이전 캐시 유지, ResiliencyController fallback UI |
| ITS CCTV URL 만료 | 중간 | "정보 없음" 안내, 마지막 정상 스냅샷 캐싱 (후속 버전) |
| 스마트 발송 템플릿 검수 지연 | 높음 | Phase 5 시작 전 미리 템플릿 등록 (2-3일 소요) → **Phase 0에서 선행 등록** |
| Kakao Maps 스타일맵 제약 | 낮음 | 무채색 스타일 미지원 시 오버레이 레이어로 대체 |
| 토스 WebView 호환성 | 중간 | 실기기 테스트 필수, SDK isSupported 체크로 graceful degradation |
| 1분 cron Cloud Scheduler 비용 | 낮음 | 월 $0.10/job 수준, MVP 규모에서 무시 가능 |
| 워크스페이스 스마트 발송 10만건 제한 | 낮음 | MVP 사용자 규모에서 충분, 모니터링 추가 |

---

## 10. 선행 작업 (Phase 0 이전)

Phase 0 착수 전 반드시 완료해야 하는 외부 작업:

1. **앱인토스 콘솔 등록**: 워크스페이스 생성, 앱 등록, 로고 업로드
2. **스마트 발송 템플릿 등록**: 위험 알림 문구 작성 → 검수 제출 (2-3일)
3. **API 키 발급**:
   - Kakao Developers: REST API 키 + JavaScript 키
   - 공공데이터포털: KMA 기상특보 API 서비스 키
   - ITS 국가교통정보센터: CCTV API 키
4. **Firebase 프로젝트 생성**: Functions, Firestore, Cloud Scheduler 활성화
5. **앱인토스 콘솔 callback URL 등록**: UNLINK, WITHDRAWAL_TERMS, WITHDRAWAL_TOSS

---

## 부록: Seed 원본 참조

```yaml
seed_id: seed_886da26e8f95
interview_id: interview_20260409_094108
ambiguity_score: 0.198

ambiguity_breakdown:
  goal_clarity: 0.95 (weight: 0.35)
  constraint_clarity: 0.82 (weight: 0.25)
  success_criteria_clarity: 0.50 (weight: 0.25)
  context_clarity: 0.93 (weight: 0.15)

brownfield: true
rounds: 15
status: completed
```
