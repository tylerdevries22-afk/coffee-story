export type IntentDestination = 'book' | 'visits' | 'rewards' | 'gift';

const INTENT_HOSTS: readonly IntentDestination[] = ['book', 'visits', 'rewards', 'gift'];

/**
 * Maps Siri/App Intents deep links (coffeestory://<host>) to portal destinations.
 * Returns null for any URL that is not an intent link — auth recovery and gift
 * claim URLs are handled by their own listeners.
 */
export function destinationForIntentUrl(url: string | null | undefined): IntentDestination | null {
  if (!url || !url.startsWith('coffeestory://')) return null;
  const withoutScheme = url.slice('coffeestory://'.length);
  const host = withoutScheme.split(/[/?#]/)[0]?.toLowerCase();
  if (!host) return null;
  // Gift claim links belong to the gift-claim flow, which extracts the token and
  // routes separately. Test for a real token parameter rather than the substring
  // "token=", which also matched unrelated params like `?promo_token=…` and left
  // those links dead: refused here AND rejected by giftTokenFromUrl.
  if (host === 'gift' && giftTokenFromUrl(url)) return null;
  return (INTENT_HOSTS as readonly string[]).includes(host) ? (host as IntentDestination) : null;
}

/**
 * Extracts the claim token from a gift-claim deep link
 * (`coffeestory://gift?token=…` or `https://<host>/gift?token=…`).
 * Returns null for every other URL so unrelated links that merely carry a
 * `token` query param (auth callbacks, reward links, …) are never hijacked
 * by the gift-claim flow. Server-issued tokens are at least 32 characters.
 */
export function giftTokenFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const schemeEnd = url.indexOf('://');
  if (schemeEnd <= 0) return null;
  const rest = url.slice(schemeEnd + 3);
  const queryStart = rest.search(/[?#]/);
  const authorityAndPath = queryStart === -1 ? rest : rest.slice(0, queryStart);
  const segments = authorityAndPath.split('/').filter(Boolean);
  const host = segments[0]?.toLowerCase() ?? '';
  const firstPathSegment = segments[1]?.toLowerCase() ?? '';
  if (host !== 'gift' && firstPathSegment !== 'gift') return null;
  // Accept the token from EITHER the query string or the fragment.
  //
  // giftClaimUrl() (lib/mobile/gifts.ts) emits the fragment form --
  // `https://<site>/gift#token=…` -- deliberately: a fragment is never sent to
  // the server, so the claim token stays out of access logs and Referer
  // headers, and the web claim page reads it from window.location.hash.
  // Parsing only the query string meant no claim link the product actually
  // generates could ever open this flow; every emailed gift was unclaimable
  // via deep link and had to be typed in by hand.
  const raw = queryStart === -1 ? '' : rest.slice(queryStart + 1);
  for (const pair of raw.split(/[?#&]/)) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator) !== 'token') continue;
    // Decode before length-checking: the server percent-encodes the token, so a
    // raw-length check could accept an encoded value that decodes to less.
    let value: string;
    try {
      value = decodeURIComponent(pair.slice(separator + 1));
    } catch {
      continue; // malformed percent-encoding
    }
    if (value.length >= 32) return value;
  }
  return null;
}
