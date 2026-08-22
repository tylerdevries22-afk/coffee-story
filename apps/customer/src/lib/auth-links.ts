const RECOVERY_SCHEME = 'coffeestory:';
const RECOVERY_HOST = 'reset-password';
const EXPO_SCHEME = 'exp:';
const EXPO_RECOVERY_PATH = '/--/reset-password';

/**
 * Which `exp://` hosts may carry a recovery code.
 *
 * A store build only ever accepts `coffeestory://reset-password`, which is
 * ours by definition. Expo Go has no custom scheme, so the link points at
 * whatever machine is serving the bundle — and the check used to be the
 * scheme and the path alone. `exp://anywhere.example.com/--/reset-password
 * ?code=...` was therefore accepted, which is enough for a crafted link to
 * hand the app someone else's recovery code and fix it onto their session.
 *
 * A real Expo Go link comes from a dev server on this machine, on the local
 * network, or through an Expo tunnel. Nothing else.
 */
function isExpoDevHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  if (host.endsWith('.exp.direct') || host === 'exp.direct') return true;
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  return false;
}

export function recoveryRedirectUrl(createUrl: (path: string) => string): string {
  const redirectUrl = createUrl(RECOVERY_HOST);
  const parsed = new URL(redirectUrl);
  const isNativeBuild = parsed.protocol === RECOVERY_SCHEME && parsed.hostname === RECOVERY_HOST;
  const isExpoGo = parsed.protocol === EXPO_SCHEME
    && parsed.pathname.replace(/\/$/, '') === EXPO_RECOVERY_PATH
    && isExpoDevHost(parsed.hostname);
  if (!isNativeBuild && !isExpoGo) {
    throw new Error('The password-recovery callback is not configured for this app.');
  }
  return redirectUrl;
}

export function recoveryCodeFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const isNativeBuild = url.protocol === RECOVERY_SCHEME
      && url.hostname === RECOVERY_HOST
      && (url.pathname === '' || url.pathname === '/');
    const isExpoGo = url.protocol === EXPO_SCHEME
      && url.pathname.replace(/\/$/, '') === EXPO_RECOVERY_PATH
      && isExpoDevHost(url.hostname);
    if (!isNativeBuild && !isExpoGo) {
      return null;
    }
    const code = url.searchParams.get('code')?.trim();
    return code && code.length >= 16 && code.length <= 2048 ? code : null;
  } catch {
    return null;
  }
}
