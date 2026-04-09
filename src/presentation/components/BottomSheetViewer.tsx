import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import type { CctvNode, WeatherAlert } from '@/business/store/globalStore';
import { useResiliencyStore, getFallbackMessage } from '@/business/utils/resiliencyController';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import CctvSnapshot from '@/presentation/components/CctvSnapshot';

interface BottomSheetViewerProps {
  node: CctvNode | null;
  alert: WeatherAlert | null;
  isOpen: boolean;
  onClose: () => void;
}

const BottomSheetViewer = ({ node, alert, isOpen, onClose }: BottomSheetViewerProps) => {
  const snapshotRef = useRef<HTMLDivElement>(null);
  const infoCardRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const weatherStatus = useResiliencyStore((s) => s.apiStatus.weather);

  // GSAP stagger animation on open
  useEffect(() => {
    if (!isOpen || !node) return;

    const timer = setTimeout(() => {
      const targets = [snapshotRef.current, infoCardRef.current, statusRef.current].filter(
        Boolean
      );
      if (targets.length === 0) return;

      // Ensure elements are visible first, then animate
      targets.forEach((el) => {
        if (el) { el.style.opacity = '1'; el.style.transform = 'none'; }
      });

      gsap.from(targets, {
        y: 20,
        opacity: 0,
        stagger: 0.1,
        duration: 0.4,
        ease: 'power2.out',
        clearProps: 'all',
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [isOpen, node]);

  if (!node) return null;

  const isWeatherDegraded = weatherStatus === 'degraded' || weatherStatus === 'down';
  const hasActiveAlert = alert?.hasAlert === true;

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="bg-zinc-900 border-zinc-700 rounded-t-2xl max-h-[85vh]">
        <DrawerHeader className="pb-2 relative">
          <button
            type="button"
            className="absolute right-4 top-3 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            onClick={onClose}
            aria-label="닫기"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <DrawerTitle className="text-white text-base font-semibold text-left pr-10">
            {node.name}
          </DrawerTitle>
          <DrawerDescription className="text-zinc-400 text-xs text-left">
            CCTV 실시간 스냅샷
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-8 space-y-4 overflow-y-auto">
          {/* CCTV Snapshot */}
          <div ref={snapshotRef}>
            <CctvSnapshot url={node.cctvurl} name={node.name} />
          </div>

          {/* Weather Info / Status Card */}
          <div ref={infoCardRef}>
            {isWeatherDegraded ? (
              /* API degradation fallback */
              <div className="rounded-xl bg-amber-900/40 border border-amber-700/40 px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <svg
                    className="w-4 h-4 text-amber-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"
                    />
                  </svg>
                  <span className="text-sm font-medium text-amber-300">기상 정보 제한</span>
                </div>
                <p className="text-xs text-amber-200/80 leading-relaxed">
                  {getFallbackMessage('weather')}
                </p>
              </div>
            ) : hasActiveAlert ? (
              /* Active weather alert */
              <div
                className={`rounded-xl border px-4 py-3 ${
                  alert.alertLevel === '경보'
                    ? 'bg-red-950/60 border-red-500/40'
                    : 'bg-orange-950/50 border-orange-500/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                      alert.alertLevel === '경보'
                        ? 'bg-red-600/80 text-red-100'
                        : 'bg-orange-600/80 text-orange-100'
                    }`}
                  >
                    {alert.alertType} {alert.alertLevel}
                  </span>
                </div>
                <p
                  className={`text-sm leading-relaxed ${
                    alert.alertLevel === '경보' ? 'text-red-200' : 'text-orange-200'
                  }`}
                >
                  {alert.message}
                </p>
              </div>
            ) : null}
          </div>

          {/* Safety status (when no alert and weather is available) */}
          <div ref={statusRef}>
            {!isWeatherDegraded && !hasActiveAlert && (
              <div className="rounded-xl bg-emerald-950/40 border border-emerald-600/30 px-4 py-3">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-emerald-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-sm font-medium text-emerald-300">
                    현재 이 구간은 안전합니다
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default BottomSheetViewer;
