import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FACTORY_SURFACES, type FactorySurface } from '../packages/factory/src/providers';
import {
  parseTenantModulesManifest, servesABuiltSurface,
} from '../packages/module-kit/src/modules-manifest';
import { TENANT_SURFACES } from '../packages/tenant-config/src/types';
import { MODULE_REGISTRY } from '../packages/module-kit/src/registry';

export type TenantReleaseSurfacePlan = Readonly<{
  all: readonly FactorySurface[];
  web: readonly Exclude<FactorySurface, 'hq'>[];
  native: readonly Extract<FactorySurface, 'customer' | 'operator' | 'kiosk'>[];
  failClosed: boolean;
  issues: readonly string[];
}>;

function readJson(path: string, label: string): { value?: unknown; issues: string[] } {
  if (!existsSync(path)) return { issues: [`${label} is required to resolve release surfaces.`] };
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) as unknown, issues: [] };
  } catch {
    return { issues: [`${label} must contain valid JSON.`] };
  }
}

function declaredSurfaces(value: unknown): { surfaces: FactorySurface[]; issues: string[] } {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).surfaces
    : undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { surfaces: [], issues: ['brand.json surfaces must be a non-empty list.'] };
  }
  const surfaces = raw.filter((surface): surface is FactorySurface => (
    typeof surface === 'string' && FACTORY_SURFACES.includes(surface as FactorySurface)
  ));
  const issues: string[] = [];
  // A surface this repo does not build is not an error: `admin` is the Elevate
  // portal, declared in a pack Elevate owns. Only a value that is no tenant
  // surface at all is unsupported -- the rest are simply not ours to ship.
  const unsupported = raw.some((surface) => (
    typeof surface !== 'string' || !(TENANT_SURFACES as readonly string[]).includes(surface)
  ));
  if (unsupported) issues.push('brand.json surfaces contains an unsupported surface.');
  // Over `raw`, not the filtered list: a pack repeating a surface we skip is
  // still a malformed pack, and filtering first would hide it.
  if (new Set(raw).size !== raw.length) issues.push('brand.json surfaces must not repeat entries.');
  if (!surfaces.includes('hq')) issues.push('brand.json surfaces must include the HQ API.');
  return { surfaces, issues };
}

function identityIssues(value: unknown, expectedTenant: string): string[] {
  const brand = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  const identity = brand?.identity && typeof brand.identity === 'object'
    && !Array.isArray(brand.identity) ? brand.identity as Record<string, unknown> : null;
  return identity?.slug === expectedTenant
    ? [] : [`brand.json identity.slug must match the requested tenant "${expectedTenant}".`];
}

function plan(surfaces: Iterable<FactorySurface>, issues: readonly string[] = []): TenantReleaseSurfacePlan {
  const shipped = new Set(surfaces);
  shipped.add('hq');
  const all = FACTORY_SURFACES.filter((surface) => shipped.has(surface));
  const web = all.filter((surface): surface is Exclude<FactorySurface, 'hq'> => surface !== 'hq');
  const native = all.filter((surface): surface is TenantReleaseSurfacePlan['native'][number] => (
    surface === 'customer' || surface === 'operator' || surface === 'kiosk'
  ));
  return Object.freeze({ all, web, native, failClosed: issues.length > 0, issues });
}

export function tenantReleaseSurfacePlan(
  directory: string,
  expectedTenant: string,
): TenantReleaseSurfacePlan {
  const brand = readJson(join(directory, 'brand.json'), 'brand.json');
  const modules = readJson(join(directory, 'modules.json'), 'modules.json');
  const declaration = declaredSurfaces(brand.value);
  const earlyIssues = [
    ...brand.issues, ...modules.issues, ...declaration.issues,
    ...identityIssues(brand.value, expectedTenant),
  ];
  if (earlyIssues.length > 0) return plan(FACTORY_SURFACES, earlyIssues);
  const parsed = parseTenantModulesManifest(modules.value);
  if (parsed.kind !== 'ok') return plan(FACTORY_SURFACES, parsed.issues);
  // Modules hosted on a surface this repo does not build are not ours to plan
  // a release for, and are absent from the registry on purpose -- counting them
  // here would fail the gate on a pack that is correct.
  const enabled = new Set(
    parsed.manifest.modules
      .filter((install) => install.enabled && servesABuiltSurface(install))
      .map((install) => install.key),
  );
  const known = new Set(MODULE_REGISTRY.map((definition) => definition.key));
  const unknown = [...enabled].filter((key) => !known.has(key));
  if (unknown.length > 0) {
    return plan(FACTORY_SURFACES, unknown.map((key) => `Enabled module ${key} is not in the module registry.`));
  }
  // Narrowed to what we build: a registry module never needs `admin`, and
  // `declaration.surfaces` below only ever holds surfaces this repo ships.
  const required = new Set(MODULE_REGISTRY
    .filter((definition) => enabled.has(definition.key))
    .flatMap((definition) => definition.surfaces)
    .filter((surface): surface is FactorySurface => (
      (FACTORY_SURFACES as readonly string[]).includes(surface)
    )));
  const missing = [...required].filter((surface) => !declaration.surfaces.includes(surface));
  if (missing.length > 0) {
    return plan(FACTORY_SURFACES, [
      `brand.json surfaces omits enabled module surfaces: ${missing.join(', ')}.`,
    ]);
  }
  return plan(declaration.surfaces);
}

function requestedTenant(): string | null {
  const index = process.argv.indexOf('--tenant');
  const tenant = index >= 0 ? process.argv[index + 1] : undefined;
  return tenant && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant) ? tenant : null;
}

if (process.argv[1]?.endsWith('release-surfaces.ts')) {
  const tenant = requestedTenant();
  if (!tenant) {
    console.error('Usage: pnpm exec tsx scripts/release-surfaces.ts --tenant <slug>');
    process.exit(1);
  }
  const result = tenantReleaseSurfacePlan(join(process.cwd(), 'tenants', tenant), tenant);
  if (result.failClosed) {
    for (const issue of result.issues) console.error(`Release surface plan blocked: ${issue}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result));
}
