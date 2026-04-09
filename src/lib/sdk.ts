/**
 * Apps-in-Toss SDK dynamic import + isSupported 패턴
 * CLAUDE.md 규칙: Static import 금지, 반드시 dynamic import + isSupported 체크
 */

type SdkModule = Record<string, unknown>;

const isWebEnvironment = (): boolean => {
  try {
    return typeof window !== 'undefined' && !window.hasOwnProperty('__TOSS_APP__');
  } catch {
    return true;
  }
};

export async function loadSdkModule<T extends SdkModule>(
  modulePath: string
): Promise<T | null> {
  try {
    const mod = await import(/* @vite-ignore */ modulePath) as T;
    return mod;
  } catch {
    console.warn(`[SDK] Failed to load module: ${modulePath}`);
    return null;
  }
}

export async function callSdkApi<T>(
  modulePath: string,
  apiName: string,
  ...args: unknown[]
): Promise<T | null> {
  if (isWebEnvironment()) {
    console.info(`[SDK Mock] ${apiName} called in web environment`);
    return null;
  }

  const mod = await loadSdkModule(modulePath);
  if (!mod) return null;

  const api = mod[apiName] as { isSupported?: () => boolean } & ((...a: unknown[]) => T);
  if (!api) {
    console.warn(`[SDK] API not found: ${apiName}`);
    return null;
  }

  if (typeof api.isSupported === 'function' && api.isSupported() !== true) {
    console.warn(`[SDK] ${apiName} is not supported`);
    return null;
  }

  return typeof api === 'function' ? api(...args) : null;
}

export { isWebEnvironment };
