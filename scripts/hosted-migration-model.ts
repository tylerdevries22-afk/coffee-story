import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATION_FILE_PATTERN = /^(\d{14})_([a-z0-9_]+)\.sql$/;
export const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
// Existing Coffee Story environments were reconciled through this migration.
// Every later migration must carry the stronger script-managed content record.
export const LEGACY_HISTORY_BOUNDARY = '20260828104000';

export interface LocalMigration {
  readonly name: string;
  readonly query: string;
  readonly version: string;
}

export interface RemoteMigration {
  readonly name: string;
  readonly version: string;
}

export interface ManagedMigration extends RemoteMigration {
  readonly statements: readonly string[];
}

export interface AdvisorNotice {
  readonly level: string;
  readonly name: string;
  readonly title: string;
}

export interface HostedMigrationConfig {
  readonly accessToken: string;
  readonly expectedReadiness?: number;
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

export class HostedMigrationError extends Error {
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
