/**
 * The gate between a module manifest on disk and the registry in memory.
 *
 * Manifests are author-edited data, so nothing about them is trusted: every
 * field is validated before a definition may enter resolution. The parser
 * collects *every* problem rather than failing on the first -- a manifest
 * review should end with the whole list, not a round trip per mistake.
 */
import {
  APP_SURFACES, OFFLINE_CONTRIBUTIONS,
  type AppSurface, type ModuleDefinition, type OfflineContribution,
} from './types';
import { parseSemVer, satisfiesRange } from './semver';

const KEY = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;
const PERMISSION = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
const RANGE_OR_PIN = /^(\^)?\d+\.\d+\.\d+$/;

export type ManifestResult =
  | { readonly kind: 'ok'; readonly definition: ModuleDefinition }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, field: string, issues: string[], pattern?: RegExp): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    issues.push(`${field} must be a list of non-empty strings`);
    return [];
  }
  const list = value as string[];
  if (list.length > 64) issues.push(`${field} may name at most 64 entries`);
  if (pattern) {
    for (const entry of list) {
      if (!pattern.test(entry)) issues.push(`${field} entry "${entry}" is not well-formed`);
    }
  }
  const seen = new Set(list);
  if (seen.size !== list.length) issues.push(`${field} must not repeat entries`);
  return list;
}

function parseDependencies(value: unknown, issues: string[]): ModuleDefinition['dependencies'] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push('dependencies must be a list of { key, version }');
    return [];
  }
  const out: { key: string; version: string }[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || typeof entry.version !== 'string') {
      issues.push('each dependency needs a string key and a string version');
      continue;
    }
    if (!KEY.test(entry.key)) issues.push(`dependency key "${entry.key}" is not slug-shaped`);
    if (!RANGE_OR_PIN.test(entry.version)) {
      issues.push(`dependency "${entry.key}" version must be x.y.z or ^x.y.z`);
    }
    out.push({ key: entry.key, version: entry.version });
  }
  return out;
}

/** Validates a raw manifest. Never throws: bad input is a result, not a crash. */
export function parseModuleDefinition(raw: unknown): ManifestResult {
  const issues: string[] = [];
  if (!isRecord(raw)) return { kind: 'invalid', issues: ['a module manifest must be an object'] };

  const key = typeof raw.key === 'string' ? raw.key : '';
  if (!KEY.test(key)) issues.push('key must be a lowercase slug of 3-50 characters');

  const version = typeof raw.version === 'string' ? raw.version : '';
  if (!parseSemVer(version)) issues.push('version must be a semantic version x.y.z');

  const surfaces = stringList(raw.surfaces, 'surfaces', issues) as AppSurface[];
  if (surfaces.length === 0) issues.push('a module must support at least one app surface');
  for (const surface of surfaces) {
    if (!(APP_SURFACES as readonly string[]).includes(surface)) {
      issues.push(`surface "${surface}" is not one of ${APP_SURFACES.join(', ')}`);
    }
  }

  const configSchemaVersion = raw.configSchemaVersion;
  if (typeof configSchemaVersion !== 'number'
      || !Number.isInteger(configSchemaVersion) || configSchemaVersion < 1) {
    issues.push('configSchemaVersion must be an integer of at least 1');
  }

  const dependencies = parseDependencies(raw.dependencies, issues);
  if (dependencies.some((dependency) => dependency.key === key)) {
    issues.push('a module cannot depend on itself');
  }
  const permissions = stringList(raw.permissions, 'permissions', issues, PERMISSION);
  const routes = stringList(raw.routes, 'routes', issues);
  const jobs = stringList(raw.jobs, 'jobs', issues);
  const events = stringList(raw.events, 'events', issues);
  const releasePrerequisites = stringList(
    raw.releasePrerequisites, 'releasePrerequisites', issues,
  );
  const incompatibleWith = stringList(raw.incompatibleWith, 'incompatibleWith', issues, KEY);
  if (incompatibleWith.includes(key)) issues.push('a module cannot be incompatible with itself');

  const offline = typeof raw.offline === 'string' ? raw.offline : 'none';
  if (!(OFFLINE_CONTRIBUTIONS as readonly string[]).includes(offline)) {
    issues.push(`offline must be one of ${OFFLINE_CONTRIBUTIONS.join(', ')}`);
  }

  if (issues.length > 0) return { kind: 'invalid', issues };
  return {
    kind: 'ok',
    definition: {
      key, version, dependencies, surfaces,
      configSchemaVersion: configSchemaVersion as number,
      permissions, routes, jobs, events,
      offline: offline as OfflineContribution,
      releasePrerequisites, incompatibleWith,
    },
  };
}

/**
 * The version-range half of validation lives here because only a resolved
 * dependency pair can answer it: the manifest alone cannot know what the
 * registry holds.
 */
export function dependencySatisfied(
  dependency: ModuleDefinition['dependencies'][number],
  available: ModuleDefinition | undefined,
): boolean {
  if (!available) return false;
  const version = parseSemVer(available.version);
  return version !== null && satisfiesRange(version, dependency.version);
}
