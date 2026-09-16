import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where a tenant authors its catalog.
 *
 * The commerce-catalog module config has carried a `sources` map since it was
 * written, and that file's own `$docs` promise that "a tenant can be re-pointed
 * without editing the manifest". Nothing read it. Onboarding joined the four
 * filenames directly, so re-pointing a tenant changed exactly nothing and the
 * promise was false -- the config was checked to EXIST (onboard-modules-manifest
 * verifies the path is a file) and never opened.
 *
 * This reads it. The defaults are the filenames onboarding already hard-coded,
 * so a tenant that says nothing resolves to precisely the paths it used before.
 */
export type CatalogSources = {
  readonly offerings: string;
  readonly folders: string;
  readonly modifierGroups: string;
  readonly packs: string;
};

export const DEFAULT_CATALOG_SOURCES: CatalogSources = {
  offerings: 'menu.csv',
  folders: 'menu-categories.json',
  modifierGroups: 'modifiers.json',
  packs: 'packs.json',
};

const CATALOG_MODULE = 'commerce-catalog';
const SOURCE_KEYS = ['offerings', 'folders', 'modifierGroups', 'packs'] as const;

/**
 * A source names a file inside the tenant folder, and nothing else. The same
 * posture the tenant-pack wire contract takes: no absolute path, no drive
 * letter, no `..` segment. A catalog that can be pointed at /etc is not a
 * configuration surface, it is a file-read primitive.
 */
function unsafe(value: string): boolean {
  if (value.length === 0 || value.length > 200) return true;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return true;
  return value.split(/[\\/]/).some((segment) => segment === '..');
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The config path the tenant's modules.json declares for commerce-catalog. */
function catalogConfigPath(tenantDir: string): string | null {
  const manifest = readJson(join(tenantDir, 'modules.json'));
  if (!isRecord(manifest) || !Array.isArray(manifest.modules)) return null;
  for (const entry of manifest.modules) {
    if (!isRecord(entry) || entry.key !== CATALOG_MODULE) continue;
    return typeof entry.config === 'string' && !unsafe(entry.config) ? entry.config : null;
  }
  return null;
}

/**
 * Resolve the four catalog source paths, relative to the tenant folder.
 *
 * Every failure falls back to the defaults rather than throwing, so a broken
 * config cannot change where onboarding reads from -- but a config that exists
 * and does not parse IS reported here, because nothing else reads it:
 * modulesManifestProblems checks only that the declared path is a file. Staying
 * quiet would let a tenant believe it had re-pointed its catalog when the file
 * it re-pointed with is unreadable.
 */
export function resolveCatalogSources(tenantDir: string, problems: string[]): CatalogSources {
  const configPath = catalogConfigPath(tenantDir);
  if (configPath === null) return DEFAULT_CATALOG_SOURCES;
  const absolute = join(tenantDir, configPath);
  if (!existsSync(absolute)) return DEFAULT_CATALOG_SOURCES;
  const config = readJson(absolute);
  if (!isRecord(config)) {
    problems.push(`${configPath} must contain one JSON object.`);
    return DEFAULT_CATALOG_SOURCES;
  }
  if (config.sources === undefined) return DEFAULT_CATALOG_SOURCES;
  if (!isRecord(config.sources)) {
    problems.push(`${configPath}: sources must be an object.`);
    return DEFAULT_CATALOG_SOURCES;
  }
  const declared = config.sources;
  const resolved: Record<string, string> = { ...DEFAULT_CATALOG_SOURCES };
  for (const key of SOURCE_KEYS) {
    const value = declared[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || unsafe(value)) {
      problems.push(`${configPath}: sources.${key} must name a file inside the tenant folder.`);
      continue;
    }
    resolved[key] = value;
  }
  return resolved as unknown as CatalogSources;
}
