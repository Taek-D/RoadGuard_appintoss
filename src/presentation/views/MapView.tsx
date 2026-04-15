import { useEffect, useRef, useState, useCallback } from 'react';
import { useGlobalStore } from '@/business/store/globalStore';
import type { CctvNode } from '@/business/store/globalStore';
import { fetchRoute, triggerNodeMatcher } from '@/business/services/routeManager';
import { evaluateHazards } from '@/business/services/hazardEvaluator';
import { useResiliencyStore, getFallbackMessage } from '@/business/utils/resiliencyController';
import { useNetworkStatus } from '@/business/hooks/useNetworkStatus';
import { loadKakaoMapSdk, getMidpoint } from '@/lib/kakaoMap';
import { MOCK_MODE, MOCK_ROUTE, MOCK_WEATHER_ALERTS, MOCK_HAZARD_NODES } from '@/lib/mockData';
import HazardMarker from '@/presentation/components/HazardMarker';
import RoutePolyline from '@/presentation/components/RoutePolyline';
import BottomSheetViewer from '@/presentation/components/BottomSheetViewer';

type LoadingState = 'loading' | 'ready' | 'error';

/* ------------------------------------------------------------------ */
/*  Mock Map Component (CSS-based visualization)                       */
/* ------------------------------------------------------------------ */

