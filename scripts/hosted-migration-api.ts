import {
  HostedMigrationError,
  RETRYABLE_STATUS,
  type AdvisorNotice,
  type HostedMigrationConfig,
  type RemoteMigration,
} from './hosted-migration-model.js';

export function asRecords(value: unknown, code: string): readonly Record<string, unknown>[] {
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

export function parseAdvisors(value: unknown): readonly AdvisorNotice[] {
  if (!value || typeof value !== 'object' || !('lints' in value)) {
    throw new HostedMigrationError('invalid_advisor_response', 'Supabase advisor response is malformed.');
  }
  return asRecords(value.lints, 'invalid_advisor_response').map((entry) => ({
    level: typeof entry.level === 'string' ? entry.level : 'ERROR',
    name: typeof entry.name === 'string' ? entry.name : 'unknown',
    title: typeof entry.title === 'string' ? entry.title : 'Unknown advisor finding',
  }));
}

export function parseReadiness(value: unknown): number {
  const [row] = asRecords(value, 'invalid_readiness_response');
  const raw = row?.readiness;
  const readiness = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{14}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(readiness)) {
    throw new HostedMigrationError('invalid_readiness_response', 'Release readiness is unavailable.');
  }
  return readiness;
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  retryDelayMs: number,
  attempts = 2,
  requestLabel = 'API',
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
      throw new HostedMigrationError(
        'supabase_request_failed',
        `Supabase ${requestLabel} request failed with HTTP ${response.status}.`,
      );
    }
    await wait(retryDelayMs * attempt);
  }
  throw new HostedMigrationError('supabase_request_failed', 'Supabase request failed.');
}

export function apiRequest(
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
    path,
  );
}

export async function listRemoteMigrations(config: HostedMigrationConfig): Promise<readonly RemoteMigration[]> {
  return parseRemoteMigrations(await apiRequest(config, '/database/migrations'));
}
