// Workspace-aware Metro: the app lives in apps/customer of a pnpm monorepo
// (hoisted node-linker, so node_modules is flat at the workspace root).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../..')];
module.exports = config;
