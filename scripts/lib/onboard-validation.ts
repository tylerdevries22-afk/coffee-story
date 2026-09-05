import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildTenantMenu,
  parseMenuCsv,
  parseTenantOperations,
  type BundledTenantMenu,
  type MenuCsvRow,
  type TenantMenuCategory,
  type TenantOperationsConfig,
} from '@platform/schema';

import {
  parseTenantManifest,
  type TenantManifest,
} from '../../packages/tenant-config/src/index.js';
import type { TenantModulesManifest } from '../../packages/module-kit/src/modules-manifest.js';
import { modulesManifestProblems, readTenantModulesManifest } from '../onboard-modules-manifest.js';
import {
  validateGuestAppTenant, validateGuestArtworkInputs, validateMenuAssets,
} from './onboard-assets.js';
import { readOptionalObjectFile } from './onboard-json.js';
import { validateModifierGroups } from './onboard-modifier-validation.js';
import { validatePackFlow } from './onboard-pack-validation.js';
import { validateTokens } from './onboard-token-validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ValidatedTenant = {
  brand: TenantManifest;
  menuRows: MenuCsvRow[];
  menu: BundledTenantMenu;
  modifiers: Record<string, unknown[]>;
  operations: TenantOperationsConfig | null;
  modules: TenantModulesManifest;
  guestSurfaces: ('customer' | 'kiosk')[];
};

export class TenantValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super('Tenant manifest or artifacts do not validate.');
  }
}

function parseOperations(
  path: string, required: boolean, problems: string[],
): TenantOperationsConfig | null {
  if (required && !existsSync(path)) {
    problems.push('features.operations requires an operations.json tenant artifact.');
  }
  if (!existsSync(path)) return null;
  try {
    const parsed = parseTenantOperations(JSON.parse(readFileSync(path, 'utf8')) as unknown, required);
    if (parsed.value) return parsed.value;
    problems.push(...parsed.errors.map((error) => `operations.json: ${error}`));
  } catch {
    problems.push('operations.json must contain valid JSON.');
  }
  return null;
}

function readModifiers(path: string, rows: MenuCsvRow[], problems: string[]): Record<string, unknown[]> {
  if (!existsSync(path)) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    problems.push('modifiers.json must contain valid JSON.');
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    problems.push('modifiers.json must contain one JSON object.');
    return {};
  }
  const modifiers = value as Record<string, unknown[]>;
  for (const [itemSlug, groups] of Object.entries(modifiers)) {
    if (!Array.isArray(groups)) {
      problems.push(`modifiers.json: "${itemSlug}" must map to an array of option groups.`);
    } else if (rows.length > 0 && !rows.some((row) => row.slug === itemSlug)) {
      problems.push(`modifiers.json: "${itemSlug}" is not in menu.csv.`);
    } else {
      validateModifierGroups(itemSlug, groups, problems);
    }
  }
  return modifiers;
}

function validateIdentity(
  brand: TenantManifest, folderSlug: string, scaffold: boolean, problems: string[],
): void {
  if (scaffold ? !SLUG.test(brand.identity.slug) : brand.identity.slug !== folderSlug) {
    problems.push(`identity.slug does not match the tenant folder "${folderSlug}".`);
  }
  if (!brand.identity.bundleId.includes('.')) problems.push('identity.bundleId must be reverse-DNS.');
  if (!brand.identity.kioskBundleId.includes('.')) problems.push('identity.kioskBundleId must be reverse-DNS.');
  if (!/^[a-z][a-z0-9+.-]*$/.test(brand.identity.kioskScheme)) {
    problems.push('identity.kioskScheme must be a valid URL scheme.');
  }
  if (brand.identity.kioskEasProjectId !== '' && !UUID.test(brand.identity.kioskEasProjectId)) {
    problems.push('identity.kioskEasProjectId must be empty or a valid EAS project UUID.');
  }
}

export function validateTenant(input: {
  tenantDir: string;
  slug: string;
  scaffold: boolean;
  apply: boolean;
  requireDatabase: boolean;
  allowImagelessFixture: boolean;
}): ValidatedTenant {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(input.tenantDir, 'brand.json'), 'utf8')) as unknown;
  } catch {
    throw new TenantValidationError(['brand.json must contain valid JSON.']);
  }
  const parsed = parseTenantManifest(raw);
  if (parsed.kind === 'invalid') {
    throw new TenantValidationError(parsed.issues.map((issue) => `brand.json: ${issue}`));
  }
  const brand = parsed.manifest;
  validateIdentity(brand, input.slug, input.scaffold, problems);
  const menuPath = join(input.tenantDir, 'menu.csv');
  const operationsPath = join(input.tenantDir, 'operations.json');
  if (brand.locations.length === 0 && (existsSync(menuPath) || existsSync(operationsPath))) {
    problems.push('at least one location is required with menu.csv or operations.json.');
  }
  for (const jurisdiction of brand.tax?.jurisdictions ?? []) {
    if (!jurisdiction.id || !jurisdiction.label || jurisdiction.rate < 0 || jurisdiction.rate >= 1) {
      problems.push('tax.jurisdictions entries need id, label and a fractional rate.');
    }
  }
  for (const reward of brand.loyalty?.rewards ?? []) {
    if (!reward.slug || !reward.name || !Number.isInteger(reward.points_cost) || reward.points_cost <= 0) {
      problems.push('loyalty.rewards entries need slug, name and positive integer points_cost.');
    }
  }
  const operations = parseOperations(operationsPath, brand.features.operations === true, problems);
  problems.push(...modulesManifestProblems(input.tenantDir));
  const parsedMenu = existsSync(menuPath)
    ? parseMenuCsv(readFileSync(menuPath, 'utf8')) : { rows: [], errors: [] };
  problems.push(...parsedMenu.errors.map((error) => `menu.csv: ${error}`));
  const modifiers = readModifiers(join(input.tenantDir, 'modifiers.json'), parsedMenu.rows, problems);
  const categoriesPath = join(input.tenantDir, 'menu-categories.json');
  const categories = existsSync(categoriesPath)
    ? JSON.parse(readFileSync(categoriesPath, 'utf8')) as TenantMenuCategory[] : [];
  const packs = readOptionalObjectFile(join(input.tenantDir, 'packs.json'), 'packs.json', problems);
  const compiled = buildTenantMenu(parsedMenu.rows, categories, modifiers, packs);
  problems.push(...compiled.errors);
  validatePackFlow(brand.kiosk, compiled.menu, problems);
  validateTokens(brand.tokens, problems);
  if (input.apply || (input.requireDatabase && !input.allowImagelessFixture)) {
    validateMenuAssets(input.tenantDir, compiled.menu, problems);
  }
  const guestSurfaces = brand.surfaces.filter(
    (surface): surface is 'customer' | 'kiosk' => surface === 'customer' || surface === 'kiosk',
  );
  if (input.apply && guestSurfaces.length > 0) {
    validateGuestAppTenant(brand, problems);
    validateGuestArtworkInputs(input.tenantDir, guestSurfaces, problems);
  }
  if (problems.length > 0) throw new TenantValidationError(problems);
  return {
    brand, menuRows: parsedMenu.rows, menu: compiled.menu, modifiers, operations,
    modules: readTenantModulesManifest(input.tenantDir), guestSurfaces,
  };
}
