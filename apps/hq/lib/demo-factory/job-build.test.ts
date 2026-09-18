import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PlacesError, type PlaceDetails } from '@platform/engine';

import { buildDemoJob, websiteHost, type ClaimedDemoJob, type DemoJobDeps, type DemoKitReader } from './job-build';
import type { DemoBrandKit } from './kit';
import { demoLinkHash, demoLinkToken } from './link';
import { CAFE, fakeRunnerDb, type RunnerScript } from './runner.test-support';

const SECRET = 'k'.repeat(48);
const SITE = '0f8e3c52-2b1d-4a6e-9c7f-5d4b3a291e10';
const JOB: ClaimedDemoJob = { id: 'j1', batchId: 'b1', placeId: CAFE.placeId, attempt: 1, createdBy: 'u1' };
const signal = new AbortController().signal;

// Invented placeholder name, never a real brand -- see originality.test.ts.
const DENIED_NAME = 'Rivalbrew';

function setup(script: RunnerScript = {}, overrides: Partial<DemoJobDeps> = {}) {
  const { db, calls } = fakeRunnerDb(script);
  let lookups = 0;
  const deps: DemoJobDeps = {
    db,
    details: async () => { lookups += 1; return CAFE; },
    readKit: null,
    linkSecret: SECRET,
    newSiteId: () => SITE,
    originalityDenylist: [DENIED_NAME],
    ...overrides,
  };
  return { deps, calls, lookups: () => lookups };
}

