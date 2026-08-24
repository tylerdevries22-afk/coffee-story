import type { NextConfig } from 'next';

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
  // The lint gate is `pnpm lint` (eslint.config.mjs), which runs before
  // typecheck, tests and this build in `pnpm verify`. Next's own build-time
  // pass looks for its plugin, does not find it, and prints a warning about a
  // config it is not the authority on -- so it is turned off rather than left
  // to imply the real gate is missing.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
