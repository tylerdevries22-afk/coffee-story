import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { TenantModulesManifest } from '../packages/module-kit/src/modules-manifest.js';
import { MODULE_REGISTRY } from '../packages/module-kit/src/registry.js';

/**
 * Reconciles the complete modules.json desired state in one database transaction.
 * The database RPC owns transaction locking and disabling omitted modules, so
 * replaying the same canonical desired state is safe. The stable hash is
 * returned for logs and tests; it is not used as a substitute for DB locking.
 */
export type ModuleReconciliation = {
  readonly idempotencyKey: string;
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry)]));
}

function readConfig(tenantDir: string, path: string | null): Record<string, unknown> {
  if (path === null) return {};
  const value: unknown = JSON.parse(readFileSync(join(tenantDir, path), 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Module config ${path} must contain one JSON object.`);
  }
  return value as Record<string, unknown>;
}

export async function reconcileTenantModules(
  db: SupabaseClient,
  brandId: string,
  tenantDir: string,
  manifest: TenantModulesManifest,
): Promise<ModuleReconciliation> {
  const registry = new Map(MODULE_REGISTRY.map((definition) => [definition.key, definition]));
  const modules = [...manifest.modules]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((install) => {
      const definition = registry.get(install.key);
      if (!definition) throw new Error(`Module ${install.key} is not registered.`);
      return {
        key: install.key,
        version: install.version,
        enabled: install.enabled,
        config_schema_version: definition.configSchemaVersion,
        config: readConfig(tenantDir, install.config),
        surfaces: install.surfaces,
      };
    });
  const canonical = JSON.stringify(stable({ schemaVersion: manifest.schemaVersion, modules }));
  const idempotencyKey = createHash('sha256').update(canonical).digest('hex');
  const result = await db.rpc('reconcile_brand_modules', {
    p_brand_id: brandId,
    p_modules: modules,
  });
  if (result.error) {
    throw new Error(`Could not reconcile tenant modules: ${result.error.message}`);
  }
  return {
    idempotencyKey,
    enabled: modules.filter((module) => module.enabled).map((module) => module.key),
    disabled: modules.filter((module) => !module.enabled).map((module) => module.key),
  };
}
