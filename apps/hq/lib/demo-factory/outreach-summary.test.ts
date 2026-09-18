import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OutreachSite } from './outreach-draft';
import { outreachDaySummaries, outreachRange, outreachWindow } from './outreach-summary';

const NOW = new Date('2026-09-18T12:00:00.000Z');

function site(createdAt: string, overrides: Partial<OutreachSite> = {}): OutreachSite {
  return {
    id: createdAt, businessName: 'Harbor Roast', email: 'hello@harborroast.example', countryCode: 'US',
    state: 'ready', expiresAt: '2026-10-02T12:00:00.000Z', createdAt, menuFromWebsite: true, ...overrides,
  };
}

describe('outreachWindow', () => {
  it('is today and the thirteen days before it, newest first', () => {
    const days = outreachWindow(NOW);
    assert.equal(days.length, 14);
    assert.equal(days[0], '2026-09-18');
    assert.equal(days[13], '2026-09-05');
    assert.deepEqual(outreachRange(NOW), { from: '2026-09-05', to: '2026-09-18' });
  });

  it('turns over at midnight UTC, not at the server’s midnight', () => {
    assert.equal(outreachWindow(new Date('2026-09-18T23:59:59.999Z'))[0], '2026-09-18');
    assert.equal(outreachWindow(new Date('2026-09-19T00:00:00.000Z'))[0], '2026-09-19');
  });
});

describe('outreachDaySummaries', () => {
  it('counts each day’s demos, its drafts, and why the rest have none', () => {
    const summaries = outreachDaySummaries([
      site('2026-09-18T09:00:00.000Z'),
      site('2026-09-18T09:05:00.000Z', { email: null }),
      site('2026-09-18T09:10:00.000Z', { state: 'building' }),
      site('2026-09-17T23:59:00.000Z'),
      site('2026-09-01T09:00:00.000Z'),
    ], NOW);
    assert.equal(summaries.length, 14);
    assert.deepEqual(summaries[0], {
      day: '2026-09-18', built: 3, drafts: 1, skipped: { not_ready: 1, outside_us: 0, no_email: 1, expiring: 0 },
    });
    assert.equal(summaries[1]?.drafts, 1);
    assert.deepEqual(summaries[2], {
      day: '2026-09-16', built: 0, drafts: 0, skipped: { not_ready: 0, outside_us: 0, no_email: 0, expiring: 0 },
    });
    assert.equal(summaries.reduce((total, day) => total + day.built, 0), 4, 'a demo from before the window is not counted');
  });
});
