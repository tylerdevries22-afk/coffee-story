import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { securityHeaders } from '@platform/web-config';
import { withWorkflow } from 'workflow/next';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
const config: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  productionBrowserSourceMaps: process.env.BROWSER_COVERAGE === '1',
  // Keep a running preview isolated from another HQ process or a production
  // build. Shared output can serve stale routes or missing chunks.
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  // Workspace packages ship TypeScript source; Next compiles them in place.
  transpilePackages: [
    '@platform/schema', '@platform/domain', '@platform/engine', '@platform/api-client',
    'franchise-mcp-store-ui',
  ],
  // The workflow runtime loads its queue adapter by provider name. Keeping
  // that server-only graph external avoids webpack's dynamic-require warning
  // and lets Vercel provide the adapter at runtime without bundling it into
  // every API route.
  serverExternalPackages: [
    'workflow',
    '@workflow/core',
    '@workflow/world-vercel',
    '@vercel/queue',
    'libsodium-wrappers',
  ],
  // Model B: co-located Expo static surfaces under path prefixes.
  async rewrites() {
    return [
      { source: '/customer', destination: '/customer/index.html' },
      { source: '/customer/:path*', destination: '/customer/index.html' },
      { source: '/kiosk', destination: '/kiosk/index.html' },
      { source: '/kiosk/:path*', destination: '/kiosk/index.html' },
      { source: '/operator', destination: '/operator/index.html' },
      { source: '/operator/:path*', destination: '/operator/index.html' },
      // A prospect's own working app, built once and served from this same
      // origin at request time via /d/pack.json (see apps/customer/index.js,
      // apps/kiosk/index.js). No /demo/operator: a prospect never gets staff
      // tooling.
      { source: '/demo/customer', destination: '/demo/customer/index.html' },
      { source: '/demo/customer/:path*', destination: '/demo/customer/index.html' },
      { source: '/demo/kiosk', destination: '/demo/kiosk/index.html' },
      { source: '/demo/kiosk/:path*', destination: '/demo/kiosk/index.html' },
      // Per-tenant copies the staff wall frames. Same origin on purpose: every
      // hosted surface answers frame-ancestors 'self', so a wall pointed at
      // another org's deployment is refused by the browser and paints blank.
      { source: '/t/:slug/:surface(customer|kiosk|operator)', destination: '/t/:slug/:surface/index.html' },
      { source: '/t/:slug/:surface(customer|kiosk|operator)/:path*', destination: '/t/:slug/:surface/index.html' },
    ];
  },
  experimental: {
    // HQ accepts 8 MB menu source documents and 6 MB managed images. The extra
    // MB covers action framing; each boundary still enforces its tighter limit.
    serverActions: { bodySizeLimit: '9mb' },
  },
  // `pnpm lint` is the authoritative zero-warning gate and runs before build.
  eslint: { ignoreDuringBuilds: true },
  headers: async () => {
    // Model B guest/device shells must render inside the HQ /apps wall (and the
    // local preview wall). Console pages stay non-frameable in production.
    const wallParents = [
      "'self'",
      'http://localhost:4170', 'http://127.0.0.1:4170',
      'http://localhost:3300', 'http://127.0.0.1:3300',
      'http://localhost:3310', 'http://127.0.0.1:3310',
      'http://localhost:3400', 'http://127.0.0.1:3400',
    ] as const;
    const modelBParents = process.env.NODE_ENV === 'production'
      ? (["'self'"] as const)
      : wallParents;
    const modelBHeaders = securityHeaders({
      developmentFrames: false,
      frameAncestors: modelBParents,
      noIndex: true,
    });
    // A prospect's demo: never indexed or cached, never framed, and never
    // sending a Referer -- the first request carries the link token in its
    // path, and an outbound click must not hand it to the site it lands on.
    const demoHeaders = [
      ...securityHeaders({ developmentFrames: false, noIndex: true })
        .filter((header) => header.key !== 'Referrer-Policy' && header.key !== 'X-Robots-Tag'),
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      { key: 'Cache-Control', value: 'private, no-store' },
    ];
    return [
      {
        // The tenant-safe preview is deliberately same-origin so its iframe can
        // carry the signed-in HQ session for every location.
        source: '/wall/preview/:path*',
        headers: securityHeaders({
          developmentFrames: process.env.NODE_ENV !== 'production',
          frameAncestors: ["'self'"],
        }),
      },
      {
        // The dashboard is a first-party device on the apps wall. It remains
        // unavailable to every other origin, but can render inside that wall.
        source: '/',
        headers: process.env.NODE_ENV === 'production'
          ? securityHeaders({ developmentFrames: false, frameAncestors: ["'self'"] })
          : securityHeaders({ developmentFrames: true }),
      },
      { source: '/customer', headers: modelBHeaders },
      { source: '/customer/:path*', headers: modelBHeaders },
      { source: '/kiosk', headers: modelBHeaders },
      { source: '/kiosk/:path*', headers: modelBHeaders },
      { source: '/operator', headers: modelBHeaders },
      { source: '/operator/:path*', headers: modelBHeaders },
      { source: '/t/:slug/:path*', headers: modelBHeaders },
      { source: '/lobby/:path*', headers: modelBHeaders },
      { source: '/d/:path*', headers: demoHeaders },
      // The exported app itself gets the same treatment as the HQ-rendered
      // demo pages: it is the same prospect's demo, just the working-app half
      // of it rather than the landing-page half.
      { source: '/demo/:path*', headers: demoHeaders },
      {
        // Exclude Model B prefixes so they do not inherit production frame-ancestors 'none'.
        source: '/((?!api/|wall/preview/|t/|d/|demo(?:/|$)|lobby(?:/|$)|customer(?:/|$)|kiosk(?:/|$)|operator(?:/|$)|$).*)',
        headers: securityHeaders({ developmentFrames: process.env.NODE_ENV !== 'production' }),
      },
    ];
  },
};

export default withSentryConfig(withWorkflow(config), {
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
