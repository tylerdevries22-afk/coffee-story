export type WebHeader = { key: string; value: string };

/** Shared browser hardening for surfaces that render tenant or guest data. */
export function securityHeaders(options: { developmentFrames: boolean; noIndex?: boolean }): WebHeader[] {
  const framing = options.developmentFrames
    ? [{
      key: 'Content-Security-Policy',
      // Keep the dev wall's parent explicit. A wildcard port is valid CSP but
      // is rejected by a few embedded WebViews, which makes the wall report
      // healthy surfaces as "refused to connect".
      value: "frame-ancestors 'self' http://localhost:4170 http://127.0.0.1:4170",
    }]
    : [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    ];
  return [
    ...framing,
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ...(options.noIndex ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : []),
  ];
}
