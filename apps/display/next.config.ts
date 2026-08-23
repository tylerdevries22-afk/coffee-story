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
};

export default nextConfig;
