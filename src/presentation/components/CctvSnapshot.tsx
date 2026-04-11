import { useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useResiliencyStore } from '@/business/utils/resiliencyController';

interface CctvSnapshotProps {
  url: string;
  name: string;
}

const CctvSnapshot = ({ url, name }: CctvSnapshotProps) => {
  // Guard against empty CCTV URLs (can happen when ITS API returns a node
  // without cctvurl). Skip the <img> entirely and show the fallback UI.
  const hasValidUrl = typeof url === 'string' && url.trim().length > 0;
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    hasValidUrl ? 'loading' : 'error',
  );
  const setApiStatus = useResiliencyStore((s) => s.setApiStatus);

  const handleLoad = useCallback(() => {
    setStatus('loaded');
  }, []);

  const handleError = useCallback(() => {
    setStatus('error');
    setApiStatus('cctv', 'degraded');
  }, [setApiStatus]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: '16 / 9' }}>
      {/* Loading skeleton */}
      {status === 'loading' && (
        <Skeleton className="absolute inset-0 w-full h-full rounded-xl bg-zinc-800" />
      )}

      {/* Error fallback */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-800 rounded-xl">
          <svg
            className="w-10 h-10 text-zinc-500 mb-2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
          <p className="text-sm text-zinc-400">CCTV 정보를 불러올 수 없습니다</p>
        </div>
      )}

      {/* Actual image (hidden when error) */}
      {status !== 'error' && (
        <img
          src={url}
          alt={`${name} CCTV`}
          className={`absolute inset-0 w-full h-full object-cover rounded-xl transition-opacity duration-300 ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  );
};

export default CctvSnapshot;
