// Workspace-aware Metro: the app lives in apps/<name> of a pnpm monorepo
// (hoisted node-linker, so node_modules is flat at the workspace root).
//
// EXPO_NO_METRO_WORKSPACE_ROOT: with workspace-root detection on, the web
// static-render pass resolves expo-router/node/render.js with the workspace
// root as its origin, which escapes Metro's file map and dies with
// "Invariant Violation: Unexpectedly escaped traversal". Hoisted resolution
// works fine from the project root, so detection is off; watchFolders still
// lets Metro see the workspace packages. Must be set before getDefaultConfig
// runs -- that is where the server root is computed.
process.env.EXPO_NO_METRO_WORKSPACE_ROOT = '1';

const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');
const { createHash } = require('node:crypto');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../..')];

// Each app gets its own cache. The default store lives at the workspace
// root, and the two Expo apps poison each other's expo-router context there:
// an operator export served the customer's route tree out of the shared
// cache and failed on the customer-only @/lib/brand-cache import.
//
// Keyed by tenant and public runtime target, as apps/customer is and for the
// same reason: app.config.ts reaches the bundle through expo-constants as a
// GENERATED module, which Metro does not watch, so its transform survives a
// tenant switch. This app had one unkeyed root, so building tenant b straight
// after tenant a could serve a's identity inside b's binary -- correctly
// signed, correctly named, wrong shop, and silent. Every value here is public
// by design; a slug is not a secret.
const runtimeTarget = createHash('sha256')
  .update([
    process.env.EXPO_PUBLIC_TENANT,
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.EXPO_PUBLIC_API_URL,
    process.env.EXPO_PUBLIC_ALLOWED_API_HOST,
  ].join('\0'))
  .digest('hex')
  .slice(0, 12);
config.cacheStores = [
  new FileStore({
    root: path.join(__dirname, '.metro-cache', process.env.EXPO_PUBLIC_TENANT || 'default', runtimeTarget),
  }),
];

module.exports = config;
