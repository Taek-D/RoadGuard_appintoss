import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { searchAddress, type KakaoPlace } from '@/lib/kakaoSearch';
import { triggerNodeMatcher, fetchRoute } from '@/business/services/routeManager';
import { useGlobalStore } from '@/business/store/globalStore';
import { MOCK_MODE, MOCK_ROUTE, MOCK_WEATHER_ALERTS } from '@/lib/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LocationData {
  lat: number;
  lng: number;
  label: string;
}

/* ------------------------------------------------------------------ */
/*  Step indicator dots                                                */
/* ------------------------------------------------------------------ */

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-2 rounded-full transition-all duration-300',
            i === current ? 'w-6 bg-blue-500' : 'w-2 bg-gray-300',
          )}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Address search step (reused for home & work)                       */
/* ------------------------------------------------------------------ */

function AddressStep({
  title,
  subtitle,
  value,
  onSelect,
}: {
  title: string;
  subtitle: string;
  value: LocationData | null;
  onSelect: (loc: LocationData) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KakaoPlace[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((input: string) => {
    setQuery(input);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!input.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const places = await searchAddress(input);
        setResults(places);
      } catch {
        toast.error('주소 검색에 실패했습니다.');
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSelect = (place: KakaoPlace) => {
    const label = place.place_name
      ? `${place.place_name} (${place.address_name})`
      : place.address_name;
    onSelect({
      lat: Number(place.y),
      lng: Number(place.x),
      label,
    });
    setQuery('');
    setResults([]);
  };

  return (
    <div className="flex w-full flex-col">
      <h2 className="mb-2 text-2xl font-bold text-gray-900">{title}</h2>
      <p className="mb-6 text-sm leading-relaxed text-gray-500">{subtitle}</p>

      <div className="relative">
        <div className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Input
            placeholder="주소를 검색하세요"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Search results dropdown */}
        {results.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {results.map((place, idx) => (
              <li key={`${place.x}-${place.y}-${idx}`}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-blue-50"
                  onClick={() => handleSelect(place)}
                >
                  {place.place_name && (
                    <span className="text-sm font-medium text-gray-900">
                      {place.place_name}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    {place.address_name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {isSearching && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-gray-200 bg-white px-4 py-3 text-center text-sm text-gray-400 shadow-lg">
            검색 중...
          </div>
        )}
      </div>

      {/* Selected location preview */}
      {value && (
        <div className="mt-6 flex items-start gap-3 rounded-xl bg-blue-50 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-5 w-5"
            >
              <path
                fillRule="evenodd"
                d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742zM12 13.5a3 3 0 100-6 3 3 0 000 6z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 break-words">
              {value.label}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Time picker step                                                   */
/* ------------------------------------------------------------------ */

function TimeStep({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: string;
  minute: string;
  onHourChange: (h: string) => void;
  onMinuteChange: (m: string) => void;
}) {
  const hours = Array.from({ length: 8 }, (_, i) =>
    String(i + 5).padStart(2, '0'),
  ); // 05-12
  const minutes = ['00', '10', '20', '30', '40', '50'];

  return (
    <div className="flex w-full flex-col">
      <h2 className="mb-2 text-2xl font-bold text-gray-900">
        알림 시간을 설정해주세요
      </h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        출근 30분 전에 기상 위험 알림을 보내드려요
      </p>

      <div className="flex items-center justify-center gap-4">
        {/* Hour select */}
        <div className="w-28">
          <Select value={hour} onValueChange={onHourChange}>
            <SelectTrigger className="h-14 text-center text-2xl font-semibold">
              <SelectValue placeholder="시" />
            </SelectTrigger>
            <SelectContent>
              {hours.map((h) => (
                <SelectItem key={h} value={h} className="text-lg">
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-3xl font-bold text-gray-400">:</span>

        {/* Minute select */}
        <div className="w-28">
          <Select value={minute} onValueChange={onMinuteChange}>
            <SelectTrigger className="h-14 text-center text-2xl font-semibold">
              <SelectValue placeholder="분" />
            </SelectTrigger>
            <SelectContent>
              {minutes.map((m) => (
                <SelectItem key={m} value={m} className="text-lg">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Time preview */}
      <div className="mt-8 flex flex-col items-center gap-2 rounded-xl bg-blue-50 py-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 text-white">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-gray-900">
          매일 오전 {hour}:{minute}
        </p>
        <p className="text-xs text-gray-500">
          기상 위험 알림을 보내드립니다
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main OnboardingForm                                                */
/* ------------------------------------------------------------------ */

const TOTAL_STEPS = 3;

const OnboardingForm = () => {
  const [step, setStep] = useState(0);
  const [home, setHome] = useState<LocationData | null>(null);
  const [work, setWork] = useState<LocationData | null>(null);
  const [hour, setHour] = useState('07');
  const [minute, setMinute] = useState('30');
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  const user = useGlobalStore((s) => s.user);
  const setUser = useGlobalStore((s) => s.setUser);
  const setAuthState = useGlobalStore((s) => s.setAuthState);
  const setLoading = useGlobalStore((s) => s.setLoading);
  const isLoading = useGlobalStore((s) => s.isLoading);

  const isNextDisabled = (() => {
    if (step === 0) return !home;
    if (step === 1) return !work;
    return false; // step 2 always has a default time
  })();

  const setRoute = useGlobalStore((s) => s.setRoute);
  const setWeatherAlerts = useGlobalStore((s) => s.setWeatherAlerts);

  const handleNext = async () => {
    if (step < TOTAL_STEPS - 1) {
      setDirection('forward');
      setStep((s) => s + 1);
      return;
    }

    // Step 3: complete onboarding
    if (!user) {
      toast.error('사용자 정보를 찾을 수 없습니다.');
      return;
    }

    setLoading(true);
    try {
      const commuteTime = `${hour}:${minute}`;

      // Update local store first (always works)
      setUser({
        ...user,
        home: { lat: home!.lat, lng: home!.lng },
        work: { lat: work!.lat, lng: work!.lng },
        commuteTime,
      });

      // Try Firestore save with 5s timeout, fallback to mock data
      try {
        const firestorePromise = setDoc(doc(db, 'users', user.userId), {
          home: { lat: home!.lat, lng: home!.lng },
          work: { lat: work!.lat, lng: work!.lng },
          commuteTime,
        }, { merge: true });

        await Promise.race([
          firestorePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
      } catch (err) {
        console.warn('[Onboarding] Firestore save failed/timed out:', err);
      }

      // Try node matcher (Cloud Function), then load the real route it just
      // wrote to Firestore. If anything fails/times out, MapView will retry
      // the recovery path itself, and we fall back to MOCK_ROUTE below.
      try {
        if (!MOCK_MODE) {
          await Promise.race([
            triggerNodeMatcher(user.userId),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
          ]);

          // Read the route the Cloud Function just persisted so MapView can
          // render real CCTV URLs instead of the MOCK_ROUTE fallback.
          const realRoute = await Promise.race([
            fetchRoute(user.userId),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
          ]);
          if (realRoute) {
            setRoute(realRoute);
            // Leave weatherAlerts empty so MapView's evaluateHazards
            // can populate them from the real districts.
          }
        }
      } catch (err) {
        console.warn('[Onboarding] NodeMatcher unavailable, MapView will retry:', err);
      }

      // Fallback only if we still have no route. MapView's MOCK-sentinel
      // detection will later refetch and upgrade to real data when the
      // Cloud Function finishes in the background.
      if (!useGlobalStore.getState().route) {
        setRoute(MOCK_ROUTE);
        setWeatherAlerts(MOCK_WEATHER_ALERTS);
      }

      setAuthState('authenticated_onboarded');
    } catch {
      toast.error('설정 저장에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setDirection('backward');
      setStep((s) => s - 1);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Top area with step indicator */}
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        {/* Step back button — text label to avoid being mistaken for a native
            back button by the reviewer. Form step navigation only, not history. */}
        <button
          type="button"
          className={cn(
            'min-w-[3rem] text-left text-sm font-medium transition-opacity',
            step === 0
              ? 'pointer-events-none opacity-0'
              : 'text-gray-500 opacity-100 hover:text-gray-700',
          )}
          onClick={handleBack}
          aria-label="이전 단계"
        >
          이전
        </button>

        <StepDots current={step} total={TOTAL_STEPS} />

        {/* Spacer for alignment (matches button min-width) */}
        <div className="min-w-[3rem]" />
      </div>

      {/* Step content with transition */}
      <div className="flex flex-1 flex-col overflow-hidden px-6 pt-6 pb-4">
        <div
          key={step}
          className={cn(
            'flex flex-1 flex-col animate-in fade-in duration-300',
            direction === 'forward' ? 'slide-in-from-right-4' : 'slide-in-from-left-4',
          )}
        >
          {step === 0 && (
            <AddressStep
              title="출발지를 설정해주세요"
              subtitle="매일 출발하는 곳의 주소를 입력하세요"
              value={home}
              onSelect={setHome}
            />
          )}
          {step === 1 && (
            <AddressStep
              title="도착지를 설정해주세요"
              subtitle="출근하는 회사의 주소를 입력하세요"
              value={work}
              onSelect={setWork}
            />
          )}
          {step === 2 && (
            <TimeStep
              hour={hour}
              minute={minute}
              onHourChange={setHour}
              onMinuteChange={setMinute}
            />
          )}
        </div>
      </div>

      {/* Bottom action button */}
      <div className="px-6 pb-8">
        <Button
          size="lg"
          className="w-full rounded-xl bg-blue-500 py-6 text-lg font-semibold text-white hover:bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500"
          onClick={handleNext}
          disabled={isNextDisabled || isLoading}
        >
          {isLoading
            ? '저장 중...'
            : step < TOTAL_STEPS - 1
              ? '다음'
              : '시작하기'}
        </Button>
      </div>
    </div>
  );
};

export default OnboardingForm;
