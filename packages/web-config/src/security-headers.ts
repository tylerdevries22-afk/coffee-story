export type WebHeader = { key: string; value: string };

/** Shared browser hardening for surfaces that render tenant or guest data. */
export function securityHeaders(options: { developmentFrames: boolean; noIndex?: boolean }): WebHeader[] {
  const framing = options.developmentFrames
    ? [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' http://localhost:*" }]
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
