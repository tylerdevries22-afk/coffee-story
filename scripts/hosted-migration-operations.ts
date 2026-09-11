import {
  HostedMigrationError,
  LEGACY_HISTORY_BOUNDARY,
  findBlockingAdvisors,
  migrationVersionAlignments,
  type HostedMigrationConfig,
  type LocalMigration,
  type ManagedMigration,
  type RemoteMigration,
} from './hosted-migration-model.js';
import {
  apiRequest,
  asRecords,
  listRemoteMigrations,
  parseAdvisors,
  parseReadiness,
  wait,
} from './hosted-migration-api.js';

function migrationTransaction(migration: LocalMigration): string {
  const delimiter = `$platform_migration_${migration.version}$`;
  if (migration.query.includes(delimiter)) {
    throw new HostedMigrationError('migration_delimiter_collision', `Migration ${migration.version} contains its history delimiter.`);
  }
  return [
    'begin;',
    "select pg_advisory_xact_lock(hashtextextended('platform-hosted-migrations', 0));",
    'insert into supabase_migrations.schema_migrations',
    '(version, statements, name, created_by, idempotency_key)',
    `values ('${migration.version}', array[${delimiter}${migration.query}${delimiter}],`,
    `'${migration.name}', 'platform-management-api', '${migration.version}');`,
    migration.query,
    ';',
    'commit;',
  ].join('\n');
}

function parseManagedMigrations(value: unknown): readonly ManagedMigration[] {
  return asRecords(value, 'invalid_managed_migration_history').map((entry) => {
    if (
      typeof entry.version !== 'string'
      || typeof entry.name !== 'string'
      || !Array.isArray(entry.statements)
      || entry.statements.some((statement) => typeof statement !== 'string')
    ) {
      throw new HostedMigrationError(
        'invalid_managed_migration_history',
        'Managed Supabase migration history is malformed.',
      );
    }
    return { version: entry.version, name: entry.name, statements: entry.statements as string[] };
  });
}

export async function assertManagedMigrationContents(
  config: HostedMigrationConfig,
  local: readonly LocalMigration[],
  remote: readonly RemoteMigration[],
): Promise<void> {
  const query = [
    'select version, name, statements',
    'from supabase_migrations.schema_migrations',
    "where created_by = 'platform-management-api'",
    'order by version',
  ].join(' ');
  const managed = parseManagedMigrations(await apiRequest(config, '/database/query', {
    method: 'POST', body: JSON.stringify({ query, read_only: true }),
  }));
  const localByName = new Map(local.map((migration) => [migration.name, migration]));
  const managedByName = new Map(managed.map((migration) => [migration.name, migration]));
  for (const remote of managed) {
    const expected = localByName.get(remote.name);
    if (
      !expected
      || expected.version !== remote.version
      || remote.statements.length !== 1
      || remote.statements[0] !== expected.query
    ) {
      throw new HostedMigrationError(
        'managed_migration_content_drift',
        `Managed migration ${remote.name} differs from the immutable repository source.`,
      );
    }
  }
  const unverified = remote.find(({ name, version }) => (
    version > LEGACY_HISTORY_BOUNDARY
    && managedByName.get(name)?.version !== version
  ));
  if (unverified) {
    throw new HostedMigrationError(
      'unverified_migration_history',
      `Migration ${unverified.name} is newer than the trusted legacy boundary but has no immutable content record.`,
    );
  }
}

async function migrationWasApplied(config: HostedMigrationConfig, migration: LocalMigration): Promise<boolean> {
  const current = await listRemoteMigrations(config);
  return current.some(({ name, version }) => name === migration.name && version === migration.version);
}

export async function applyMigration(config: HostedMigrationConfig, migration: LocalMigration): Promise<void> {
  const headers = new Headers({ 'Idempotency-Key': migration.version });
  const request = () => apiRequest(config, '/database/query', {
    method: 'POST', headers, body: JSON.stringify({ query: migrationTransaction(migration) }),
  }, 1);
  try {
    await request();
  } catch (firstError: unknown) {
    if (await migrationWasApplied(config, migration)) return;
    await wait(config.retryDelayMs ?? 500);
    try {
      await request();
    } catch (secondError: unknown) {
      if (await migrationWasApplied(config, migration)) return;
      throw secondError instanceof Error ? secondError : firstError;
    }
  }
}

async function alignMigrationVersion(config: HostedMigrationConfig, migration: LocalMigration): Promise<void> {
  const query = [
    'update supabase_migrations.schema_migrations',
    `set version = '${migration.version}'`,
    `where name = '${migration.name}' and version is distinct from '${migration.version}'`,
  ].join(' ');
  await apiRequest(config, '/database/query', { method: 'POST', body: JSON.stringify({ query }) });
}

export async function alignMigrationVersions(
  config: HostedMigrationConfig,
  local: readonly LocalMigration[],
  remote: readonly RemoteMigration[],
): Promise<readonly string[]> {
  const alignments = migrationVersionAlignments(local, remote);
  for (const migration of alignments) await alignMigrationVersion(config, migration);
  return alignments.map(({ version }) => version);
}

export async function assertAdvisorsClear(config: HostedMigrationConfig): Promise<void> {
  for (const kind of ['security', 'performance']) {
    const notices = parseAdvisors(await apiRequest(config, `/advisors/${kind}`));
    const blocking = findBlockingAdvisors(notices);
    if (blocking.length > 0) {
      throw new HostedMigrationError('advisor_findings', `${kind} advisor reported ${blocking.length} blocking finding(s).`);
    }
  }
}

export async function fetchReadiness(config: HostedMigrationConfig): Promise<number> {
  try {
    const result = await apiRequest(config, '/database/query', {
      method: 'POST',
      body: JSON.stringify({ query: 'select public.platform_release_readiness() as readiness' }),
    });
    return parseReadiness(result);
  } catch (error: unknown) {
    if (error instanceof HostedMigrationError && error.code === 'supabase_request_failed') {
      throw new HostedMigrationError('release_readiness_query_failed', error.message);
    }
    throw error;
  }
}
