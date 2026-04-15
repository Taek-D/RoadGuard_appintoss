import { callSdkApi, isWebEnvironment } from '@/lib/sdk';

const MOCK_USER_KEY = 'mock_toss_user_dev_001';
const MOCK_AUTH_CODE = 'mock-authorization-code-roadguard';
const JWT_STORAGE_KEY = 'roadguard:auth:token';

// Cloud Function URL. Matches exchangeAuthCode's asia-northeast3 deployment.
// In real production the projectId comes from Vite env; the mock fallback
// keeps local dev running without a working Firebase project.
const FUNCTIONS_REGION = 'asia-northeast3';
const EXCHANGE_URL = `https://${FUNCTIONS_REGION}-${
  import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-roadguard'
}.cloudfunctions.net/exchangeAuthCode`;

export interface LoginResult {
  success: boolean;
  userKey: string;
  token: string;
}

type Referrer = 'DEFAULT' | 'SANDBOX' | 'UNLINK' | 'WITHDRAWAL_TERMS' | 'WITHDRAWAL_TOSS';

interface TossLoginResult {
  authorizationCode: string;
  referrer: Referrer;
}

interface ExchangeResponse {
  token: string;
  userKey: string;
  expiresIn: number;
  referrer: Referrer;
  unlinked?: boolean;
}

// Exchange the Toss authorization code for our app JWT via the
// exchangeAuthCode Cloud Function. Toss OAuth tokens never touch the
// client — only the app-issued JWT does.
async function exchangeWithServer(
  authorizationCode: string,
  referrer: Referrer,
): Promise<ExchangeResponse> {
  const res = await fetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorizationCode, referrer }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`exchangeAuthCode HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }
  return (await res.json()) as ExchangeResponse;
}

function persistToken(token: string): void {
  try {
    if (typeof window !== 'undefined' && token) {
      window.localStorage.setItem(JWT_STORAGE_KEY, token);
    }
  } catch {
    // localStorage may be unavailable (private mode, SSR). The token is
    // also kept in memory by callers, so silent failure is acceptable.
  }
}

export function getStoredToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(JWT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearStoredToken(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(JWT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export async function appLogin(): Promise<LoginResult> {
  // In the browser dev environment the Toss SDK is not loaded. We still
  // hit the Cloud Function so the flow is exercised end-to-end; when
  // VITE_FIREBASE_PROJECT_ID is the demo fallback the fetch throws and
  // we degrade to a pure-mock login that never leaves the client.
  if (isWebEnvironment()) {
    try {
      const exchange = await exchangeWithServer(MOCK_AUTH_CODE, 'SANDBOX');
      persistToken(exchange.token);
      console.info('[Auth Mock] Web login via server exchange');
      return { success: true, userKey: exchange.userKey, token: exchange.token };
    } catch (err) {
      console.info(
        '[Auth Mock] Server unreachable, using client-only mock:',
        err instanceof Error ? err.message : err,
      );
      return { success: true, userKey: MOCK_USER_KEY, token: '' };
    }
  }

  try {
    const tossResult = await callSdkApi<TossLoginResult>(
      '@apps-in-toss/web-framework',
      'appLogin',
    );

    if (!tossResult?.authorizationCode) {
      console.error('[Auth] appLogin returned no authorizationCode');
      return { success: false, userKey: '', token: '' };
    }

    const exchange = await exchangeWithServer(
      tossResult.authorizationCode,
      tossResult.referrer ?? 'DEFAULT',
    );

    if (exchange.unlinked) {
      // Unlink / withdrawal callback — the server already cleared the
      // profile; the client must not proceed as if logged in.
      clearStoredToken();
      return { success: false, userKey: exchange.userKey, token: '' };
    }

    persistToken(exchange.token);
    return { success: true, userKey: exchange.userKey, token: exchange.token };
  } catch (error) {
    console.error('[Auth] Login failed:', error);
    return { success: false, userKey: '', token: '' };
  }
}

export async function registerUnlinkCallback(
  onUnlink: () => void,
): Promise<void> {
  if (isWebEnvironment()) {
    console.info('[Auth Mock] Unlink callback registered (no-op in web)');
    return;
  }

  await callSdkApi(
    '@apps-in-toss/web-framework',
    'onAppLoginUnlink',
    () => {
      clearStoredToken();
      onUnlink();
    },
  );
}
