const RECOVERY_SCHEME = 'coffeestory:';
const RECOVERY_HOST = 'reset-password';
const EXPO_SCHEME = 'exp:';
const EXPO_RECOVERY_PATH = '/--/reset-password';

export function recoveryRedirectUrl(createUrl: (path: string) => string): string {
  const redirectUrl = createUrl(RECOVERY_HOST);
  const parsed = new URL(redirectUrl);
  const isNativeBuild = parsed.protocol === RECOVERY_SCHEME && parsed.hostname === RECOVERY_HOST;
  const isExpoGo = parsed.protocol === EXPO_SCHEME && parsed.pathname.replace(/\/$/, '') === EXPO_RECOVERY_PATH;
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
      && url.pathname.replace(/\/$/, '') === EXPO_RECOVERY_PATH;
    if (!isNativeBuild && !isExpoGo) {
      return null;
    }
    const code = url.searchParams.get('code')?.trim();
    return code && code.length >= 16 && code.length <= 2048 ? code : null;
  } catch {
    return null;
  }
}
