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

function tenantBundlePath(appRoot, moduleName, requested) {
  if (!moduleName.startsWith(PREFIX)) return null;
  const tenant = selectedTenant(appRoot, requested);
  const request = moduleName.slice(PREFIX.length);
  const slotRoot = join(appRoot, 'src', 'tenants', tenant);
  const config = CONFIG_TARGETS.get(request);
  const generated = GENERATED_TARGETS.get(request);
  const target = config
    ? join(slotRoot, config)
    : generated
      ? join(slotRoot, generated)
      : request.startsWith('artwork/')
        ? inside(join(appRoot, 'assets', 'tenants', tenant), request.slice('artwork/'.length))
        : null;
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

module.exports = { selectedTenant, tenantBundlePath, withTenantBundleResolver };
