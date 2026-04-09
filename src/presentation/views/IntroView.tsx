import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { appLogin, registerUnlinkCallback } from '@/business/services/authService';
import { useGlobalStore } from '@/business/store/globalStore';

const IntroView = () => {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const setUser = useGlobalStore((s) => s.setUser);
  const setAuthState = useGlobalStore((s) => s.setAuthState);
  const reset = useGlobalStore((s) => s.reset);

  useEffect(() => {
    registerUnlinkCallback(() => {
      reset();
      setAuthState('unauthenticated');
      toast.info('로그인 연동이 해제되었습니다.');
    });
  }, [reset, setAuthState]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await appLogin();
      if (result.success) {
        setUser({
          userId: result.userKey,
          userKey: result.userKey,
          home: null,
          work: null,
          commuteTime: null,
        });
        setAuthState('authenticated_no_onboarding');
      } else {
        toast.error('로그인에 실패했습니다. 다시 시도해 주세요.');
      }
    } catch {
      toast.error('로그인 중 오류가 발생했습니다.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-sky-50 to-blue-100 px-6">
      {/* Weather / road icon area */}
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-lg">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-12 w-12 text-blue-500"
        >
          {/* Shield shape */}
          <path d="M12 2l7 4v5c0 5.25-3.5 9.74-7 11-3.5-1.26-7-5.75-7-11V6l7-4z" />
          {/* Cloud inside shield */}
          <path d="M9.5 13a2 2 0 0 1 0-4h.09A2.5 2.5 0 0 1 14 9.5V10a2 2 0 0 1 0 4h-4.5z" />
        </svg>
      </div>

      <h1 className="mb-2 text-3xl font-bold text-gray-900">로드가드</h1>

      <p className="mb-10 text-center text-base leading-relaxed text-gray-600">
        출퇴근 경로 기상 위험을
        <br />
        미리 확인하세요
      </p>

      <Button
        size="lg"
        className="w-full max-w-xs rounded-xl bg-blue-500 py-6 text-lg font-semibold text-white hover:bg-blue-600"
        onClick={handleLogin}
        disabled={isLoggingIn}
      >
        {isLoggingIn ? '로그인 중...' : '시작하기'}
      </Button>
    </div>
  );
};

export default IntroView;
