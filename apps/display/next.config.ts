import type { NextConfig } from 'next';

/**
 * The storefront display.
 *
 * Its own app rather than a route on the console: this runs on a TV bolted to
 * a wall in the shop, on a different network, restarting on a different
 * schedule, and read by guests rather than staff. Deploying it should never
 * mean deploying the back office, and an outage in one should not be an outage
 * in the other.
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
