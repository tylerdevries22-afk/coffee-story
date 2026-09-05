import type { FactorySurface } from '@platform/factory';

import { createOrAdopt } from '../lib/provider-create';
import { providerFetch, providerJson } from './factory-runtime';

export type VercelRuntimeVariable = Readonly<{
  key: string;
  value: string;
  target: readonly ['production', 'preview'];
  type: 'plain' | 'encrypted';
}>;

type EnvironmentTarget = 'production' | 'preview';
type EnvironmentRow = {
  id: string; key: string; value: string; targets: readonly string[]; type: string;
};

type EnvironmentClient = Readonly<{
  headers: Record<string, string>; request?: typeof providerFetch;
  delay?: (milliseconds: number) => Promise<void>;
}>;

export function vercelRuntimeVariables(
  surface: FactorySurface,
  tenantSlug: string,
  secrets: Record<string, string>,
): VercelRuntimeVariable[] {
  const hqUrl = `https://${tenantSlug}-hq.vercel.app`;
  const values = surface === 'hq'
    ? {
        TENANT: tenantSlug,
        SUPABASE_URL: secrets.SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_URL: secrets.SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: secrets.SUPABASE_PUBLISHABLE_KEY,
        SUPABASE_SERVICE_ROLE_KEY: secrets.SUPABASE_SERVICE_ROLE_KEY,
        CRON_SECRET: secrets.CRON_SECRET,
        HEALTH_CHECK_TOKEN: secrets.HEALTH_CHECK_TOKEN,
      }
    : surface === 'display'
      ? {
          TENANT: tenantSlug, NEXT_PUBLIC_SUPABASE_URL: secrets.SUPABASE_URL,
          HQ_ORIGIN: hqUrl, DISPLAY_DEMO_MODE: '0',
          DISPLAY_DEVICE_TOKEN: secrets.DISPLAY_DEVICE_TOKEN,
          DISPLAY_DEVICE_REFRESH_SECRET: secrets.DISPLAY_DEVICE_REFRESH_SECRET,
        }
      : {
          EXPO_PUBLIC_TENANT: tenantSlug,
          EXPO_PUBLIC_SUPABASE_URL: secrets.SUPABASE_URL,
          EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secrets.SUPABASE_PUBLISHABLE_KEY,
          EXPO_PUBLIC_API_URL: hqUrl,
          EXPO_PUBLIC_ALLOWED_API_HOST: `${tenantSlug}-hq.vercel.app`,
        };
  return Object.entries(values).flatMap(([key, value]) => value ? [{
    key, value, target: ['production', 'preview'] as const,
    type: key.includes('SERVICE_ROLE') || key === 'CRON_SECRET' || key === 'HEALTH_CHECK_TOKEN'
      || key.startsWith('DISPLAY_DEVICE_') ? 'encrypted' as const : 'plain' as const,
  }] : []);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function targets(value: unknown): readonly string[] | null {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string')
    ? value : null;
}

function environmentRow(value: unknown): EnvironmentRow | null {
  const row = record(value);
  const rowTargets = targets(row?.target);
  const custom = row?.customEnvironmentIds;
  if (!row || typeof row.id !== 'string' || typeof row.key !== 'string'
    || typeof row.value !== 'string' || !rowTargets || typeof row.type !== 'string'
    || (row.gitBranch !== undefined && row.gitBranch !== null)
    || (custom !== undefined && (!Array.isArray(custom) || custom.length > 0))) return null;
  return { id: row.id, key: row.key, value: row.value, targets: rowTargets, type: row.type };
}

function endpoint(projectId: string, scopeQuery: string, suffix = '', decrypt = false): string {
  const query = new URLSearchParams(scopeQuery);
  if (decrypt) query.set('decrypt', 'true');
  return `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env${suffix}?${query}`;
}

async function readEnvironment(
  projectId: string,
  scopeQuery: string,
  expectedKeys: ReadonlySet<string>,
  client: EnvironmentClient,
): Promise<EnvironmentRow[]> {
  const request = client.request ?? providerFetch;
  const response = await request(endpoint(projectId, scopeQuery, '', true), { headers: client.headers });
  const payload = await providerJson<{ envs?: unknown }>(response, 'Vercel environment lookup');
  if (!Array.isArray(payload.envs)) throw new Error('Vercel environment lookup returned an invalid response.');
  return payload.envs.flatMap((value) => {
    const raw = record(value);
    if (typeof raw?.key !== 'string' || !expectedKeys.has(raw.key)) return [];
    const parsed = environmentRow(value);
    if (!parsed) throw new Error(`Vercel environment returned an unverifiable ${raw.key} record.`);
    return [parsed];
  });
}

function selectedRow(
  rows: readonly EnvironmentRow[],
  key: string,
  target: EnvironmentTarget,
): EnvironmentRow | null {
  const candidates = rows.filter((row) => row.key === key && row.targets.includes(target));
  if (candidates.some((row) => row.targets.some((entry) => entry !== 'production' && entry !== 'preview'))) {
    throw new Error(`Vercel environment has unsafe ${key} target coverage.`);
  }
  if (candidates.length > 1) throw new Error(`Vercel environment has ambiguous ${key} ${target} records.`);
  return candidates[0] ?? null;
}

async function createVariable(
  projectId: string,
  scopeQuery: string,
  variable: VercelRuntimeVariable,
  target: EnvironmentTarget,
  expectedKeys: ReadonlySet<string>,
  client: EnvironmentClient,
): Promise<void> {
  const request = client.request ?? providerFetch;
  const lookup = async () => selectedRow(
    await readEnvironment(projectId, scopeQuery, expectedKeys, client), variable.key, target,
  ) ? true : null;
  await createOrAdopt(
    `Vercel ${variable.key} ${target} environment variable`,
    async () => {
      const response = await request(endpoint(projectId, scopeQuery), {
        method: 'POST', headers: client.headers,
        body: JSON.stringify({ ...variable, target: [target] }),
      });
      if (!response.ok) throw new Error(`Vercel environment create failed for ${variable.key}.`);
      return true;
    },
    lookup,
    { delay: client.delay },
  );
}

async function updateVariable(
  projectId: string,
  scopeQuery: string,
  variable: VercelRuntimeVariable,
  row: EnvironmentRow,
  client: EnvironmentClient,
): Promise<void> {
  const request = client.request ?? providerFetch;
  const response = await request(endpoint(
    projectId, scopeQuery, `/${encodeURIComponent(row.id)}`,
  ), {
    method: 'PATCH', headers: client.headers,
    body: JSON.stringify({ key: variable.key, value: variable.value, type: variable.type, target: row.targets }),
  }, true);
  if (!response.ok) throw new Error(`Vercel environment update failed for ${variable.key}.`);
}

function verifyEnvironment(
  rows: readonly EnvironmentRow[], variables: readonly VercelRuntimeVariable[],
): void {
  for (const variable of variables) {
    for (const target of variable.target) {
      const row = selectedRow(rows, variable.key, target);
      if (!row || row.value !== variable.value || row.type !== variable.type) {
        throw new Error(`Vercel environment verification failed for ${variable.key} ${target}.`);
      }
    }
  }
}

/** Reconciles both runtime targets and trusts only a decrypted provider readback. */
export async function synchronizeVercelEnvironment(
  projectId: string,
  scopeQuery: string,
  variables: readonly VercelRuntimeVariable[],
  client: EnvironmentClient,
): Promise<void> {
  const expectedKeys = new Set(variables.map((variable) => variable.key));
  const rows = await readEnvironment(projectId, scopeQuery, expectedKeys, client);
  const updated = new Set<string>();
  for (const variable of variables) {
    for (const target of variable.target) {
      const row = selectedRow(rows, variable.key, target);
      if (!row) await createVariable(projectId, scopeQuery, variable, target, expectedKeys, client);
      else if ((row.value !== variable.value || row.type !== variable.type) && !updated.has(row.id)) {
        await updateVariable(projectId, scopeQuery, variable, row, client);
        updated.add(row.id);
      }
    }
  }
  verifyEnvironment(await readEnvironment(projectId, scopeQuery, expectedKeys, client), variables);
}
