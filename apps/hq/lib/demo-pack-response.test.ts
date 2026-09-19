import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { demoPackResponse } from './demo-pack-response';
import { fakeDemoDb } from './demo-site.test-support';
import { newDemoToken } from './demo-token';

const NOW = new Date('2026-09-18T12:00:00Z');
const BUILDER = { name: 'Acme Digital', contactHref: null };

function deps(overrides: Partial<Parameters<typeof demoPackResponse>[1]> = {}) {
  return { db: fakeDemoDb().db, builder: BUILDER, now: NOW, ...overrides };
}

const VALID_PACK = {
  brand: {
    schemaVersion: 1,
    organization: { kind: 'independent' },
    network: null,
    inheritance: { mode: 'standalone', sourceTenantSlug: null, revision: 1, overrides: [] },
    surfaces: ['customer'],
    providers: [],
    identity: {
      slug: 'harbor-roast', name: 'Harbor Roast', bundleId: 'com.harborroast.app', scheme: 'harborroast',
      kioskBundleId: 'com.harborroast.kiosk', kioskScheme: 'harborroast-kiosk', easProjectId: '', kioskEasProjectId: '',
    },
    tokens: {}, copy: {}, features: {},
  },
  menu: {
    categories: [{ id: 'c', title: 'C' }],
    items: [{ id: 'i', name: 'I', category: 'c', sizes: [{ slug: 'reg', priceCents: 350 }] }],
  },
  modules: { schemaVersion: 1, modules: [] },
  media: {},
};

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'site-1', state: 'ready', business_name: 'Harbor Roast',
    expires_at: '2027-01-01T00:00:00Z', pack: VALID_PACK, ...overrides,
  };
}

describe('demoPackResponse', () => {
  it('serves the exported pack for a ready, unexpired demo', async () => {
    const token = newDemoToken();
    const { db } = fakeDemoDb({ row: readyRow() });
    const outcome = await demoPackResponse(token, deps({ db }));
    assert.equal(outcome.kind, 'ok');
    assert.ok(outcome.kind === 'ok');
    assert.equal(outcome.pack.businessName, 'Harbor Roast');
    assert.equal(outcome.pack.removeHref, `/d/${token}/remove`);
  });

  it('checks the token shape before the configuration, and the configuration before the database', async () => {
    const { db, calls } = fakeDemoDb({ row: readyRow() });
    assert.equal((await demoPackResponse('not-a-token', deps({ db }))).kind, 'not_found');
    assert.equal((await demoPackResponse(newDemoToken(), deps({ db, builder: null }))).kind, 'unavailable');
    assert.equal((await demoPackResponse(newDemoToken(), deps({ db: null }))).kind, 'unavailable');
    assert.deepEqual(calls, [], 'none of the above should have touched the database');
  });

  it('reports not_found for an expired or removed demo, without leaking which', async () => {
    const expired = await demoPackResponse(newDemoToken(), deps({
      db: fakeDemoDb({ row: readyRow({ state: 'expired' }) }).db,
    }));
    const gone = await demoPackResponse(newDemoToken(), deps({ db: fakeDemoDb({ row: null }).db }));
    assert.equal(expired.kind, 'not_found');
    assert.equal(gone.kind, 'not_found');
  });

  it('reports not_found when the stored pack fails demoPackExport\'s own validation', async () => {
    const outcome = await demoPackResponse(newDemoToken(), deps({
      db: fakeDemoDb({ row: readyRow({ pack: { brand: {} } }) }).db,
    }));
    assert.equal(outcome.kind, 'not_found');
  });

  it('reports not_found, not a $0.00 item, for a pack whose only item has no priced size', async () => {
    // Pins the exact shape that broke this test the first time: dropping an
    // unpriced item (demo-pack-export.ts's itemOf) can empty the menu
    // entirely, and an empty menu is a pack demoPackExport refuses whole --
    // never a partial pack with a phantom free item.
    const unpriced = {
      ...VALID_PACK,
      menu: {
        categories: [{ id: 'c', title: 'C' }],
        items: [{ id: 'i', name: 'I', category: 'c', sizes: [] }],
      },
    };
    const outcome = await demoPackResponse(newDemoToken(), deps({
      db: fakeDemoDb({ row: readyRow({ pack: unpriced }) }).db,
    }));
    assert.equal(outcome.kind, 'not_found');
  });

  it('lets a database failure propagate for the route to turn into a 503', async () => {
    const { db } = fakeDemoDb({ selectError: { message: 'down' } });
    await assert.rejects(() => demoPackResponse(newDemoToken(), deps({ db })));
  });
});
