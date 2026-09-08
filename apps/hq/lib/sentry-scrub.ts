/**
 * Redaction for OAuth token exchanges.
 *
 * Some providers only document a GET token endpoint — Meta's
 * `graph.facebook.com/v25.0/oauth/access_token` is one — so the client secret and
 * the single-use authorization code necessarily travel in the query string.
 * Sentry's default undici instrumentation copies the full URL onto every client
 * span (`url.full`, `url.query`) and into an `http.query` breadcrumb, which would
 * put a platform-wide provider secret into searchable event data.
 *
 * These helpers strip the query from any URL that looks like a token exchange,
 * wherever it appears in an event. They are pure and exported so they can be
 * tested without initializing Sentry.
 */

const SENSITIVE_PARAMS = new Set([
  'client_secret', 'code', 'code_verifier', 'refresh_token', 'access_token',
  'client_assertion', 'assertion', 'password',
]);

const TOKEN_PATH = /\/(?:oauth|token|access_token)(?:[/?]|$)/iu;

/** True when a URL is an OAuth token exchange whose query must never be stored. */
export function isTokenExchangeUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (TOKEN_PATH.test(url.pathname)) return true;
    return [...url.searchParams.keys()].some((name) => SENSITIVE_PARAMS.has(name));
  } catch {
    return false;
  }
}

/** Replaces every sensitive query value in a URL with `REDACTED`. */
export function redactUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    let changed = false;
    for (const name of [...url.searchParams.keys()]) {
      if (!SENSITIVE_PARAMS.has(name) && !TOKEN_PATH.test(url.pathname)) continue;
      url.searchParams.set(name, 'REDACTED');
      changed = true;
    }
    return changed ? url.toString() : candidate;
  } catch {
    return candidate;
  }
}

type Bag = Record<string, unknown>;

function redactBag(bag: Bag | undefined): void {
  if (!bag) return;
  for (const key of ['url.full', 'url.query', 'http.url', 'http.query', 'url']) {
    const value = bag[key];
    if (typeof value !== 'string') continue;
    bag[key] = key.endsWith('query') ? 'REDACTED' : redactUrl(value);
  }
}

/** Strips token-exchange query strings from a breadcrumb before it is stored. */
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  redactBag((breadcrumb as T & { data?: Bag | undefined }).data);
  return breadcrumb;
}

type Scrubbable = {
  request?: { url?: string } | undefined;
  breadcrumbs?: readonly { data?: Bag | undefined }[] | undefined;
  spans?: readonly { data?: Bag | undefined }[] | undefined;
};

/** Strips token-exchange query strings from an event and every span on it. */
export function scrubEvent<T>(event: T): T {
  const target = event as T & Scrubbable;
  if (target.request && typeof target.request.url === 'string') {
    target.request.url = redactUrl(target.request.url);
  }
  for (const breadcrumb of target.breadcrumbs ?? []) redactBag(breadcrumb.data);
  for (const span of target.spans ?? []) redactBag(span.data);
  return event;
}
