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
  // Keep a running preview isolated from another HQ process or a production
  // build. Shared output can serve stale routes or missing chunks.
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  // Workspace packages ship TypeScript source; Next compiles them in place.
  transpilePackages: ['@platform/schema', '@platform/domain', '@platform/engine', '@platform/api-client'],
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
  experimental: {
    // HQ accepts 8 MB menu source documents and 6 MB managed images. The extra
    // MB covers action framing; each boundary still enforces its tighter limit.
    serverActions: { bodySizeLimit: '9mb' },
  },
  // `pnpm lint` is the authoritative zero-warning gate and runs before build.
  eslint: { ignoreDuringBuilds: true },
  headers: async () => [
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
      headers: securityHeaders({
        developmentFrames: process.env.NODE_ENV !== 'production',
        frameAncestors: ["'self'"],
      }),
    },
    {
      source: '/((?!api/|wall/preview/|$).*)',
      headers: securityHeaders({ developmentFrames: process.env.NODE_ENV !== 'production' }),
    },
  ],
};

export default withSentryConfig(withWorkflow(config), {
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
