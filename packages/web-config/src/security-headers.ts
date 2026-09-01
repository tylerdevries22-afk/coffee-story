export type WebHeader = { key: string; value: string };

/** Shared browser hardening for surfaces that render tenant or guest data. */
export function securityHeaders(options: {
  developmentFrames: boolean;
  noIndex?: boolean;
  /** Explicit trusted parents for a surface that must be embedded. */
  frameAncestors?: readonly string[];
  /** Full CSP for surfaces with a non-default resource policy. */
  contentSecurityPolicy?: string;
}): WebHeader[] {
  const trustedParents = options.frameAncestors
    ?.map((origin) => origin.trim())
    .filter((origin) => origin === "'self'" || /^[a-z][a-z\d+.-]*:\/\/[^\s;]+$/i.test(origin));
  const framing = trustedParents?.length
    ? [{ key: 'Content-Security-Policy', value: `frame-ancestors ${trustedParents.join(' ')}` }]
    : options.developmentFrames
    ? [{
      key: 'Content-Security-Policy',
      // Keep the dev wall's parent explicit. A wildcard port is valid CSP but
      // is rejected by a few embedded WebViews, which makes the wall report
      // healthy surfaces as "refused to connect". The two local HQ ports
      // support the regular development server and the isolated preview wall.
      value: "frame-ancestors 'self' http://localhost:4170 http://127.0.0.1:4170 http://localhost:3300 http://127.0.0.1:3300 http://localhost:3400 http://127.0.0.1:3400",
    }]
    : [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    ];
  const policy = options.contentSecurityPolicy
    ? [{ key: 'Content-Security-Policy', value: options.contentSecurityPolicy }]
    : framing;
  return [
    ...policy,
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ...(options.noIndex ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : []),
  ];
}
