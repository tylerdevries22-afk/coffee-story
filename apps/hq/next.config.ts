import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { securityHeaders } from '@platform/web-config';

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
  // Workspace packages ship TypeScript source; Next compiles them in place.
  transpilePackages: ['@platform/schema', '@platform/domain', '@platform/engine', '@platform/api-client'],
  // `pnpm lint` is the authoritative zero-warning gate and runs before build.
  eslint: { ignoreDuringBuilds: true },
  headers: async () => [
    {
      source: '/((?!api/).*)',
      headers: securityHeaders({ developmentFrames: process.env.NODE_ENV !== 'production' }),
    },
  ],
};

export default withSentryConfig(config, {
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
