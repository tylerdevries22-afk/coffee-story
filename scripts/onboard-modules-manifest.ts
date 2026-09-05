/**
 * Read-only modules.json wiring for onboarding.
 *
 * While module installs are still declared per tenant on disk, onboarding's
 * validation phase is the one gate every tenant passes through -- so when
 * tenants/<slug>/modules.json exists, every problem found here becomes a
 * validation problem. A tenant without the file is unaffected: nothing else
 * reads it yet, so its absence must not fail anyone.
 *
 * Parsing is only half the gate. parseTenantModulesManifest validates the
 * shape of the authored data and nothing beyond it: it does not know the
 * registry exists, so a manifest naming a module the platform does not ship,
 * pinning a version nothing publishes, claiming a surface the module never
 * appears on, or pointing at a configuration artifact that is not on disk
 * parses cleanly and fails much later, in a place that does not name the
 * cause. Each of those is checked here, against the registry and the tenant
 * folder, before onboarding may seed anything.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseTenantModulesManifest,
  type TenantModuleInstall,
  type TenantModulesManifest,
} from '../packages/module-kit/src/modules-manifest';
import { MODULE_REGISTRY } from '../packages/module-kit/src/registry';
import { resolveModules, type ResolutionError } from '../packages/module-kit/src/resolve';
import type { ModuleDefinition } from '../packages/module-kit/src/types';

const REGISTRY_BY_KEY = new Map<string, ModuleDefinition>(
  MODULE_REGISTRY.map((definition) => [definition.key, definition]),
);

/** Resolution speaks in structured errors; onboarding reports lines to a human. */
function describeResolutionError(error: ResolutionError): string {
  switch (error.kind) {
    case 'unknown-module':
      return `"${error.key}" is not a module the platform ships`;
    case 'unknown-dependency':
      return `"${error.key}" depends on "${error.dependency}", which the platform does not ship`;
    case 'version-mismatch':
      return `"${error.key}" needs ${error.dependency} ${error.wanted}, `
        + `but the registry ships ${error.found}`;
    case 'incompatible':
      return `"${error.a}" cannot be installed alongside "${error.b}"`;
    case 'cycle':
      return `dependency cycle across ${error.keys.join(', ')}`;
  }
}

/**
 * What the parser cannot see: whether this install agrees with the registry
 * entry it names, and whether the artifact it points at is really there.
 */
function installProblems(
  tenantDir: string,
  install: TenantModuleInstall,
  index: number,
): string[] {
  const problems: string[] = [];
  const path = `modules[${index}]`;
  const definition = REGISTRY_BY_KEY.get(install.key);
  // An unknown key is resolution's error to report, with the dependency chain
  // that reached it; repeating it here would say the same thing twice.
  if (!definition) return problems;

  if (install.version !== definition.version) {
    problems.push(`${path}.version pins ${install.version}, `
      + `but the registry ships "${install.key}" at ${definition.version}`);
  }
  for (const surface of install.surfaces ?? []) {
    if (!definition.surfaces.includes(surface)) {
      problems.push(`${path}.surfaces names "${surface}", which "${install.key}" `
        + `does not serve (${definition.surfaces.join(', ')})`);
    }
  }
  // parseTenantModulesManifest validates the SHAPE of a config path -- relative,
  // no escape out of the tenant folder -- and stops there, because it takes raw
  // JSON and never sees the disk. A named artifact that does not exist is the
  // failure this catches.
  const configPath = install.config === null ? null : join(tenantDir, install.config);
  if (configPath !== null && !(existsSync(configPath) && statSync(configPath).isFile())) {
    problems.push(`${path}.config "${install.config}" is not a file in this tenant folder`);
  }
  return problems;
}

/** Validation problems from tenants/<slug>/modules.json, or [] when absent or valid. */
export function modulesManifestProblems(tenantDir: string): string[] {
  const path = join(tenantDir, 'modules.json');
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return ['modules.json must contain valid JSON.'];
  }
  const result = parseTenantModulesManifest(raw);
  if (result.kind !== 'ok') return result.issues.map((issue) => `modules.json: ${issue}`);

  const problems: string[] = [];
  result.manifest.modules.forEach((install, index) => {
    problems.push(...installProblems(tenantDir, install, index));
  });
  // Every declared key, not just the enabled ones: a disabled install still
  // pins a version and an artifact, and a tenant turning it back on must not
  // discover then that the key was never real.
  const resolution = resolveModules(
    MODULE_REGISTRY,
    result.manifest.modules.map((install) => install.key),
  );
  if (resolution.kind === 'failed') {
    problems.push(...resolution.errors.map(describeResolutionError));
  }
  return problems.map((problem) => `modules.json: ${problem}`);
}

/** Parses the desired module state after validation has reported no problems. */
export function readTenantModulesManifest(tenantDir: string): TenantModulesManifest {
  const path = join(tenantDir, 'modules.json');
  if (!existsSync(path)) return { schemaVersion: 1, modules: [] };
  const result = parseTenantModulesManifest(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (result.kind === 'invalid') {
    throw new Error(`Invalid modules.json: ${result.issues.join('; ')}`);
  }
  return result.manifest;
}
