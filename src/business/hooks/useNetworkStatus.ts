import { useEffect, useState } from 'react';

/**
 * Tracks browser online/offline status via navigator.onLine
 * and the online/offline window events.
 *
 * SSR-safe: returns `true` when navigator is unavailable, so
 * server renders do not flash an offline banner.
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Sync once on mount in case the initial useState ran before hydration
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
