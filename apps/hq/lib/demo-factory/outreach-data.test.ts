import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DemoFactoryDb } from './console-data';
import { demoLinkPath } from './link';
import {
  loadOutreachSites, outreachDay, outreachDrafts, outreachOrigin, outreachReadiness, outreachSender, outreachSiteFromPack,
} from './outreach-data';
import type { OutreachSite } from './outreach-draft';

const NOW = new Date('2026-09-18T12:00:00.000Z');
const SECRET = 's'.repeat(48);
const ENV = {
  DEMO_BUILDER_NAME: 'Northside Studio',
  DEMO_BUILDER_POSTAL_ADDRESS: '100 Market Street, Boulder, CO 80302',
  NEXT_PUBLIC_HQ_URL: 'https://hq.example.com/',
  DEMO_LINK_SECRET: SECRET,
};

describe('outreach settings', () => {
  it('needs both a name and a postal address before anyone is written to', () => {
    assert.deepEqual(outreachSender(ENV), { name: 'Northside Studio', postalAddress: '100 Market Street, Boulder, CO 80302' });
    assert.equal(outreachSender({ ...ENV, DEMO_BUILDER_POSTAL_ADDRESS: '  ' }), null);
    assert.equal(outreachSender({ ...ENV, DEMO_BUILDER_NAME: undefined }), null);
  });

  it('links to the configured https console, never a preview or a plain-http address', () => {
    assert.equal(outreachOrigin(ENV), 'https://hq.example.com');
    assert.equal(outreachOrigin({ NEXT_PUBLIC_HQ_URL: 'https://hq.example.com/console?x=1' }), 'https://hq.example.com');
    for (const value of ['http://hq.example.com', 'hq.example.com', 'not a url', '', undefined]) {
      assert.equal(outreachOrigin({ NEXT_PUBLIC_HQ_URL: value }), null, String(value));
    }
  });

  it('lists what is missing by name, and never a value', () => {
    assert.deepEqual(outreachReadiness(ENV).missing, []);
    const readiness = outreachReadiness({ DEMO_LINK_SECRET: 'short' });
    assert.deepEqual(readiness.missing,
      ['DEMO_BUILDER_NAME', 'DEMO_BUILDER_POSTAL_ADDRESS', 'NEXT_PUBLIC_HQ_URL', 'DEMO_LINK_SECRET']);
    assert.equal(readiness.linkSecret, null);
    assert.ok(!JSON.stringify(outreachReadiness(ENV).missing).includes(SECRET));
  });
});

describe('outreachDay', () => {
  it('accepts a real UTC day within the last fourteen', () => {
    assert.equal(outreachDay('2026-09-18', NOW), '2026-09-18');
    assert.equal(outreachDay('2026-09-05', NOW), '2026-09-05');
  });

  it('refuses a day outside the window, or one that is not a date at all', () => {
    for (const value of ['2026-09-04', '2026-09-19', '2026-02-30', '2026-9-18', '18/09/2026', '', null, 20260918]) {
      assert.equal(outreachDay(value, NOW), null, String(value));
    }
  });
});

type Read = { columns: string; filters: [string, string, unknown][]; order?: unknown; limit?: number };

function sitesDb(data: unknown, error: unknown = null) {
  const reads: Read[] = [];
  const db = {
    from: (table: string) => {
      assert.equal(table, 'platform_demo_sites');
      return {
        select: (columns: string) => {
          const read: Read = { columns, filters: [] };
          reads.push(read);
          const query = {
            gte: (column: string, value: unknown) => { read.filters.push(['gte', column, value]); return query; },
            lt: (column: string, value: unknown) => { read.filters.push(['lt', column, value]); return query; },
            order: (column: string, options: unknown) => { read.order = [column, options]; return query; },
            limit: async (count: number) => { read.limit = count; return { data, error }; },
          };
          return query;
        },
      };
    },
  };
  return { db: db as unknown as DemoFactoryDb, reads };
}

const ROW = {
  id: 'site-1', business_name: 'Harbor Roast', country_code: 'US', state: 'ready',
  expires_at: '2026-10-02T12:00:00.000Z', created_at: '2026-09-18T09:00:00.000Z',
  email: 'hello@harborroast.example', menu_source: 'website',
};

describe('loadOutreachSites', () => {
  it('reads the days asked for, with the address and menu source taken out of the pack by path', async () => {
    const { db, reads } = sitesDb([ROW, { ...ROW, id: '' }, 'junk']);
    const sites = await loadOutreachSites(db, '2026-09-05', '2026-09-18');
    assert.deepEqual(sites, [{
      id: 'site-1', businessName: 'Harbor Roast', email: 'hello@harborroast.example', countryCode: 'US',
      state: 'ready', expiresAt: '2026-10-02T12:00:00.000Z', createdAt: '2026-09-18T09:00:00.000Z', menuFromWebsite: true,
    }]);
    const [read] = reads;
    assert.match(read?.columns ?? '', /email:pack->brand->business->>email/);
    assert.match(read?.columns ?? '', /menu_source:pack->>menuSource/);
    assert.doesNotMatch(read?.columns ?? '', /(^|,)pack(,|$)/, 'never the whole pack');
    assert.deepEqual(read?.filters, [
      ['gte', 'created_at', '2026-09-05T00:00:00.000Z'],
      ['lt', 'created_at', '2026-09-19T00:00:00.000Z'],
    ]);
    assert.deepEqual(read?.order, ['created_at', { ascending: true }]);
  });

  it('fails rather than exporting a partial day', async () => {
    const failure = new Error('database unavailable');
    const { db } = sitesDb(null, failure);
    await assert.rejects(loadOutreachSites(db, '2026-09-18', '2026-09-18'), (error) => error === failure);
  });
});

describe('outreachDrafts', () => {
  const site = (overrides: Partial<OutreachSite>): OutreachSite => ({
    id: 'site-1', businessName: 'Harbor Roast', email: 'hello@harborroast.example', countryCode: 'US', state: 'ready',
    expiresAt: '2026-10-02T12:00:00.000Z', createdAt: '2026-09-18T09:00:00.000Z', menuFromWebsite: true, ...overrides,
  });

  it('drafts every site it can, links each to its own demo, and counts the rest by reason', () => {
    const sender = { name: 'Northside Studio', postalAddress: '100 Market Street' };
    const batch = outreachDrafts([
      site({ id: 'a' }), site({ id: 'b', email: null }), site({ id: 'c', countryCode: 'CA' }), site({ id: 'd' }),
    ], sender, 'https://hq.example.com', SECRET, NOW);
    assert.deepEqual(batch.drafts.map((draft) => draft.siteId), ['a', 'd']);
    assert.equal(batch.drafts[0]?.link, `https://hq.example.com${demoLinkPath(SECRET, 'a')}`);
    assert.notEqual(batch.drafts[0]?.link, batch.drafts[1]?.link);
    assert.deepEqual(batch.skipped, { not_ready: 0, outside_us: 1, no_email: 1, expiring: 0 });
  });
});

describe('outreachSiteFromPack', () => {
  it('reads the same facts out of a whole pack', () => {
    const { email, menu_source: menuSource, ...rest } = ROW;
    const site = outreachSiteFromPack({ ...rest, pack: { brand: { business: { email } }, menuSource } });
    assert.equal(site.email, 'hello@harborroast.example');
    assert.equal(site.menuFromWebsite, true);
    assert.equal(outreachSiteFromPack({ ...rest, pack: 'not a pack' }).email, null);
  });
});
