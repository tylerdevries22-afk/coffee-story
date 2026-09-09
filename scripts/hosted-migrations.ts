import { listRemoteMigrations } from './hosted-migration-api.js';
import {
  HostedMigrationError,
  PROJECT_REF_PATTERN,
  findBlockingAdvisors,
  loadLocalMigrations,
  migrationVersionAlignments,
  parseMigrationFilename,
  planPendingMigrations,
  type AdvisorNotice,
  type HostedMigrationConfig,
  type HostedMigrationSummary,
  type LocalMigration,
  type RemoteMigration,
} from './hosted-migration-model.js';
import {
  alignMigrationVersions,
  applyMigration,
  assertAdvisorsClear,
  assertManagedMigrationContents,
  fetchReadiness,
} from './hosted-migration-operations.js';

export {
  findBlockingAdvisors,
  loadLocalMigrations,
  migrationVersionAlignments,
  parseMigrationFilename,
  planPendingMigrations,
};
export type {
  AdvisorNotice,
  HostedMigrationConfig,
  HostedMigrationSummary,
  LocalMigration,
  RemoteMigration,
};

function validateConfig(config: HostedMigrationConfig): void {
  if (!config.accessToken) throw new HostedMigrationError('missing_access_token', 'SUPABASE_ACCESS_TOKEN is required.');
  if (!PROJECT_REF_PATTERN.test(config.projectRef)) {
    throw new HostedMigrationError('invalid_project_ref', 'SUPABASE_PROJECT_REF is invalid.');
  }
}

export async function runHostedMigrationPromotion(
  config: HostedMigrationConfig,
): Promise<HostedMigrationSummary> {
  validateConfig(config);
  const local = await loadLocalMigrations(config.migrationsDirectory);
  const latestVersion = local.at(-1)?.version;
  if (!latestVersion) {
    throw new HostedMigrationError('migration_history_empty', 'At least one local migration is required.');
  }
  const expectedReadiness = config.expectedReadiness ?? Number(latestVersion);
  if (!Number.isSafeInteger(expectedReadiness) || String(expectedReadiness) !== latestVersion) {
    throw new HostedMigrationError(
      'invalid_expected_readiness',
      'Release readiness must match the newest local migration version.',
    );
  }
  const before = await listRemoteMigrations(config);
  const pending = planPendingMigrations(local, before);
  const alignedVersions = [...await alignMigrationVersions(config, local, before)];
  for (const migration of pending) {
    await applyMigration(config, migration);
    const current = await listRemoteMigrations(config);
    alignedVersions.push(...await alignMigrationVersions(config, local, current));
  }
  const after = await listRemoteMigrations(config);
  if (planPendingMigrations(local, after).length > 0) {
    throw new HostedMigrationError('migration_verification_failed', 'Remote migration history is incomplete.');
  }
  if (migrationVersionAlignments(local, after).length > 0) {
    throw new HostedMigrationError('migration_alignment_failed', 'Remote migration versions do not match the repository.');
  }
  await assertManagedMigrationContents(config, local, after);
  await assertAdvisorsClear(config);
  const readiness = await fetchReadiness(config);
  if (readiness !== expectedReadiness) {
    throw new HostedMigrationError('release_not_ready', `Expected readiness ${expectedReadiness}, received ${readiness}.`);
  }
  return {
    alignedVersions: [...new Set(alignedVersions)],
    appliedVersions: pending.map(({ version }) => version),
    readiness,
    remoteMigrationCount: after.length,
  };
}

export function toStructuredError(error: unknown): { code: string; message: string } {
  if (error instanceof HostedMigrationError) return { code: error.code, message: error.message };
  return { code: 'hosted_migration_failed', message: error instanceof Error ? error.message : 'Unknown migration failure.' };
}
