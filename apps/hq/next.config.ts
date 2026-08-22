import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them in place.
  transpilePackages: ['@platform/schema', '@platform/engine', '@platform/api-client'],
};

export default config;
