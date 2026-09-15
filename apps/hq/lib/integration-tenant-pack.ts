import { parseTenantModulesManifest } from '@platform/module-kit';
import { parseMenuCsv } from '@platform/schema';
import { parseTenantManifest } from '@platform/tenant-config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z][a-z0-9-]{1,62}$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SAFE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const MAX_FILES = 128;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

const CORE = [
  'brand.json', 'modules.json', 'operations.json', 'packs.json',
  'release.json', 'training-profile.json', 'README.md', 'assets/.gitkeep',
] as const;
const COMMERCE = ['menu.csv', 'menu-categories.json', 'modifiers.json'] as const;

export type TenantPackSnapshot = {
  brandId: string;
  slug: string;
  revision: number;
  files: Record<string, string>;
  sourceRepo: string;
  sourceCommit: string;
};

export type TenantPackValidation =
  | { kind: 'ok'; snapshot: TenantPackSnapshot }
  | { kind: 'invalid'; issues: readonly string[] };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonFile(files: Record<string, string>, path: string, issues: string[]): unknown {
  const raw = files[path];
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    issues.push(`${path} must contain valid JSON.`);
    return undefined;
  }
}

function validateEnvelope(raw: unknown, issues: string[]): TenantPackSnapshot | null {
  if (!object(raw)) {
    issues.push('The request body must be one object.');
    return null;
  }
  const { brandId, slug, revision, files, sourceRepo, sourceCommit } = raw;
  if (typeof brandId !== 'string' || !UUID.test(brandId)) issues.push('brandId must be a UUID.');
  if (typeof slug !== 'string' || !SLUG.test(slug)) issues.push('slug is not a tenant slug.');
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    issues.push('revision must be a positive integer.');
  }
  if (typeof sourceRepo !== 'string' || !REPO.test(sourceRepo)) {
    issues.push('sourceRepo must use owner/name form.');
  }
  if (typeof sourceCommit !== 'string' || !COMMIT.test(sourceCommit)) {
    issues.push('sourceCommit must be a 40-character Git commit SHA.');
  }
  if (!object(files) || Object.values(files).some((value) => typeof value !== 'string')) {
    issues.push('files must map relative paths to text contents.');
    return null;
  }
  if (issues.length > 0) return null;
  return raw as TenantPackSnapshot;
}

function validatePaths(files: Record<string, string>, issues: string[]): void {
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) issues.push(`files may contain at most ${MAX_FILES} entries.`);
  let total = 0;
  for (const [path, contents] of entries) {
    if (!SAFE_PATH.test(path) || path.split('/').includes('..')) {
      issues.push(`files contains an unsafe path: ${path}.`);
      continue;
    }
    const bytes = Buffer.byteLength(contents, 'utf8');
    total += bytes;
    if (bytes > MAX_FILE_BYTES) issues.push(`${path} exceeds the 2 MiB text-file limit.`);
  }
  if (total > MAX_TOTAL_BYTES) issues.push('The tenant pack exceeds the 8 MiB request limit.');
}

function validateBrand(snapshot: TenantPackSnapshot, issues: string[]): void {
  const brand = parseTenantManifest(jsonFile(snapshot.files, 'brand.json', issues));
  if (brand.kind === 'invalid') {
    issues.push(...brand.issues.map((issue) => `brand.json: ${issue}`));
    return;
  }
  if (brand.manifest.identity.slug !== snapshot.slug) {
    issues.push('brand.json identity.slug must match slug.');
  }
  if (!brand.manifest.identity.bundleId.includes('.')) {
    issues.push('brand.json identity.bundleId must be reverse-DNS.');
  }
  if (brand.manifest.surfaces.includes('kiosk')) {
    if (!brand.manifest.identity.kioskBundleId.includes('.')) {
      issues.push('brand.json identity.kioskBundleId must be reverse-DNS for kiosk.');
    }
    if (!/^[a-z][a-z0-9+.-]*$/.test(brand.manifest.identity.kioskScheme)) {
      issues.push('brand.json identity.kioskScheme must be a valid URL scheme for kiosk.');
    }
  }
}

function validateModules(snapshot: TenantPackSnapshot, issues: string[]): void {
  const result = parseTenantModulesManifest(jsonFile(snapshot.files, 'modules.json', issues));
  if (result.kind === 'invalid') {
    issues.push(...result.issues.map((issue) => `modules.json: ${issue}`));
    return;
  }
  for (const module of result.manifest.modules) {
    if (module.config && snapshot.files[module.config] === undefined) {
      issues.push(`modules.json config ${module.config} is missing.`);
    }
  }
  if (result.manifest.modules.some((module) => module.key === 'commerce-catalog')) {
    for (const path of COMMERCE) {
      if (snapshot.files[path] === undefined) issues.push(`${path} is required for commerce-catalog.`);
    }
    const menu = parseMenuCsv(snapshot.files['menu.csv'] ?? '');
    issues.push(...menu.errors.map((issue) => `menu.csv: ${issue}`));
  }
}

function validateDocuments(snapshot: TenantPackSnapshot, issues: string[]): void {
  for (const path of CORE) if (snapshot.files[path] === undefined) issues.push(`${path} is required.`);
  validateBrand(snapshot, issues);
  validateModules(snapshot, issues);
  for (const path of ['operations.json', 'packs.json', 'training-profile.json']) {
    const value = jsonFile(snapshot.files, path, issues);
    if (value !== undefined && !object(value)) issues.push(`${path} must contain one JSON object.`);
  }
  const release = jsonFile(snapshot.files, 'release.json', issues);
  if (object(release)) {
    if (release.schemaVersion !== 2) issues.push('release.json schemaVersion must equal 2.');
    if (release.tenantSlug !== snapshot.slug) issues.push('release.json tenantSlug must match slug.');
  } else if (release !== undefined) issues.push('release.json must contain one JSON object.');
  const hasServices = snapshot.files['services.json'] !== undefined;
  const hasBrandKit = snapshot.files['brand-kit.json'] !== undefined;
  if (hasServices !== hasBrandKit) issues.push('services.json and brand-kit.json must be sent together.');
}

/** Validates an integration snapshot fully before the route may persist it. */
export function validateIntegrationTenantPack(raw: unknown): TenantPackValidation {
  const issues: string[] = [];
  const snapshot = validateEnvelope(raw, issues);
  if (!snapshot) return { kind: 'invalid', issues };
  validatePaths(snapshot.files, issues);
  validateDocuments(snapshot, issues);
  return issues.length > 0 ? { kind: 'invalid', issues } : { kind: 'ok', snapshot };
}
