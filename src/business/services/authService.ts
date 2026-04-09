import { callSdkApi, isWebEnvironment } from '@/lib/sdk';

const MOCK_USER_KEY = 'mock_toss_user_dev_001';

export interface LoginResult {
  success: boolean;
  userKey: string;
}

export async function appLogin(): Promise<LoginResult> {
  if (isWebEnvironment()) {
    console.info('[Auth Mock] Using mock login in web environment');
    return { success: true, userKey: MOCK_USER_KEY };
  }

  try {
    const result = await callSdkApi<{ userKey: string }>(
      '@apps-in-toss/web-framework',
      'appLogin'
    );

    if (result?.userKey) {
      return { success: true, userKey: result.userKey };
    }
    return { success: false, userKey: '' };
  } catch (error) {
    console.error('[Auth] Login failed:', error);
    return { success: false, userKey: '' };
  }
}

export async function registerUnlinkCallback(
  onUnlink: () => void
): Promise<void> {
  if (isWebEnvironment()) {
    console.info('[Auth Mock] Unlink callback registered (no-op in web)');
    return;
  }

  await callSdkApi(
    '@apps-in-toss/web-framework',
    'onAppLoginUnlink',
    onUnlink
  );
}
