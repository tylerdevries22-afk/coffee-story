import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATION_FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
// Existing Coffee Story environments were reconciled through this migration.
// Every later migration must carry the stronger script-managed content record.
const LEGACY_HISTORY_BOUNDARY = '20260828104000';

export interface LocalMigration {
  readonly name: string;
  readonly query: string;
  readonly version: string;
}

export interface RemoteMigration {
  readonly name: string;
  readonly version: string;
}

interface ManagedMigration extends RemoteMigration {
  readonly statements: readonly string[];
}

export interface AdvisorNotice {
  readonly level: string;
  readonly name: string;
  readonly title: string;
}

export interface HostedMigrationConfig {
  readonly accessToken: string;
  readonly expectedReadiness: number;
  readonly fetchImpl?: typeof fetch;
  readonly migrationsDirectory: string;
  readonly projectRef: string;
  readonly retryDelayMs?: number;
}

export interface HostedMigrationSummary {
  readonly alignedVersions: readonly string[];
  readonly appliedVersions: readonly string[];
  readonly readiness: number;
  readonly remoteMigrationCount: number;
}

class HostedMigrationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'HostedMigrationError';
  }
}

export function parseMigrationFilename(filename: string): Pick<LocalMigration, 'name' | 'version'> {
  const match = MIGRATION_FILE_PATTERN.exec(filename);
  if (!match?.[1] || !match[2]) {
    throw new HostedMigrationError('invalid_migration_filename', `Invalid migration filename: ${filename}`);
  }
  return { version: match[1], name: match[2] };
}

export async function loadLocalMigrations(directory: string): Promise<readonly LocalMigration[]> {
  const filenames = (await readdir(directory)).filter((filename) => filename.endsWith('.sql')).sort();
  const migrations = await Promise.all(filenames.map(async (filename) => {
    const identity = parseMigrationFilename(filename);
    return { ...identity, query: await readFile(join(directory, filename), 'utf8') };
  }));
  const versions = new Set(migrations.map(({ version }) => version));
  if (versions.size !== migrations.length) {
    throw new HostedMigrationError('duplicate_migration_version', 'Local migration versions must be unique.');
  }
  return migrations;
}

export function planPendingMigrations(
  local: readonly LocalMigration[],
  remote: readonly RemoteMigration[],
): readonly LocalMigration[] {
  const localNames = new Set(local.map(({ name }) => name));
  const unknown = remote.find(({ name }) => !localNames.has(name));
  if (unknown) {
    throw new HostedMigrationError('remote_migration_unknown', `Remote migration ${unknown.name} is absent locally.`);
  }
  const remoteNames = new Set(remote.map(({ name }) => name));
  if (remoteNames.size !== remote.length) {
    throw new HostedMigrationError('duplicate_remote_migration', 'Remote migration names must be unique.');
  }
  const firstGap = local.findIndex(({ name }) => !remoteNames.has(name));
  if (firstGap < 0) return [];
  const outOfOrder = local.slice(firstGap + 1).find(({ name }) => remoteNames.has(name));
  if (outOfOrder) {
    throw new HostedMigrationError('remote_history_has_gap', `Remote history skips migration ${local[firstGap]?.name}.`);
  }
  return local.slice(firstGap);
}

export function migrationVersionAlignments(
  local: readonly LocalMigration[],
  remote: readonly RemoteMigration[],
): readonly LocalMigration[] {
  const remoteByName = new Map(remote.map((migration) => [migration.name, migration.version]));
  return local.filter(({ name, version }) => {
    const remoteVersion = remoteByName.get(name);
    return remoteVersion !== undefined && remoteVersion !== version;
  });
}

export function findBlockingAdvisors(notices: readonly AdvisorNotice[]): readonly AdvisorNotice[] {
  return notices.filter(({ level }) => ['WARN', 'WARNING', 'ERROR'].includes(level.toUpperCase()));
}

function asRecords(value: unknown, code: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== 'object')) {
    throw new HostedMigrationError(code, 'Supabase returned an unexpected response contract.');
  }
  return value as readonly Record<string, unknown>[];
}

