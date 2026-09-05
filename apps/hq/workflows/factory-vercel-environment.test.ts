import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  synchronizeVercelEnvironment,
  vercelRuntimeVariables,
  type VercelRuntimeVariable,
} from './factory-vercel-environment';

type Row = {
  id: string;
  key: string;
  value: string;
  target: string[];
  type: string;
};

const variable: VercelRuntimeVariable = {
  key: 'EXPO_PUBLIC_TENANT', value: 'tenant-one',
  target: ['production', 'preview'], type: 'plain',
};

function environmentClient(
  initial: Row[],
  mutate = true,
): {
  rows: Row[];
  writes: string[];
  headers: Record<string, string>;
  request: (url: RequestInfo | URL, init: RequestInit) => Promise<Response>;
} {
  const rows = structuredClone(initial);
  const writes: string[] = [];
  return {
    rows,
    writes,
    headers: { authorization: 'Bearer test' },
    request: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('teamId'), 'team_test');
      const method = init.method ?? 'GET';
      if (method === 'GET') return Response.json({ envs: rows });
      const body = JSON.parse(String(init.body)) as Row;
      writes.push(method);
      if (method === 'POST' && mutate) {
        rows.push({ ...body, id: `env_${rows.length + 1}` });
      } else if (method === 'PATCH' && mutate) {
        const id = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
        const row = rows.find((entry) => entry.id === id);
        if (row) Object.assign(row, body);
      }
      return Response.json({ created: true });
    },
  };
}

describe('vercelRuntimeVariables', () => {
  const secrets = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    CRON_SECRET: 'cron-secret',
    HEALTH_CHECK_TOKEN: 'health-token',
  };

  it('binds HQ tenant, database, and health identities to production and preview', () => {
    const variables = vercelRuntimeVariables('hq', 'tenant-one', secrets);
    assert.deepEqual(variables.map(({ key }) => key), [
      'TENANT', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
      'CRON_SECRET', 'HEALTH_CHECK_TOKEN',
    ]);
    assert.ok(variables.every(({ target }) => (
      target.join(',') === 'production,preview'
    )));
  });

  it('binds each application surface to its tenant and canonical HQ', () => {
    for (const surface of ['customer', 'operator', 'kiosk'] as const) {
      const values = Object.fromEntries(vercelRuntimeVariables(surface, 'tenant-one', secrets)
        .map(({ key, value }) => [key, value]));
      assert.equal(values.EXPO_PUBLIC_TENANT, 'tenant-one');
      assert.equal(values.EXPO_PUBLIC_SUPABASE_URL, secrets.SUPABASE_URL);
      assert.equal(values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, secrets.SUPABASE_PUBLISHABLE_KEY);
      assert.equal(values.EXPO_PUBLIC_API_URL, 'https://tenant-one-hq.vercel.app');
    }
    const display = Object.fromEntries(vercelRuntimeVariables('display', 'tenant-one', secrets)
      .map(({ key, value }) => [key, value]));
    assert.equal(display.TENANT, 'tenant-one');
    assert.equal(display.NEXT_PUBLIC_SUPABASE_URL, secrets.SUPABASE_URL);
    assert.equal(display.HQ_ORIGIN, 'https://tenant-one-hq.vercel.app');
  });
});

describe('synchronizeVercelEnvironment', () => {
  it('readback-verifies matching production and preview records without writes', async () => {
    const client = environmentClient([{
      id: 'env_1', key: variable.key, value: variable.value,
      target: ['production', 'preview'], type: variable.type,
    }]);
    await synchronizeVercelEnvironment('prj_test', 'teamId=team_test', [variable], client);
    assert.deepEqual(client.writes, []);
  });

  it('updates drift once and verifies the provider result', async () => {
    const client = environmentClient([{
      id: 'env_1', key: variable.key, value: 'wrong-tenant',
      target: ['production', 'preview'], type: variable.type,
    }]);
    await synchronizeVercelEnvironment('prj_test', 'teamId=team_test', [variable], client);
    assert.deepEqual(client.writes, ['PATCH']);
    assert.equal(client.rows[0]?.value, variable.value);
  });

  it('creates missing target records without network access', async () => {
    const client = environmentClient([]);
    await synchronizeVercelEnvironment('prj_test', 'teamId=team_test', [variable], {
      ...client, delay: async () => undefined,
    });
    assert.deepEqual(client.writes, ['POST', 'POST']);
    assert.deepEqual(client.rows.map(({ target }) => target), [['production'], ['preview']]);
  });

  it('fails closed when a provider write does not survive readback', async () => {
    const client = environmentClient([{
      id: 'env_1', key: variable.key, value: 'wrong-tenant',
      target: ['production', 'preview'], type: variable.type,
    }], false);
    await assert.rejects(
      synchronizeVercelEnvironment('prj_test', 'teamId=team_test', [variable], client),
      /verification failed/,
    );
  });

  it('rejects malformed and ambiguous expected records before mutation', async () => {
    const malformed = environmentClient([{
      id: 'env_1', key: variable.key, value: variable.value,
      target: ['production'], type: variable.type,
    }]);
    delete (malformed.rows[0] as Partial<Row>).value;
    await assert.rejects(
      synchronizeVercelEnvironment('prj_test', 'teamId=team_test', [variable], malformed),
      /unverifiable/,
    );
    const ambiguous = environmentClient([
      { id: 'env_1', key: variable.key, value: variable.value, target: ['production'], type: 'plain' },
      { id: 'env_2', key: variable.key, value: variable.value, target: ['production'], type: 'plain' },
    ]);
    await assert.rejects(
      synchronizeVercelEnvironment('prj_test', 'teamId=team_test', [variable], ambiguous),
      /ambiguous/,
    );
    assert.deepEqual([...malformed.writes, ...ambiguous.writes], []);
  });
});
