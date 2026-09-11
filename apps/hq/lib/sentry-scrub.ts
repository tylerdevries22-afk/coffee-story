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

/**
 * Replaces every sensitive query value in a URL with `REDACTED`.
 *
 * Accepts a bare path-and-query as well as an absolute URL, because
 * `http.target` carries the former. Anything unparseable is returned unchanged.
 */
export function redactUrl(candidate: string): string {
  const relative = candidate.startsWith('/');
  try {
    const url = new URL(candidate, relative ? 'https://redacted.invalid' : undefined);
    let changed = false;
    for (const name of [...url.searchParams.keys()]) {
      if (!SENSITIVE_PARAMS.has(name) && !TOKEN_PATH.test(url.pathname)) continue;
      url.searchParams.set(name, 'REDACTED');
      changed = true;
    }
    if (!changed) return candidate;
    return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch {
    return candidate;
  }
}

type Bag = Record<string, unknown>;

/**
 * Every attribute the HTTP instrumentations put a URL or a query string into.
 * `http.target` is a path-and-query, so it needs the same treatment as a URL.
 */
const URL_KEYS = ['url.full', 'http.url', 'url', 'http.target', 'url.path'] as const;
const QUERY_KEYS = ['url.query', 'http.query'] as const;

/** True when a query string carries a parameter that must never be stored. */
function queryIsSensitive(query: string): boolean {
  return [...new URLSearchParams(query.replace(/^\?/u, '')).keys()]
    .some((name) => SENSITIVE_PARAMS.has(name));
}

/**
 * True when anything in the bag identifies a token exchange.
 *
 * A bag may carry a query with no URL beside it, so the query keys are inspected
 * on their own rather than only as a consequence of the URL.
 */
function bagIsSensitive(bag: Bag): boolean {
  const urlHit = URL_KEYS.some((key) => {
    const value = bag[key];
    return typeof value === 'string' && isTokenExchangeUrl(value);
  });
  if (urlHit) return true;
  return QUERY_KEYS.some((key) => {
    const value = bag[key];
    return typeof value === 'string' && queryIsSensitive(value);
  });
}

/**
 * Redacts one attribute bag in place.
 *
 * A query string is only blanked when the bag's own URL is a token exchange.
 * Blanking every `*query` key unconditionally would strip query telemetry from
 * every unrelated outgoing request in the deployment.
 */
function redactBag(bag: Bag | undefined): void {
  if (!bag) return;
  const sensitive = bagIsSensitive(bag);
  for (const key of URL_KEYS) {
    const value = bag[key];
    if (typeof value === 'string') bag[key] = redactUrl(value);
  }
  if (!sensitive) return;
  for (const key of QUERY_KEYS) {
    if (typeof bag[key] === 'string') bag[key] = 'REDACTED';
  }
}

/** Strips token-exchange query strings from a breadcrumb before it is stored. */
export function scrubBreadcrumb<T>(breadcrumb: T): T {
  redactBag((breadcrumb as T & { data?: Bag | undefined }).data);
  return breadcrumb;
}

type Scrubbable = {
  request?: { url?: string; query_string?: unknown } | undefined;
  breadcrumbs?: readonly { data?: Bag | undefined }[] | undefined;
  spans?: readonly { data?: Bag | undefined }[] | undefined;
  contexts?: Record<string, Bag | undefined> | undefined;
};

/**
 * Strips token-exchange query strings from an event, every span on it, and every
 * context bag.
 *
 * `contexts.trace.data` carries the root span's attributes, which for the OAuth
 * callback route itself means `url.full`, `http.url` and `http.target` all hold
 * the single-use authorization code, and `request.query_string` holds it again.
 * Walking only `request.url` and `spans` misses both.
 */
export function scrubEvent<T>(event: T): T {
  const target = event as T & Scrubbable;
  if (target.request) {
    if (typeof target.request.url === 'string') {
      target.request.url = redactUrl(target.request.url);
    }
    // Sentry's requestdata integration copies the raw query string onto the
    // event separately from the URL, so redacting only `url` leaves the callback
    // route's single-use authorization code in `query_string`.
    if (typeof target.request.query_string === 'string'
      && queryIsSensitive(target.request.query_string)) {
      target.request.query_string = 'REDACTED';
    }
  }
  for (const breadcrumb of target.breadcrumbs ?? []) redactBag(breadcrumb.data);
  for (const span of target.spans ?? []) redactBag(span.data);
  for (const context of Object.values(target.contexts ?? {})) {
    if (!context) continue;
    redactBag(context);
    const nested = context.data;
    if (nested && typeof nested === 'object') redactBag(nested as Bag);
  }
  return event;
}
