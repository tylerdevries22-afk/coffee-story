/**
 * Is this URL one the operating system routed to *this* app?
 *
 * Every deep-link check in both Expo apps used to pin the literal
 * `coffeestory://`, which is wrong twice over. The guest binary registers
 * whatever `tenants/<slug>/brand.json` names (rule 7: one binary per brand),
 * so the second tenant's app rejects its own links. And the staff binary
 * registers `coffee-operator`, so it already does: Siri/App-Intent links are
 * dead there, and `recoveryRedirectUrl` throws outright, which takes password
 * recovery in a staff store build with it.
 *
 * The literal was never load-bearing. iOS and Android hand a custom-scheme URL
 * only to the app that registered that scheme, so a private scheme arriving
 * here is ours by construction. What must stay shut is everything that is not
 * private: the web origins anyone can serve, and the scriptable or local ones.
 * `exp:` is excluded too — Expo Go is shared by every project on the machine,
 * so an `exp://` link proves nothing about who sent it and the callers that
 * accept one check its host separately.
 */
const FOREIGN_SCHEMES: ReadonlySet<string> = new Set([
  'http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:', 'blob:', 'data:',
  'javascript:', 'about:', 'content:', 'intent:', 'mailto:', 'tel:', 'sms:',
  'exp:',
]);

/** RFC 3986 scheme syntax, with the `://` that separates it from an authority. */
const SCHEME_PREFIX = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\//;

/**
 * True for a `protocol` value (as `URL.protocol` gives it: lower case, with the
 * trailing colon) that can only be this app's own registered scheme.
 */
export function isOwnAppScheme(protocol: string): boolean {
  return /^[a-z][a-z0-9+.\-]*:$/.test(protocol) && !FOREIGN_SCHEMES.has(protocol);
}

/**
 * The scheme of a raw URL string, lower-cased and colon-terminated, or null if
 * it does not start with `<scheme>://`. Deliberately string-level: it runs on
 * paths Expo Router hands us that `new URL` would reject.
 */
export function schemeOf(url: string): string | null {
  const scheme = SCHEME_PREFIX.exec(url)?.[1];
  return scheme === undefined ? null : `${scheme.toLowerCase()}:`;
}

/** True when `url` arrived over this app's own custom scheme. */
export function isOwnAppUrl(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme !== null && isOwnAppScheme(scheme);
}
