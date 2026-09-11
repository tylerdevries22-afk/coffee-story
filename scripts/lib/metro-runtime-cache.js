const { createHash } = require('node:crypto');

/** Public build inputs are inlined into transforms, so each needs an isolated cache. */
function runtimeCacheKey(environment) {
  const entries = Object.keys(environment)
    .filter((key) => key.startsWith('EXPO_PUBLIC_') && environment[key] !== undefined)
    .sort()
    .map((key) => [key, environment[key]]);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 24);
}

module.exports = { runtimeCacheKey };
