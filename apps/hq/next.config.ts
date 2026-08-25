import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

/**
 * The console handles a brand's menu, its customers and the platform's own
 * fee reporting, and it shipped with no security headers at all — a browser
 * was free to frame it, downgrade it, or leak its URLs to a third party in
 * the Referer.
 *
 * The API routes are exempt from the framing and CSP rules: they answer JSON
 * to the two Expo apps cross-origin (CORS_HEADERS in lib/api-auth.ts), and a
 * page policy has nothing to say about a JSON response.
 */
// In development the preview wall (tools/preview-wall) frames all five
// surfaces side by side, so localhost is allowed to embed the console there.
// X-Frame-Options has no origin-list form, so it is omitted rather than
// contradicted when the CSP is relaxed. A deployed console still refuses
// outright: clickjacking has an obvious target here, and dev is not where
// that attack lands.
const FRAMING_HEADERS =
  process.env.NODE_ENV === 'production'
    ? [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      ]
    : [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' http://localhost:*" }];

const SECURITY_HEADERS = [
  // No one frames the console. clickjacking has an obvious target here:
  // "86 this item", "pause ordering", "refund".
  ...FRAMING_HEADERS,
  // A year of HTTPS-only, which Vercel serves anyway; this stops the first
  // request of a session from being the plaintext one.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Console URLs carry brand and location ids; they do not travel off-origin.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Nothing here needs a camera, a microphone or a location.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them in place.
  transpilePackages: ['@platform/schema', '@platform/domain', '@platform/engine', '@platform/api-client'],
  headers: async () => [
    {
      source: '/((?!api/).*)',
      headers: SECURITY_HEADERS,
    },
  ],
};

export default withWorkflow(config);
