import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { securityHeaders } from '@platform/web-config';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_HQ_ORIGIN = 'https://coffee-story-hq.vercel.app';

function hqOrigin(): string {
  const configured = process.env.HQ_ORIGIN?.trim();
  if (!configured) return DEFAULT_HQ_ORIGIN;
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' ? url.origin : DEFAULT_HQ_ORIGIN;
  } catch {
    return DEFAULT_HQ_ORIGIN;
  }
}

function displayContentSecurityPolicy(): string {
  const development = process.env.NODE_ENV !== 'production';
  const ancestors = development
    ? "'self' http://localhost:4170 http://127.0.0.1:4170 http://localhost:3300 http://127.0.0.1:3300 http://localhost:3400 http://127.0.0.1:3400"
    : `'self' ${hqOrigin()}`;
  // Next's dev runtime evaluates its own chunks with `eval`, so the shipped
  // policy killed `main-app.js` before React could hydrate: the board rendered
  // once on the server and then never polled again. On a wall that looks like
  // a screen quietly refusing to follow the kitchen, and it is exactly how the
  // operator's taps appeared to go nowhere. A production build needs no `eval`,
  // so the relaxation lives on the dev branch and the shipped policy is
  // unchanged.
  const scripts = development
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scripts}`,
    "connect-src 'self'",
    `frame-ancestors ${ancestors}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * The storefront display.
 *
 * Its own app rather than a route on the console: this runs on a TV bolted to
 * a wall in the shop, on a different network, restarting on a different
 * schedule, and read by guests rather than staff. Deploying it should never
 * mean deploying the back office, and an outage in one should not be an outage
 * in the other.
 *
 * `vercel.json` beside this file carries the headers that follow from what
 * this surface is: a board full of guest names must never be indexed, and a
 * page nobody can interact with has no business loading a third-party script
 * or being framed. The CSP is the narrowest one the app can actually run
 * under -- everything it draws is same-origin, and the QR is an inline path
 * rather than a fetched image.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot,
  // The wall display is often previewed while a production build runs.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  // The lint gate is `pnpm lint` (eslint.config.mjs), which runs before
  // typecheck, tests and this build in `pnpm verify`. Next's own build-time
  // pass looks for its plugin, does not find it, and prints a warning about a
  // config it is not the authority on -- so it is turned off rather than left
  // to imply the real gate is missing.
  eslint: { ignoreDuringBuilds: true },
  headers: async () => [{
    source: '/(.*)',
    headers: securityHeaders({
      developmentFrames: process.env.NODE_ENV !== 'production',
      noIndex: true,
      // The board is the one display surface intentionally embedded by HQ.
      // Keep the production parent allowlist to one trusted console origin.
      contentSecurityPolicy: displayContentSecurityPolicy(),
    }),
  }],
};

export default withSentryConfig(nextConfig, {
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_DISPLAY_PROJECT ?? process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