async function quietly<T>(body: () => Promise<T>): Promise<T> {
  const [error, warn] = [console.error, console.warn];
  console.error = () => {};
  console.warn = () => {};
  try {
    return await body();
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

function inserted(calls: ReturnType<typeof setup>['calls'], table: string): Record<string, unknown>[] {
  return calls.filter((call) => call.kind === 'insert' && call.target === table)
    .map((call) => call.args[0] as Record<string, unknown>);
}

describe('buildDemoJob', () => {
  it('skips a business that asked to be left alone, or already has a demo, before paying for anything', async () => {
    const suppressed = setup({ select: { platform_demo_suppressions: { data: [{ kind: 'google_place' }] } } });
    assert.deepEqual(await buildDemoJob(JOB, suppressed.deps, signal), { state: 'skipped', outcome: 'suppressed' });
    const live = setup({ select: { platform_demo_sites: { data: [{ id: 'other' }] } } });
    assert.deepEqual(await buildDemoJob(JOB, live.deps, signal), { state: 'skipped', outcome: 'already_live' });
    assert.equal(suppressed.lookups() + live.lookups(), 0);
  });

  it('builds a demo: one lookup on the ledger, and a site whose link only the server can derive', async () => {
    const { deps, calls } = setup();
    assert.deepEqual(await buildDemoJob(JOB, deps, signal), { state: 'built', siteId: SITE });
    assert.deepEqual(inserted(calls, 'platform_demo_costs'), [{
      batch_id: 'b1', job_id: 'j1', provider: 'google_places', sku: 'place_details_enterprise',
      model: null, quantity: 1, cost_microusd: 20_000,
    }]);
    const [site] = inserted(calls, 'platform_demo_sites');
    assert.equal(site?.id, SITE);
    assert.equal(site?.token_hash, demoLinkHash(SECRET, SITE));
    assert.equal(site?.website_host, 'harborroast.example');
    assert.equal(site?.country_code, 'US');
    assert.equal(site?.state, 'ready');
    assert.equal(site?.created_by, 'u1');
    assert.equal((site?.pack as { menuSource?: string }).menuSource, 'sample');
    assert.equal(JSON.stringify(calls).includes(demoLinkToken(SECRET, SITE)), false, 'the link itself was stored');
  });

  it('sets aside a business that is closed or abroad, with its lookup still on the ledger', async () => {
    for (const [place, outcome] of [
      [{ ...CAFE, businessStatus: 'CLOSED_PERMANENTLY' }, 'closed'],
      [{ ...CAFE, address: { ...CAFE.address, country: 'CA' } }, 'outside_us'],
    ] as const) {
      const { deps, calls } = setup({}, { details: async () => place as PlaceDetails });
      assert.deepEqual(await buildDemoJob(JOB, deps, signal), { state: 'skipped', outcome });
      assert.equal(inserted(calls, 'platform_demo_costs').length, 1);
      assert.equal(inserted(calls, 'platform_demo_sites').length, 0);
    }
  });

  it('retries what may pass, stops what cannot, and books nothing for a failed lookup', async () => {
    const cases = [
      [new PlacesError('over_quota'), { state: 'queued', outcome: 'places_quota' }],
      [new PlacesError('provider'), { state: 'queued', outcome: 'places_error' }],
      [new PlacesError('not_found'), { state: 'skipped', outcome: 'place_not_found' }],
      [new PlacesError('unconfigured'), { state: 'failed', outcome: 'places_unconfigured' }],
      [new Error('socket hang up'), { state: 'queued', outcome: 'places_error' }],
    ] as const;
    for (const [error, expected] of cases) {
      const { deps, calls } = setup({}, { details: async () => { throw error; } });
      assert.deepEqual(await buildDemoJob(JOB, deps, signal), expected);
      assert.equal(inserted(calls, 'platform_demo_costs').length, 0);
    }
  });

  it('reads the website into the demo under the new site, booking what the reading spends', async () => {
    const kit: DemoBrandKit = {
      colors: [], tagline: null, email: null, logo: null,
      menu: [
        { name: 'Latte', description: null, priceCents: 525, category: 'Coffee', image: null },
        { name: 'Mocha', description: null, priceCents: 575, category: 'Coffee', image: null },
        { name: 'Scone', description: null, priceCents: 350, category: 'Bakery', image: null },
      ],
    };
    const seen: unknown[] = [];
    const readKit: DemoKitReader = async (input) => {
      seen.push([input.website, input.siteId, input.businessName]);
      await input.book({ provider: 'openai', sku: 'output_tokens', model: 'gpt-5-nano', quantity: 3_000 });
      return kit;
    };
    const { deps, calls } = setup({}, { readKit });
    assert.equal((await buildDemoJob(JOB, deps, signal)).state, 'built');
    assert.deepEqual(seen, [['https://www.harborroast.example/', SITE, 'Harbor Roast']]);
    assert.deepEqual(inserted(calls, 'platform_demo_costs').map((row) => [row.sku, row.cost_microusd]),
      [['place_details_enterprise', 20_000], ['output_tokens', 1_200]]);
    assert.equal((inserted(calls, 'platform_demo_sites')[0]?.pack as { menuSource?: string }).menuSource, 'website');
  });

  it('still builds from the listing when the website cannot be read', async () => {
    const { deps, calls } = setup({}, { readKit: async () => { throw new Error('site down'); } });
    assert.equal((await quietly(() => buildDemoJob(JOB, deps, signal))).state, 'built');
    assert.equal((inserted(calls, 'platform_demo_sites')[0]?.pack as { menuSource?: string }).menuSource, 'sample');
  });

  it('reads what the database refused, and clears images a refused site left behind', async () => {
    const kit = async () => ({ colors: [], tagline: null, email: null, logo: 'logo.webp', menu: [] });
    const cases = [
      [{ code: '23505', message: 'duplicate key' }, { state: 'skipped', outcome: 'already_live' }],
      [{ code: '23514', message: 'this business asked not to be demoed' }, { state: 'skipped', outcome: 'suppressed' }],
      [{ code: '23514', message: 'violates check constraint' }, { state: 'failed', outcome: 'invalid_pack' }],
      [{ code: '08006', message: 'connection failure' }, { state: 'queued', outcome: 'database' }],
    ] as const;
    for (const [error, expected] of cases) {
      const { deps, calls } = setup({ insert: { platform_demo_sites: { error } }, listed: [{ name: 'logo.webp' }] },
        { readKit: kit });
      assert.deepEqual(await quietly(() => buildDemoJob(JOB, deps, signal)), expected);
      assert.deepEqual(calls.find((call) => call.kind === 'remove')?.args, [[`${SITE}/logo.webp`]]);
    }
  });

  it('refuses a pack that names someone on the denylist, and never publishes it', async () => {
    const { deps, calls } = setup({}, { details: async () => ({ ...CAFE, name: `${DENIED_NAME} Coffee` }) });
    const logged: string[] = [];
    const original = console.warn;
    console.warn = (line: string) => { logged.push(line); };
    let outcome: Awaited<ReturnType<typeof buildDemoJob>>;
    try {
      outcome = await buildDemoJob(JOB, deps, signal);
    } finally {
      console.warn = original;
    }
    assert.deepEqual(outcome, { state: 'skipped', outcome: 'originality' });
    assert.equal(inserted(calls, 'platform_demo_sites').length, 0, 'a refused pack is never published');
    assert.equal(inserted(calls, 'platform_demo_costs').length, 1, 'the lookup already made still costs money');

    assert.equal(logged.length, 1);
    const line = JSON.parse(logged[0] ?? '{}') as { event: string; fields: string[]; hits: number };
    assert.equal(line.event, 'demo_factory.originality_hit');
    assert.deepEqual(line.fields, ['businessName']);
    assert.equal(line.hits, 1);
    assert.equal(logged[0]?.includes(DENIED_NAME), false, 'the matched name never reaches the log, only the field and count');
  });

  it('clears a kit\'s uploaded media when its pack is refused for originality, same as any other refusal', async () => {
    const kit = async () => ({ colors: [], tagline: null, email: null, logo: 'logo.webp', menu: [] });
    const { deps, calls } = setup({ listed: [{ name: 'logo.webp' }] },
      { readKit: kit, details: async () => ({ ...CAFE, name: `${DENIED_NAME} Coffee` }) });
    assert.deepEqual(await quietly(() => buildDemoJob(JOB, deps, signal)), { state: 'skipped', outcome: 'originality' });
    assert.deepEqual(calls.find((call) => call.kind === 'remove')?.args, [[`${SITE}/logo.webp`]]);
  });

  it('never refuses a pack when the denylist is empty -- the kill switch is what stops that run entirely', async () => {
    const { deps } = setup({}, { details: async () => ({ ...CAFE, name: `${DENIED_NAME} Coffee` }), originalityDenylist: [] });
    assert.equal((await buildDemoJob(JOB, deps, signal)).state, 'built');
  });
});

describe('websiteHost', () => {
  it('keys a site the way the suppression list does', () => {
    assert.equal(websiteHost('https://WWW.Harbor-Roast.example/menu'), 'harbor-roast.example');
    assert.equal(websiteHost(null), null);
    assert.equal(websiteHost('not a url'), null);
    assert.equal(websiteHost('https://localhost/'), null);
  });
});
