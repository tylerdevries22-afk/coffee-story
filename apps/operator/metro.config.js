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
const path = require('path');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../..')];

// Each app gets its own cache. The default store lives at the workspace
// root, and the two Expo apps poison each other's expo-router context there:
// an operator export served the customer's route tree out of the shared
// cache and failed on the customer-only @/lib/brand-cache import.
config.cacheStores = [
  new FileStore({ root: path.join(__dirname, '.metro-cache') }),
];

module.exports = config;
