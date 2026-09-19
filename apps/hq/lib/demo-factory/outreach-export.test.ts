import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { DemoFactoryDb } from './console-data';
import { outreachExport, type OutreachExportDeps } from './outreach-export';

const HQ = 'https://hq.example.test';
const NOW = new Date('2026-09-18T12:00:00.000Z');
const CONTEXT = { actor: 'admin-1', requestId: 'req_test' };
const ENV = {
  DEMO_BUILDER_NAME: 'Northside Studio',
  DEMO_BUILDER_POSTAL_ADDRESS: '100 Market Street, Boulder, CO 80302',
  NEXT_PUBLIC_HQ_URL: 'https://hq.example.com',
  DEMO_LINK_SECRET: 's'.repeat(48),
};
const ROW = {
  id: 'site-1', business_name: 'Harbor Roast', country_code: 'US', state: 'ready',
  expires_at: '2026-10-02T12:00:00.000Z', created_at: '2026-09-18T09:00:00.000Z',
  email: 'hello@harborroast.example', menu_source: 'website',
};

function sitesDb(data: unknown, error: unknown = null): { db: DemoFactoryDb; reads: () => number } {
  let reads = 0;
  const query = {
    gte: () => query, lt: () => query, order: () => query,
    limit: async () => { reads += 1; return { data, error }; },
  };
  const db = { from: () => ({ select: () => query }) };
  return { db: db as unknown as DemoFactoryDb, reads: () => reads };
}

function deps(db: DemoFactoryDb | null, env: OutreachExportDeps['env'] = ENV): OutreachExportDeps {
  return { env, db: () => db, now: () => NOW };
}

function post(day: string): Request {
  return new Request(`${HQ}/api/demos/outreach`, { method: 'POST', body: new URLSearchParams({ day }) });
}

/** The log's JSON lines, kept off the test output and returned for inspection. */
function logs(t: TestContext): string[] {
  const lines: string[] = [];
  for (const level of ['info', 'warn', 'error'] as const) {
    t.mock.method(console, level, (line: unknown) => { lines.push(String(line)); });
  }
  return lines;
}

describe('outreachExport', () => {
  it('answers the day’s drafts as a CSV download that is never cached', async (t) => {
    const lines = logs(t);
    const response = await outreachExport(post('2026-09-18'), CONTEXT, deps(sitesDb([ROW, { ...ROW, id: 'site-2', email: null }]).db));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="demo-outreach-2026-09-18.csv"');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const csv = await response.text();
    assert.match(csv, /^"email","business_name"/);
    assert.match(csv, /"hello@harborroast\.example","Harbor Roast"/);
    assert.equal(csv.split('\r\n').filter(Boolean).length, 2, 'the header and the one site with an address');
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? '', /demo_factory\.outreach_exported/);
    assert.match(lines[0] ?? '', /"drafts":1/);
    assert.doesNotMatch(lines[0] ?? '', /@/, 'counts only, never an address');
  });

  function redirectedTo(response: Response): string | null {
    assert.equal(response.status, 303);
    return new URL(response.headers.get('location') ?? '', HQ).searchParams.get('error');
  }

  it('sends the operator back with a reason when a day is outside the window', async (t) => {
    logs(t);
    const fixture = sitesDb([ROW]);
    assert.equal(redirectedTo(await outreachExport(post('2026-08-01'), CONTEXT, deps(fixture.db))), 'invalid_day');
    assert.equal(fixture.reads(), 0);
  });

  it('writes nothing until the sender, the address, the console URL and the link secret are all set', async (t) => {
    logs(t);
    const fixture = sitesDb([ROW]);
    const env = { ...ENV, DEMO_BUILDER_POSTAL_ADDRESS: undefined };
    assert.equal(redirectedTo(await outreachExport(post('2026-09-18'), CONTEXT, deps(fixture.db, env))), 'not_ready');
    assert.equal(fixture.reads(), 0);
  });

  it('says so when the deployment has no database, or the read fails', async (t) => {
    const lines = logs(t);
    assert.equal(redirectedTo(await outreachExport(post('2026-09-18'), CONTEXT, deps(null))), 'unconfigured');
    const failing = sitesDb(null, new Error('database unavailable'));
    assert.equal(redirectedTo(await outreachExport(post('2026-09-18'), CONTEXT, deps(failing.db))), 'database');
    assert.match(lines.join('\n'), /demo_factory\.outreach_export_failed/);
  });
});
