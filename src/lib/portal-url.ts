export const PRODUCTION_PORTAL_URL = 'https://coffee-story-healing-oasis.vercel.app';
export const PRODUCTION_PORTAL_HOST = 'coffee-story-healing-oasis.vercel.app';

export function resolvePortalUrl(
  path: string,
  configuredBase = process.env.EXPO_PUBLIC_API_URL ?? PRODUCTION_PORTAL_URL,
  allowedHost = process.env.EXPO_PUBLIC_ALLOWED_API_HOST ?? PRODUCTION_PORTAL_HOST,
  developmentMode = process.env.NODE_ENV !== 'production',
): string {
  const base = configuredBase?.replace(/\/$/, '');
  if (!base) throw new Error('Connect the web portal URL before opening this page.');
  // Reject a backslash anywhere as well as a protocol-relative `//`. WHATWG URL
  // treats `\` as `/` for special schemes, so `/\evil.com/x` resolves against
  // this base to `https://evil.com/x` -- escaping both the HTTPS check and the
  // host allowlist below, and handing an attacker-controlled URL to
  // Linking.openURL. Verified: new URL('/\\evil.com/x', PRODUCTION_PORTAL_URL)
  // === 'https://evil.com/x'. This function is the whole trust boundary for
  // outbound portal navigation, so it must reject rather than normalize.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('The requested portal path is invalid.');
  }
  const baseUrl = new URL(base);
  const isLocalDevelopment = baseUrl.hostname === 'localhost' || baseUrl.hostname === '127.0.0.1';
  if (baseUrl.protocol !== 'https:' && !(developmentMode && isLocalDevelopment)) {
    throw new Error('The configured portal must use HTTPS.');
  }
  if (!(developmentMode && isLocalDevelopment) && (!allowedHost || baseUrl.hostname !== allowedHost.toLowerCase())) {
    throw new Error('The configured portal host is not allowlisted.');
  }
  return new URL(path, `${baseUrl.toString().replace(/\/$/, '')}/`).toString();
}