function parseRemoteMigrations(value: unknown): readonly RemoteMigration[] {
  return asRecords(value, 'invalid_migration_history').map((entry) => {
    if (typeof entry.version !== 'string' || typeof entry.name !== 'string') {
      throw new HostedMigrationError('invalid_migration_history', 'Supabase migration history is malformed.');
    }
    return { version: entry.version, name: entry.name };
  });
}

function parseAdvisors(value: unknown): readonly AdvisorNotice[] {
  if (!value || typeof value !== 'object' || !('lints' in value)) {
    throw new HostedMigrationError('invalid_advisor_response', 'Supabase advisor response is malformed.');
  }
  return asRecords(value.lints, 'invalid_advisor_response').map((entry) => ({
    level: typeof entry.level === 'string' ? entry.level : 'ERROR',
    name: typeof entry.name === 'string' ? entry.name : 'unknown',
    title: typeof entry.title === 'string' ? entry.title : 'Unknown advisor finding',
  }));
}

function parseReadiness(value: unknown): number {
  const [row] = asRecords(value, 'invalid_readiness_response');
  const raw = row?.readiness;
  const readiness = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{14}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(readiness)) {
    throw new HostedMigrationError('invalid_readiness_response', 'Release readiness is unavailable.');
  }
  return readiness;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  retryDelayMs: number,
  attempts = 2,
): Promise<unknown> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (error: unknown) {
      if (attempt === attempts) throw error;
      await wait(retryDelayMs * attempt);
      continue;
    }
    const body = await response.text();
    if (response.ok) return body ? JSON.parse(body) as unknown : null;
    if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
      throw new HostedMigrationError('supabase_request_failed', `Supabase request failed with HTTP ${response.status}.`);
    }
    await wait(retryDelayMs * attempt);
  }
  throw new HostedMigrationError('supabase_request_failed', 'Supabase request failed.');
}

function apiRequest(
  config: HostedMigrationConfig,
  path: string,
  init: RequestInit = {},
  attempts = 2,
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${config.accessToken}`);
  headers.set('Content-Type', 'application/json');
  return requestJson(
    `https://api.supabase.com/v1/projects/${config.projectRef}${path}`,
    { ...init, headers },
    config.fetchImpl ?? fetch,
    config.retryDelayMs ?? 500,
    attempts,
  );
}

async function listRemoteMigrations(config: HostedMigrationConfig): Promise<readonly RemoteMigration[]> {
  return parseRemoteMigrations(await apiRequest(config, '/database/migrations'));
}

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

async function assertManagedMigrationContents(
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

async function applyMigration(config: HostedMigrationConfig, migration: LocalMigration): Promise<void> {
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

async function alignMigrationVersions(
  config: HostedMigrationConfig,
  local: readonly LocalMigration[],
  remote: readonly RemoteMigration[],
): Promise<readonly string[]> {
  const alignments = migrationVersionAlignments(local, remote);
  for (const migration of alignments) await alignMigrationVersion(config, migration);
  return alignments.map(({ version }) => version);
}

async function assertAdvisorsClear(config: HostedMigrationConfig): Promise<void> {
  for (const kind of ['security', 'performance']) {
    const notices = parseAdvisors(await apiRequest(config, `/advisors/${kind}`));
    const blocking = findBlockingAdvisors(notices);
    if (blocking.length > 0) {
      throw new HostedMigrationError('advisor_findings', `${kind} advisor reported ${blocking.length} blocking finding(s).`);
    }
  }
}

async function fetchReadiness(config: HostedMigrationConfig): Promise<number> {
  const result = await apiRequest(config, '/database/query', {
    method: 'POST',
    body: JSON.stringify({ query: 'select public.platform_release_readiness() as readiness' }),
  });
  return parseReadiness(result);
}

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
  if (readiness !== config.expectedReadiness) {
    throw new HostedMigrationError('release_not_ready', `Expected readiness ${config.expectedReadiness}, received ${readiness}.`);
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
