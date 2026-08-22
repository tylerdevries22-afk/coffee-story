/**
 * Resolves a path against the brand's public website — the only web surface
 * the app links out to since the legacy portal host was retired. Fail-closed
 * like the API client: internal paths only, never `//` or `\` (WHATWG URL
 * treats `\` as `/` for special schemes), HTTPS only.
 *
 * Pure — no react-native, no tenant import — so `node:test` reaches it; the
 * `web-navigation` wrapper supplies the tenant's website and Linking.
 */
export function resolveWebsiteUrl(path: string, websiteBase: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('The requested page is invalid.');
  }
  const base = new URL(websiteBase);
  if (base.protocol !== 'https:') throw new Error('The website must use HTTPS.');
  return new URL(path, `${base.toString().replace(/\/$/, '')}/`).toString();
}
