/**
 * Read-only modules.json wiring for onboarding.
 *
 * While module installs are still declared per tenant on disk, onboarding's
 * validation phase is the one gate every tenant passes through -- so when
 * tenants/<slug>/modules.json exists, every parser issue becomes a validation
 * problem here. A tenant without the file is unaffected: nothing else reads
 * it yet, so its absence must not fail anyone.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseTenantModulesManifest } from '../packages/module-kit/src/modules-manifest';

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
  return result.kind === 'ok' ? [] : result.issues.map((issue) => `modules.json: ${issue}`);
}
