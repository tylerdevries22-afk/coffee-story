const { existsSync, readFileSync } = require('node:fs');
const { basename, join, resolve, sep } = require('node:path');

const PREFIX = '@tenant-bundle/';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONFIG_TARGETS = new Map([
  ['config/brand', 'brand.json'],
  ['config/menu', 'menu.json'],
  ['config/modules', 'modules.json'],
]);
const GENERATED_TARGETS = new Map([
  ['generated/menu-media', 'menu-media.generated.ts'],
  ['generated/product-media', 'product-media.generated.ts'],
]);

// The one applied tenant whose real assets stand in for a business a demo
// pack does not brand -- every artwork key except the logo, which
// src/demo-runtime/artwork/brand/logo.ts substitutes with the pack's own at
// request time. Chosen because it is already a committed, always-applied
// reference tenant with a complete asset set (see apps/*/assets/tenants/
// juniper-base-demo/); if it is ever removed, this constant must move with it.
const DEMO_NEUTRAL_TENANT = 'juniper-base-demo';

function demoRuntimeEnabled() {
  return process.env.EXPO_PUBLIC_DEMO_RUNTIME === '1';
}

function appliedTenants(appRoot) {
  const file = join(appRoot, 'src', 'tenants', 'applied.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed.slugs) || parsed.slugs.some((slug) => !SLUG.test(slug))) {
    throw new Error(`${file} must contain only valid tenant slugs.`);
  }
  return parsed.slugs;
}

function selectedTenant(appRoot, requested = process.env.EXPO_PUBLIC_TENANT) {
  const app = basename(appRoot);
  const slug = requested?.trim() ?? '';
  const applied = appliedTenants(appRoot);
  if (!slug) {
    throw new Error(`apps/${app} requires EXPO_PUBLIC_TENANT to build a tenant-isolated bundle.`);
  }
  if (!SLUG.test(slug) || !applied.includes(slug)) {
    throw new Error(
      `EXPO_PUBLIC_TENANT="${slug}" is not applied to apps/${app}. Applied: ${applied.join(', ')}.`,
    );
  }
  return slug;
}

function inside(base, relative) {
  const target = resolve(base, relative);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`Tenant bundle import escapes its selected asset root: ${relative}`);
  }
  return target;
}

/**
 * Where a demo runtime export's @tenant-bundle import resolves. There is no
 * selected tenant here at all -- EXPO_PUBLIC_TENANT and applied.json are
 * beside the point, because one export serves every business, chosen at
 * request time by /d/pack.json rather than at build time by env var. Every
 * config/generated request maps to a small module under src/demo-runtime/
 * that reads the pack the boot module already fetched (see index.js); every
 * artwork request but the logo maps to the neutral tenant's real asset file.
 */
function demoRuntimeBundlePath(appRoot, request) {
  if (request === 'artwork/brand/logo.png') {
    return join(appRoot, 'src', 'demo-runtime', 'artwork', 'brand', 'logo.ts');
  }
  if (request.startsWith('artwork/')) {
    return inside(join(appRoot, 'assets', 'tenants', DEMO_NEUTRAL_TENANT), request.slice('artwork/'.length));
  }
  return join(appRoot, 'src', 'demo-runtime', `${request}.ts`);
}

function tenantSlotBundlePath(appRoot, request, requested) {
  const tenant = selectedTenant(appRoot, requested);
  const slotRoot = join(appRoot, 'src', 'tenants', tenant);
  const config = CONFIG_TARGETS.get(request);
  const generated = GENERATED_TARGETS.get(request);
  if (config) return join(slotRoot, config);
  if (generated) return join(slotRoot, generated);
  return request.startsWith('artwork/')
    ? inside(join(appRoot, 'assets', 'tenants', tenant), request.slice('artwork/'.length))
    : null;
}

/**
 * A demo export serves every business from one build; a named tenant would
 * simply be ignored by demoRuntimeBundlePath rather than built, which is
 * exactly the "one shop's identity over another shop's menu, and nothing in
 * the log to say so" failure this whole slot layout exists to prevent. Fails
 * closed on the env var, not on whatever the caller happened to pass in.
 */
function demoRuntimeConflict() {
  const named = process.env.EXPO_PUBLIC_TENANT?.trim();
  return demoRuntimeEnabled() && !!named;
}

function tenantBundlePath(appRoot, moduleName, requested) {
  if (!moduleName.startsWith(PREFIX)) return null;
  if (demoRuntimeConflict()) {
    throw new Error(
      `EXPO_PUBLIC_DEMO_RUNTIME=1 and EXPO_PUBLIC_TENANT="${process.env.EXPO_PUBLIC_TENANT?.trim()}" `
      + 'cannot both be set: a demo runtime export serves every business from one build, '
      + 'and a named tenant would silently be ignored rather than built.',
    );
  }
  const request = moduleName.slice(PREFIX.length);
  const target = demoRuntimeEnabled()
    ? demoRuntimeBundlePath(appRoot, request)
    : tenantSlotBundlePath(appRoot, request, requested);
  if (!target || !existsSync(target)) {
    throw new Error(`apps/${basename(appRoot)} cannot resolve selected tenant import "${moduleName}".`);
  }
  return target;
}

function withTenantBundleResolver(config, appRoot) {
  const upstream = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const selected = tenantBundlePath(appRoot, moduleName);
    if (selected) return context.resolveRequest(context, selected, platform);
    return upstream
      ? upstream(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
  };
  return config;
}

module.exports = { demoRuntimeEnabled, selectedTenant, tenantBundlePath, withTenantBundleResolver };
