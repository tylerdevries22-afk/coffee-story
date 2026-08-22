/**
 * Where Square may send a guest after a hosted checkout.
 *
 * Square appends the transaction, order and reference ids to whatever URL it
 * is given, and the page carrying it wears the brand's name. The order route
 * used to pass the client's `redirectUrl` through with no check at all — not
 * even that it was a string — so any caller could have a Square-hosted,
 * brand-named checkout hand those ids to a host of their choosing.
 *
 * The rule is therefore the narrowest one that still works: it must be this
 * tenant's own deep link, and nothing else. Fail closed — a brand whose
 * config names no scheme accepts no redirect at all, rather than falling back
 * to "anything that parses".
 */

/** The tenant's deep-link scheme (no colon), or null when it declares none. */
export function tenantSchemeOf(brandConfig: unknown): string | null {
  const identity = (brandConfig as { identity?: { scheme?: unknown } } | null)?.identity;
  const scheme = identity?.scheme;
  if (typeof scheme !== 'string') return null;
  // A scheme is a name, not a URL fragment: reject anything that could smuggle
  // structure into the comparison below.
  return /^[a-z][a-z0-9+.-]*$/i.test(scheme) ? scheme.toLowerCase() : null;
}

export function isTenantRedirect(value: unknown, scheme: string | null): boolean {
  if (!scheme || typeof value !== 'string' || value.length === 0 || value.length > 500) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === `${scheme}:`;
}
