import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { easProjectIssues, releaseManifestIssues } from '../packages/factory/src/release';
import { parseTenantModulesManifest } from '../packages/module-kit/src/modules-manifest';
import { MODULE_REGISTRY } from '../packages/module-kit/src/registry';

/**
 * Which app surfaces this tenant ships, from the registry rather than from the
 * tenant's own manifest.
 *
 * modules.json names the surfaces each install serves, and onboarding already
 * rejects a manifest claiming a surface the module does not serve -- but it
 * cannot reject one that claims FEWER, and a tenant that could under-declare
 * could skip the EAS check for a surface it really ships. So the manifest is
 * read only for which modules are enabled; the surfaces come from the registry
 * entry for each of those keys.
 *
 * Every failure path returns all five surfaces, so a missing, unreadable or
 * invalid manifest requires every EAS id rather than none.
 */
const ALL_SURFACES = MODULE_REGISTRY.flatMap((definition) => definition.surfaces);

function shippedSurfaces(directory: string): readonly string[] {
  const path = join(directory, 'modules.json');
  if (!existsSync(path)) return ALL_SURFACES;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return ALL_SURFACES;
  }
  const parsed = parseTenantModulesManifest(raw);
  if (parsed.kind !== 'ok') return ALL_SURFACES;
  const enabled = new Set(
    parsed.manifest.modules.filter((install) => install.enabled).map((install) => install.key),
  );
  return MODULE_REGISTRY
    .filter((definition) => enabled.has(definition.key))
    .flatMap((definition) => definition.surfaces);
}

const index = process.argv.indexOf('--tenant');
const tenant = index >= 0 ? process.argv[index + 1] : undefined;
if (!tenant || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant)) {
  console.error('Usage: pnpm release:gate --tenant <slug>');
  process.exit(1);
}

const tenantDirectory = join(process.cwd(), 'tenants', tenant);
const manifestPath = join(tenantDirectory, 'release.json');
const brandPath = join(tenantDirectory, 'brand.json');
const issues: string[] = [];
if (!existsSync(manifestPath)) issues.push(`tenants/${tenant}/release.json is required.`);
if (!existsSync(brandPath)) issues.push(`tenants/${tenant}/brand.json is required.`);

if (existsSync(manifestPath)) {
  try {
    issues.push(...releaseManifestIssues(JSON.parse(readFileSync(manifestPath, 'utf8')), tenant));
  } catch {
    issues.push('release.json must contain valid JSON.');
  }
}
if (existsSync(brandPath)) {
  try {
    const brand = JSON.parse(readFileSync(brandPath, 'utf8')) as { identity?: unknown };
    issues.push(...easProjectIssues(brand.identity, shippedSurfaces(tenantDirectory)));
  } catch {
    issues.push('brand.json must contain valid JSON.');
  }
}

if (issues.length > 0) {
  console.error(`Production release for ${tenant} is blocked:`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log(`Production release gate passed for ${tenant}.`);
