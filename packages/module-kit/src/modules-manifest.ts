/**
 * The gate between a tenant's modules.json on disk and onboarding in memory.
 *
 * Where a module manifest describes what a module *is*, a tenant modules
 * manifest describes what one tenant *has*: the modules installed for it, the
 * version pinned, the configuration artifact each reads, and the app surfaces
 * each may appear on. It is author-edited data with the same trust posture as
 * module manifests and industry blueprints: every field is validated before
 * the manifest may seed onboarding, and the parser collects *every* problem
 * rather than failing on the first -- a manifest review should end with the
 * whole list, not a round trip per mistake. Unknown fields (such as a `$docs`
 * block) are tolerated, matching the manifest parser's strictness: only the
 * fields the contract owns are validated.
 */
import { parseSemVer } from './semver';
import { APP_SURFACES, type AppSurface } from './types';

const MODULE_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;
const MAX_MODULES = 64;

/** One installed module: what is on, at which version, on which surfaces. */
export type TenantModuleInstall = {
  readonly key: string;
  /** Pinned exact `x.y.z`; tenants never range. */
  readonly version: string;
  /** Relative path to the module's configuration artifact, when it has one. */
  readonly config: string | null;
  /** Surfaces the module may appear on; null means unconstrained. */
  readonly surfaces: readonly AppSurface[] | null;
  readonly enabled: boolean;
};

/** What a tenant declares about its installed modules. */
export type TenantModulesManifest = {
  readonly schemaVersion: number;
  readonly modules: readonly TenantModuleInstall[];
};

export type TenantModulesResult =
  | { readonly kind: 'ok'; readonly manifest: TenantModulesManifest }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A config artifact must stay inside the tenant folder: relative, and with no
 * `..` segment that could walk out of it.
 */
function configIssue(value: unknown, path: string): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return `${path} must be a relative artifact path`;
  }
  if (value.startsWith('/') || value.startsWith('\\') || WINDOWS_ABSOLUTE.test(value)) {
    return `${path} must be a relative path, not "${value}"`;
  }
  if (value.split(/[\\/]/).some((segment) => segment === '..')) {
    return `${path} must not escape the tenant folder: "${value}"`;
  }
  return null;
}

function parseSurfaces(value: unknown, path: string, issues: string[]): AppSurface[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    issues.push(`${path} must be a list of app surfaces`);
    return null;
  }
  const list = value as string[];
  for (const entry of list) {
    if (!(APP_SURFACES as readonly string[]).includes(entry)) {
      issues.push(`${path} entry "${entry}" is not one of ${APP_SURFACES.join(', ')}`);
    }
  }
  if (new Set(list).size !== list.length) issues.push(`${path} must not repeat entries`);
  return list as AppSurface[];
}

function parseInstall(
  entry: unknown, index: number, seen: Map<string, number>, issues: string[],
): TenantModuleInstall | null {
  const path = `modules[${index}]`;
  if (!isRecord(entry)) {
    issues.push(`${path} must be an object`);
    return null;
  }
  const key = typeof entry.key === 'string' ? entry.key : '';
  if (!MODULE_KEY.test(key)) issues.push(`${path}.key must be a module key like "commerce-catalog"`);
  else {
    const prior = seen.get(key);
    if (prior === undefined) seen.set(key, index);
    else issues.push(`${path}.key duplicates modules[${prior}].key "${key}"`);
  }

  const version = typeof entry.version === 'string' ? entry.version : '';
  if (!parseSemVer(version)) issues.push(`${path}.version must be a semantic version x.y.z`);

  let config: string | null = null;
  if (entry.config !== undefined) {
    const issue = configIssue(entry.config, `${path}.config`);
    if (issue) issues.push(issue);
    else config = entry.config as string;
  }

  let enabled = true;
  if (entry.enabled !== undefined) {
    if (typeof entry.enabled === 'boolean') enabled = entry.enabled;
    else issues.push(`${path}.enabled must be a boolean`);
  }

  const surfaces = parseSurfaces(entry.surfaces, `${path}.surfaces`, issues);
  return { key, version, config, surfaces, enabled };
}

/** Validates a raw tenant modules.json. Never throws: bad input is a result, not a crash. */
export function parseTenantModulesManifest(raw: unknown): TenantModulesResult {
  if (!isRecord(raw)) {
    return { kind: 'invalid', issues: ['a tenant modules manifest must be an object'] };
  }
  const issues: string[] = [];

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    issues.push('schemaVersion must be an integer of at least 1');
  }

  const modules: TenantModuleInstall[] = [];
  if (!Array.isArray(raw.modules)) {
    issues.push('modules must be a list of module entries');
  } else {
    if (raw.modules.length > MAX_MODULES) {
      issues.push(`modules may name at most ${MAX_MODULES} entries`);
    }
    const seen = new Map<string, number>();
    raw.modules.forEach((entry, index) => {
      const install = parseInstall(entry, index, seen, issues);
      if (install) modules.push(install);
    });
  }

  if (issues.length > 0) return { kind: 'invalid', issues };
  return { kind: 'ok', manifest: { schemaVersion: schemaVersion as number, modules } };
}
