/**
 * Whether a cookie-authenticated request came from this deployment's own pages.
 *
 * A route that trusts the console's session cookie will be sent that cookie
 * by any page that can make the browser post to it, so being signed in is not
 * enough on its own: the request also has to come from here. Two signals, and
 * both must agree:
 *
 * - `Origin` must be exactly this origin. Browsers attach it to every POST,
 *   same-origin included, and a page cannot set it.
 * - `Sec-Fetch-Site`, when sent, must say `same-origin`. `same-site` is a
 *   sibling subdomain, which is still somebody else's page.
 *
 * A request with no `Origin` is refused: it is not a browser posting from the
 * console, which is the only caller these routes serve.
 */
export function sameOriginRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