function MockMapView() {
  const route = useGlobalStore((s) => s.route) ?? MOCK_ROUTE;
  const weatherAlerts = useGlobalStore((s) => s.weatherAlerts);
  const hazardNodes = useGlobalStore((s) => s.hazardNodes);

  const [selectedNode, setSelectedNode] = useState<CctvNode | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const allCctvNodes = route.cctvNodes;
  const hazardNodeIds = new Set(hazardNodes.map((n) => n.id));
  const hazardCount = weatherAlerts.filter((a) => a.hasAlert).length;

  const handleNodeClick = useCallback((node: CctvNode) => {
    setSelectedNode(node);
  }, []);

  const handleSheetClose = useCallback(() => {
    setIsSheetOpen(false);
    setSelectedNode(null);
  }, []);

  const selectedNodeAlert = selectedNode
    ? weatherAlerts.find((a) => a.hasAlert && a.district && selectedNode.name.includes(a.district))
      ?? weatherAlerts.find((a) => a.hasAlert && (
        (a.district.includes('서초') && selectedNode.name.includes('양재')) ||
        (a.district.includes('분당') && (selectedNode.name.includes('판교') || selectedNode.name.includes('분당')))
      ))
      ?? null
    : null;

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-slate-950">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,1) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top status bar */}
      <div className="absolute top-0 left-0 right-0 z-10">
        <div
          className={`mx-3 mt-2 rounded-lg px-4 py-3 backdrop-blur-sm ${
            hazardCount > 0
              ? 'bg-red-950/80 border border-red-500/30'
              : 'bg-slate-900/70 border border-slate-600/20'
          }`}
        >
          <p
            className={`text-sm font-medium ${
              hazardCount > 0 ? 'text-red-200' : 'text-slate-200'
            }`}
          >
            {hazardCount > 0
              ? `\u26A0\uFE0F ${hazardCount}개 구간 기상 위험`
              : '\u2705 경로 안전'}
          </p>
          {hazardCount > 0 && weatherAlerts.length > 0 && (
            <p className="text-xs text-red-300/80 mt-1">
              {weatherAlerts
                .filter((a) => a.hasAlert)
                .map((a) => `${a.district}: ${a.alertType} ${a.alertLevel}`)
                .join(' | ')}
            </p>
          )}
        </div>

        {/* Mock mode badge */}
        <div className="mx-3 mt-2">
          <span className="inline-flex items-center rounded-md bg-slate-800/80 border border-slate-700/50 px-2.5 py-1 text-[10px] font-medium text-slate-400 backdrop-blur-sm">
            MOCK MODE - API key not configured
          </span>
        </div>
      </div>

      {/* Route visualization */}
      <div className="absolute inset-0 flex items-center justify-center pt-28 pb-24">
        <div className="relative w-full max-w-xs mx-auto">
          {/* Route path line (SVG) */}
          <svg
            className="absolute left-1/2 top-0 bottom-0 -translate-x-1/2"
            width="4"
            height="100%"
            style={{ overflow: 'visible' }}
          >
            <line
              x1="2"
              y1="0"
              x2="2"
              y2="100%"
              stroke="#334155"
              strokeWidth="3"
              strokeDasharray="8 4"
            />
          </svg>

          {/* CCTV Nodes */}
          <div className="relative flex flex-col gap-3">
            {allCctvNodes.map((node, index) => {
              const isHazardous = hazardNodeIds.has(node.id);
              const isSelected = selectedNode?.id === node.id;
              const isFirst = index === 0;
              const isLast = index === allCctvNodes.length - 1;

              return (
                <button
                  key={node.id}
                  type="button"
                  className={`
                    relative flex items-center gap-4 rounded-xl px-4 py-3.5 text-left transition-all duration-200
                    ${isSelected
                      ? isHazardous
                        ? 'bg-red-950/60 border border-red-500/40 shadow-lg shadow-red-900/20'
                        : 'bg-slate-800/80 border border-sky-500/40 shadow-lg shadow-sky-900/20'
                      : 'bg-slate-900/40 border border-slate-800/50 hover:bg-slate-800/60'
                    }
                  `}
                  onClick={() => handleNodeClick(node)}
                >
                  {/* Node dot */}
                  <div className="relative flex items-center justify-center shrink-0">
                    {isHazardous ? (
                      <div className="relative">
                        <div
                          className="w-5 h-5 rounded-full bg-red-500 border-2 border-red-300/80"
                          style={{
                            boxShadow: '0 0 10px 3px rgba(239, 68, 68, 0.4)',
                            animation: 'mockPulse 2s ease-in-out infinite',
                          }}
                        />
                        <div
                          className="absolute inset-[-6px] rounded-full border-2 border-red-500/30"
                          style={{ animation: 'mockRing 2s ease-in-out infinite' }}
                        />
                      </div>
                    ) : (
                      <div
                        className="w-3 h-3 rounded-full bg-slate-400 border-[1.5px] border-slate-300/60"
                        style={{ boxShadow: '0 0 4px rgba(148, 163, 184, 0.3)' }}
                      />
                    )}
                  </div>

                  {/* Node info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {isFirst && (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded">
                          출발
                        </span>
                      )}
                      {isLast && (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-sky-400 bg-sky-950/60 px-1.5 py-0.5 rounded">
                          도착
                        </span>
                      )}
                      <p className="text-sm font-medium text-slate-200 truncate">
                        {node.name}
                      </p>
                    </div>
                    <p className="text-xs mt-0.5 text-slate-500">
                      {node.lat.toFixed(4)}, {node.lng.toFixed(4)}
                    </p>
                  </div>

                  {/* Status badge */}
                  <div className="shrink-0">
                    {isHazardous ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-red-900/60 px-2 py-1 text-[10px] font-semibold text-red-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" style={{ animation: 'mockBlink 1.5s ease-in-out infinite' }} />
                        위험
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-800/60 px-2 py-1 text-[10px] font-semibold text-slate-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        안전
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected node action card */}
      {selectedNode && !isSheetOpen && (
        <div className="absolute bottom-6 left-3 right-3 z-10">
          <div className="rounded-xl bg-slate-900/90 border border-slate-700/50 backdrop-blur-sm px-4 py-3 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-100 truncate">
                  {selectedNode.name}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {hazardNodeIds.has(selectedNode.id)
                    ? '\u26A0\uFE0F 위험 구간'
                    : '\u2705 안전 구간'}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-medium hover:bg-sky-500 active:bg-sky-700 transition-colors"
                  onClick={() => setIsSheetOpen(true)}
                >
                  CCTV 보기
                </button>
                <button
                  type="button"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
                  onClick={() => {
                    setSelectedNode(null);
                    setIsSheetOpen(false);
                  }}
                  aria-label="닫기"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BottomSheetViewer */}
      <BottomSheetViewer
        node={selectedNode}
        alert={selectedNodeAlert}
        isOpen={isSheetOpen}
        onClose={handleSheetClose}
      />

      {/* CSS animations for mock markers */}
      <style>{`
        @keyframes mockPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 10px 3px rgba(239, 68, 68, 0.4); }
          50% { transform: scale(1.15); box-shadow: 0 0 16px 6px rgba(239, 68, 68, 0.6); }
        }
        @keyframes mockRing {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); }
        }
        @keyframes mockBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Real Map Component (Kakao Maps SDK)                                */
/* ------------------------------------------------------------------ */

const RealMapView = ({ onSdkFail }: { onSdkFail: () => void }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [kakaoMap, setKakaoMap] = useState<kakao.maps.Map | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedNode, setSelectedNode] = useState<CctvNode | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const user = useGlobalStore((s) => s.user);
  const route = useGlobalStore((s) => s.route);
  const weatherAlerts = useGlobalStore((s) => s.weatherAlerts);
  const hazardNodes = useGlobalStore((s) => s.hazardNodes);
  const setRoute = useGlobalStore((s) => s.setRoute);
  const setWeatherAlerts = useGlobalStore((s) => s.setWeatherAlerts);
  const setHazardNodes = useGlobalStore((s) => s.setHazardNodes);
  const setLoading = useGlobalStore((s) => s.setLoading);

  const apiStatus = useResiliencyStore((s) => s.apiStatus);
  const setApiStatus = useResiliencyStore((s) => s.setApiStatus);

  const isOnline = useNetworkStatus();
  const [retryKey, setRetryKey] = useState(0);
  const wasOfflineRef = useRef(false);

  // Determine which APIs are degraded
  const degradedApis = (Object.keys(apiStatus) as Array<keyof typeof apiStatus>).filter(
    (key) => apiStatus[key] !== 'ok'
  );

  const hazardCount = weatherAlerts.filter((a) => a.hasAlert).length;

  // All CCTV nodes from route
  const allCctvNodes = route?.cctvNodes ?? [];

  // Set of hazardous node IDs for quick lookup
  const hazardNodeIds = new Set(hazardNodes.map((n) => n.id));

  // Handle marker click — opens BottomSheetViewer with CCTV snapshot
  const handleMarkerClick = useCallback((node: CctvNode) => {
    setSelectedNode(node);
    setIsSheetOpen(true);
    console.info('[MapView] Marker clicked:', node.id, node.name);
  }, []);

  // Find matching weather alert for the selected node's district
  const selectedNodeAlert = selectedNode
    ? weatherAlerts.find((a) => a.hasAlert && a.district && selectedNode.name.includes(a.district))
      ?? weatherAlerts.find((a) => a.hasAlert && (
        (a.district.includes('서초') && selectedNode.name.includes('양재')) ||
        (a.district.includes('분당') && (selectedNode.name.includes('판교') || selectedNode.name.includes('분당')))
      ))
      ?? null
    : null;

  // Close handler for the bottom sheet
  const handleSheetClose = useCallback(() => {
    setIsSheetOpen(false);
    setSelectedNode(null);
  }, []);

  // Initialize map and load data
  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setLoadingState('loading');

      // Offline guard: bail out early with a clear message so we do not
      // burn retries on unreachable endpoints. The banner at the top
      // keeps the user informed, and the online-transition effect below
      // will bump retryKey to retry automatically when connectivity returns.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setErrorMessage(
          '인터넷 연결이 없습니다. 네트워크 상태를 확인해주세요. 연결이 복구되면 자동으로 다시 시도합니다.',
        );
        setLoadingState('error');
        setLoading(false);
        return;
      }

      try {
        // Step 1: Load Kakao Maps SDK
        await loadKakaoMapSdk();

        if (cancelled || !mapContainerRef.current) return;

        // Step 2: Load route data
        const userId = user?.userId;
        if (!userId) {
          setErrorMessage('사용자 정보를 찾을 수 없습니다.');
          setLoadingState('error');
          setLoading(false);
          return;
        }

        // Treat the MOCK sentinel as "no real route yet" so we refetch
        // from Firestore and recover whenever the Cloud Function eventually
        // finishes. Onboarding may have fallen back to MOCK due to a tight
        // timeout even though the real data is already (or soon) in Firestore.
        const isMockRoute = route?.polyline === 'MOCK';
        let routeData = isMockRoute ? null : route;

        if (!routeData) {
          try {
            routeData = await fetchRoute(userId);

            // If Firestore still has nothing, kick off the node matcher
            // one more time and try again. This rescues cases where the
            // initial Onboarding call was skipped or the Cloud Function
            // is cold-starting for the first request.
            if (!routeData) {
              try {
                await triggerNodeMatcher(userId);
                routeData = await fetchRoute(userId);
              } catch (triggerErr) {
                console.warn('[MapView] nodeMatcher recovery failed:', triggerErr);
              }
            }

            // The MVP scope dropped ITS CCTVs (the agency's egress
            // firewall blocked every cloud serverless attempt), so
            // routeData will routinely have cctvNodes: [] but still
            // carry real polyline + districts. Accept that as a valid
            // real route — the empty-cctv → MOCK fallback used to live
            // here but would now turn every real user back into mock.
            if (routeData) {
              setRoute(routeData);
              // Clear any mock-era alerts so evaluateHazards runs against
              // the real districts we just loaded.
              if (isMockRoute) {
                setWeatherAlerts([]);
                setHazardNodes([]);
              }
            }
          } catch (err) {
            console.error('[MapView] Route fetch failed:', err);
          }
        }

        if (cancelled) return;

        // Soft fallback: only when we have NO route at all (Cloud
        // Function failure, cold start before first write, etc.). Empty
        // cctvNodes is now the normal path — MVP intentionally shows
        // district-level weather hazards without per-CCTV markers.
        if (!routeData) {
          console.warn(
            '[MapView] No real route available, falling back to MOCK_ROUTE',
          );
          routeData = MOCK_ROUTE;
          setRoute(MOCK_ROUTE);
          if (useGlobalStore.getState().weatherAlerts.length === 0) {
            setWeatherAlerts(MOCK_WEATHER_ALERTS);
            setHazardNodes(MOCK_HAZARD_NODES);
          }
        }

        // Step 3: Evaluate hazards (only if real Firestore data exists)
        // Skip if we already have mock alerts from onboarding fallback
        const existingAlerts = useGlobalStore.getState().weatherAlerts;
        if (routeData.districts.length > 0 && existingAlerts.length === 0) {
          try {
            const result = await evaluateHazards(
              routeData.districts,
              routeData.cctvNodes
            );
            if (result.alerts.length > 0) {
              setWeatherAlerts(result.alerts);
              setHazardNodes(result.hazardCctvNodes);
            }
          } catch (err) {
            console.error('[MapView] Hazard evaluation failed:', err);
            setApiStatus('weather', 'degraded');
          }
        }

        if (cancelled) return;

        // Step 4: Initialize Kakao Map
        const home = user?.home;
        const work = user?.work;

        let center: { lat: number; lng: number };
        if (home && work) {
          center = getMidpoint(home, work);
        } else if (home) {
          center = home;
        } else if (work) {
          center = work;
        } else {
          // Default to Seoul city center
          center = { lat: 37.5665, lng: 126.978 };
        }

        const mapInstance = new window.kakao.maps.Map(mapContainerRef.current!, {
          center: new window.kakao.maps.LatLng(center.lat, center.lng),
          level: 7,
        });

        if (cancelled) {
          return;
        }

        setKakaoMap(mapInstance);
        setLoadingState('ready');
      } catch (err) {
        console.error('[MapView] Initialization failed:', err);
        if (!cancelled) {
          onSdkFail();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId, retryKey]);

  // Offline → online transition: bump retryKey so the init effect re-runs
  // and the user sees the map recover automatically after connectivity
  // is restored (no manual "다시 시도" tap required).
  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setRetryKey((k) => k + 1);
    }
  }, [isOnline]);

  // Handle window resize for map relayout
  useEffect(() => {
    if (!kakaoMap) return;

    const handleResize = () => {
      kakaoMap.relayout();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [kakaoMap]);

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden">
      {/* Map container with grayscale/muted style */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 w-full h-full"
        style={{
          filter: 'grayscale(0.8) contrast(1.1)',
        }}
      />

      {/* Top status bar overlay */}
      <div className="absolute top-0 left-0 right-0 z-10">
        {/* Offline banner: highest priority, masks degraded API noise */}
        {!isOnline && (
          <div
            className="mx-3 mt-2 rounded-lg border border-red-500/40 bg-red-950/85 px-4 py-3 backdrop-blur-sm"
            role="status"
            aria-live="polite"
          >
            <p className="text-sm font-medium text-red-200">
              {'\uD83D\uDCF6 인터넷 연결이 끊어졌습니다'}
            </p>
            <p className="mt-1 text-xs text-red-300/90 leading-relaxed">
              네트워크 상태를 확인해주세요. 연결이 복구되면 지도와 기상 정보를 자동으로 다시 불러옵니다.
            </p>
          </div>
        )}

        {/* Fallback messages for degraded APIs (hidden while offline) */}
        {isOnline && degradedApis.length > 0 && (
          <div className="mx-3 mt-2 rounded-lg bg-amber-900/80 px-4 py-2 backdrop-blur-sm">
            {degradedApis.map((key) => (
              <p key={key} className="text-xs text-amber-200 leading-relaxed">
                {getFallbackMessage(key)}
              </p>
            ))}
          </div>
        )}

        {/* Hazard status bar */}
        {loadingState === 'ready' && (
          <div
            className={`mx-3 mt-2 rounded-lg px-4 py-3 backdrop-blur-sm ${
              hazardCount > 0
                ? 'bg-red-950/80 border border-red-500/30'
                : 'bg-slate-900/70 border border-slate-600/20'
            }`}
          >
            <p
              className={`text-sm font-medium ${
                hazardCount > 0 ? 'text-red-200' : 'text-slate-200'
              }`}
            >
              {hazardCount > 0
                ? `\u26A0\uFE0F ${hazardCount}개 구간 기상 위험`
                : '\u2705 경로 안전'}
            </p>
            {hazardCount > 0 && weatherAlerts.length > 0 && (
              <p className="text-xs text-red-300/80 mt-1">
                {weatherAlerts
                  .filter((a) => a.hasAlert)
                  .map((a) => `${a.district}: ${a.message}`)
                  .join(' | ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Route polyline (side-effect component) */}
      {kakaoMap && route?.polyline && (
        <RoutePolyline
          map={kakaoMap}
          encodedPolyline={route.polyline}
          hazardAlerts={weatherAlerts}
        />
      )}

      {/* CCTV node markers */}
      {kakaoMap &&
        allCctvNodes.map((node) => (
          <HazardMarker
            key={node.id}
            map={kakaoMap}
            node={node}
            isHazardous={hazardNodeIds.has(node.id)}
            onMarkerClick={handleMarkerClick}
          />
        ))}

      {/* Loading overlay */}
      {loadingState === 'loading' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90">
          <div className="w-10 h-10 rounded-full border-2 border-slate-600 border-t-sky-400 animate-spin" />
          <p className="mt-4 text-sm text-slate-400">지도를 불러오는 중...</p>
        </div>
      )}

      {/* Error overlay */}
      {loadingState === 'error' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90 px-6">
          <div className="w-14 h-14 rounded-full bg-red-900/50 flex items-center justify-center mb-4">
            <svg
              className="w-7 h-7 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-sm text-slate-300 text-center leading-relaxed">
            {errorMessage || '지도를 불러올 수 없습니다.'}
          </p>
          {isOnline ? (
            <button
              type="button"
              className="mt-4 px-5 py-2.5 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-500 active:bg-sky-700 transition-colors"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              다시 시도
            </button>
          ) : (
            <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              연결 복구를 기다리는 중...
            </div>
          )}
        </div>
      )}

      {/* Selected node info card */}
      {selectedNode && loadingState === 'ready' && !isSheetOpen && (
        <div className="absolute bottom-6 left-3 right-3 z-10">
          <div className="rounded-xl bg-slate-900/90 border border-slate-700/50 backdrop-blur-sm px-4 py-3 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-100 truncate">
                  {selectedNode.name}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {hazardNodeIds.has(selectedNode.id)
                    ? '\u26A0\uFE0F 위험 구간'
                    : '\u2705 안전 구간'}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-medium hover:bg-sky-500 active:bg-sky-700 transition-colors"
                  onClick={() => setIsSheetOpen(true)}
                >
                  CCTV 보기
                </button>
                <button
                  type="button"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
                  onClick={() => {
                    setSelectedNode(null);
                    setIsSheetOpen(false);
                  }}
                  aria-label="닫기"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* BottomSheetViewer for CCTV snapshot */}
      <BottomSheetViewer
        node={selectedNode}
        alert={selectedNodeAlert}
        isOpen={isSheetOpen}
        onClose={handleSheetClose}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  MapView entry point: mock or real based on API key availability     */
/* ------------------------------------------------------------------ */

const MapView = () => {
  const [sdkFailed, setSdkFailed] = useState(false);

  // Always try real map first when API key exists, fallback to mock on failure
  if (MOCK_MODE || sdkFailed) {
    return <MockMapView />;
  }
  return <RealMapView onSdkFail={() => setSdkFailed(true)} />;
};

export default MapView;
