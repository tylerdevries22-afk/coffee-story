import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BoardTicketRow } from '@platform/schema';

import {
  boardLadderFrom, boardQueue, DEFAULT_BOARD_CONFIG, DEFAULT_TIER_LADDER,
  displayName, isDisplayableAppUrl, provenanceLabel, queuePositions, resolveBoardConfig,
  tierBySlug, tierFor, tierSlug, toEntry,
} from './board-display';
import { REWARD_TIERS } from './rules';

function ticket(over: Partial<BoardTicketRow> & { id: string }): BoardTicketRow {
  return {
    brand_id: 'b', location_id: 'l', daily_number: 1, guest_label: 'Sara D.',
    status: 'paid', fulfillment_type: 'pickup', channel: 'app',
    arrived_at: null, loyalty_tier: null, updated_at: '2026-08-23T10:00:00Z',
    ...over,
  };
}

describe('tierSlug', () => {
  it('is stable across a rename-safe key', () => {
    assert.equal(tierSlug('House Regular'), 'house-regular');
    assert.equal(tierSlug('First Sip'), 'first-sip');
  });

  it('folds accents rather than dropping the whole name', () => {
    assert.equal(tierSlug('Café Régulier'), 'cafe-regulier');
  });

  it('never emits leading, trailing or doubled separators', () => {
    assert.equal(tierSlug('  ★ Gold ★  '), 'gold');
    assert.equal(tierSlug('A -- B'), 'a-b');
  });
});

describe('boardLadderFrom', () => {
  it('carries the brand\'s own words rather than platform vocabulary', () => {
    const ladder = boardLadderFrom(REWARD_TIERS);
    assert.deepEqual(ladder.map((t) => t.label), REWARD_TIERS.map((t) => t.name));
  });

  it('is ascending and tone-ranked, whatever order the ladder was saved in', () => {
    const ladder = boardLadderFrom([
      { name: 'Top', minimumAnnualPoints: 900, pointsPerDollar: 12, description: '', perks: [] },
      { name: 'Base', minimumAnnualPoints: 0, pointsPerDollar: 10, description: '', perks: [] },
    ]);
    assert.deepEqual(ladder.map((t) => t.label), ['Base', 'Top']);
    assert.equal(ladder[0]?.tone, 'muted');
    assert.notEqual(ladder[1]?.tone, ladder[0]?.tone);
  });

  it('falls back to the shipped ladder rather than producing no rungs', () => {
    assert.deepEqual(boardLadderFrom([]), DEFAULT_TIER_LADDER);
  });
});

describe('tierFor', () => {
  it('returns the highest rung reached', () => {
    const ladder = boardLadderFrom(REWARD_TIERS);
    const top = ladder.at(-1);
    assert.ok(top);
    assert.equal(tierFor(top.minLifetimePoints, ladder)?.slug, top.slug);
  });

  it('says nothing below the first rung instead of badging everyone', () => {
    const ladder = [{
      slug: 'a', label: 'A', minLifetimePoints: 100, tone: 'muted' as const,
      color: null, icon: null,
    }];
    assert.equal(tierFor(99, ladder), null);
    assert.equal(tierFor(100, ladder)?.slug, 'a');
  });

  it('refuses nonsense input rather than badging on NaN', () => {
    assert.equal(tierFor(Number.NaN), null);
    assert.equal(tierFor(-1), null);
  });
});

describe('tierBySlug', () => {
  it('resolves what the SQL projection emitted', () => {
    assert.equal(tierBySlug('house-regular')?.label, 'House Regular');
  });

  it('is null for a slug the current ladder no longer has', () => {
    // A brand can drop a rung; tickets carrying the old slug must degrade to
    // an unbadged name rather than render an empty chip.
    assert.equal(tierBySlug('retired-rung'), null);
    assert.equal(tierBySlug(null), null);
  });
});

describe('isDisplayableAppUrl', () => {
  it('accepts an absolute https URL', () => {
    assert.ok(isDisplayableAppUrl('https://example.com/app'));
  });

  it('refuses every scheme a stranger should not be pointed at', () => {
    for (const bad of [
      'http://example.com', 'javascript:alert(1)', 'data:text/html,<h1>x',
      'file:///etc/passwd', '//example.com', 'example.com', '', 'https://',
    ]) {
      assert.ok(!isDisplayableAppUrl(bad), `${bad} must not be scannable`);
    }
  });
});

describe('resolveBoardConfig', () => {
  it('is private by default: no status badge until a brand opts in', () => {
    assert.equal(DEFAULT_BOARD_CONFIG.showGuestStatus, false);
    assert.equal(resolveBoardConfig(undefined).showGuestStatus, false);
    assert.equal(resolveBoardConfig({}).showGuestStatus, false);
  });

  it('reads the board block out of a whole brand_config', () => {
    const config = resolveBoardConfig({ tokens: {}, board: { showGuestStatus: true } });
    assert.equal(config.showGuestStatus, true);
  });

  it('drops a bad field without discarding the rest', () => {
    const config = resolveBoardConfig({
      board: { showGuestStatus: true, appUrl: 'javascript:alert(1)', maxLines: 'lots' },
    });
    assert.equal(config.showGuestStatus, true, 'the good field survives');
    assert.equal(config.appUrl, null, 'the dangerous one does not');
    assert.equal(config.maxLines, DEFAULT_BOARD_CONFIG.maxLines);
  });

  it('keeps the default ladder when every configured rung is malformed', () => {
    const config = resolveBoardConfig({ board: { tiers: [{ slug: 'x' }, 7, null] } });
    assert.deepEqual(config.ladder, DEFAULT_TIER_LADDER);
  });

  it('sorts a configured ladder ascending regardless of how it was written', () => {
    const config = resolveBoardConfig({
      board: {
        tiers: [
          { slug: 'gold', label: 'Gold', minLifetimePoints: 900 },
          { slug: 'base', label: 'Base', minLifetimePoints: 0 },
        ],
      },
    });
    assert.deepEqual(config.ladder.map((t) => t.slug), ['base', 'gold']);
  });

  it('bounds maxLines so a typo cannot ask for a thousand rows', () => {
    assert.equal(resolveBoardConfig({ board: { maxLines: 1000 } }).maxLines,
      DEFAULT_BOARD_CONFIG.maxLines);
    assert.equal(resolveBoardConfig({ board: { maxLines: 0 } }).maxLines,
      DEFAULT_BOARD_CONFIG.maxLines);
    assert.equal(resolveBoardConfig({ board: { maxLines: 12 } }).maxLines, 12);
  });
});

describe('provenanceLabel', () => {
  it('names the channel for an ordinary pickup', () => {
    assert.equal(provenanceLabel('kiosk', 'pickup'), 'via kiosk');
    assert.equal(provenanceLabel('pos', 'pickup'), 'via point of sale');
    assert.equal(provenanceLabel('app', 'pickup'), 'via the app');
    assert.equal(provenanceLabel('web', 'pickup'), 'via web');
  });

  it('lets fulfillment win, because nobody walks up for a delivery', () => {
    assert.equal(provenanceLabel('app', 'delivery'), 'for delivery');
    assert.equal(provenanceLabel('pos', 'curbside'), 'for curbside');
    assert.equal(provenanceLabel('web', 'catering'), 'for catering');
  });
});

describe('displayName', () => {
  it('leaves a name a wall can hold', () => {
    assert.equal(displayName('Sara D.'), 'Sara D.');
  });

  it('truncates rather than wrapping a long name into a second line', () => {
    const long = displayName('Bartholomew Winterbottom', 18);
    assert.equal(long.length, 18);
    assert.ok(long.endsWith('…'));
  });

  it('says nothing for a blank label instead of inventing "Guest"', () => {
    assert.equal(displayName(null), '');
    assert.equal(displayName('   '), '');
  });
});

describe('toEntry', () => {
  const config = { ...DEFAULT_BOARD_CONFIG, showGuestStatus: true };

  it('badges the tier the projection resolved', () => {
    const entry = toEntry(ticket({ id: '1', loyalty_tier: 'house-regular' }), config, 1);
    assert.equal(entry.tier?.label, 'House Regular');
  });

  it('withholds the badge entirely when the brand keeps status private', () => {
    const entry = toEntry(ticket({ id: '1', loyalty_tier: 'house-regular' }),
      { ...config, showGuestStatus: false }, 1);
    assert.equal(entry.tier, null);
  });

  it('withholds provenance when the brand turns the channel line off', () => {
    assert.equal(toEntry(ticket({ id: '1' }), { ...config, showChannel: false }, 1).provenance, null);
  });

  it('marks a ready ticket, which is what the board draws a check for', () => {
    assert.equal(toEntry(ticket({ id: '1', status: 'ready' }), config, null).ready, true);
    assert.equal(toEntry(ticket({ id: '1', status: 'paid' }), config, 1).ready, false);
  });
});

/**
 * The queue is the contract between two apps.
 *
 * A guest asks a barista "what number am I?" and the answer has to be the one
 * on the wall. `apps/operator` and `apps/display` both call this, over their
 * own row types, so there is exactly one definition of the line.
 */
describe('queuePositions', () => {
  const member = (id: string, status: BoardTicketRow['status'], n: number, at = '2026-08-23T10:00:00Z') =>
    ({ id, status, daily_number: n, updated_at: at });

  it('numbers the people still waiting, from one', () => {
    const positions = queuePositions([
      member('c', 'paid', 3),
      member('a', 'paid', 1),
      member('b', 'in_progress', 2),
    ]);
    assert.deepEqual([...positions.entries()].sort(), [['a', 1], ['b', 2], ['c', 3]]);
  });

  it('gives a ready order no number, because a check replaces it', () => {
    const positions = queuePositions([
      member('ready', 'ready', 1),
      member('waiting', 'paid', 2),
    ]);
    assert.equal(positions.get('ready'), null);
    assert.equal(positions.get('waiting'), 1, 'the line does not count people already served');
  });

  it('counts down as the orders ahead are finished', () => {
    // The whole point of a position: "3" has to become "2". Numbering off the
    // ticket number instead would have left a guest sitting on 3 all morning.
    const before = queuePositions([
      member('a', 'in_progress', 1), member('b', 'paid', 2), member('me', 'paid', 3),
    ]);
    assert.equal(before.get('me'), 3);
    const after = queuePositions([
      member('a', 'ready', 1), member('b', 'paid', 2), member('me', 'paid', 3),
    ]);
    assert.equal(after.get('me'), 2, 'the order ahead went ready, so the line got shorter');
  });

  it('is stable for one ticket regardless of what order the rows arrive in', () => {
    const rows = [member('a', 'paid', 1), member('b', 'paid', 2), member('c', 'paid', 3)];
    const forwards = queuePositions(rows);
    const backwards = queuePositions([...rows].reverse());
    assert.deepEqual([...forwards.entries()].sort(), [...backwards.entries()].sort());
  });

  it('is empty for an empty board rather than throwing', () => {
    assert.equal(queuePositions([]).size, 0);
  });
});

describe('boardQueue', () => {
  const config = { ...DEFAULT_BOARD_CONFIG, showGuestStatus: true };

  it('puts the ready orders at the top, where somebody is about to walk up', () => {
    const queue = boardQueue([
      ticket({ id: 'w1', status: 'paid', daily_number: 1 }),
      ticket({ id: 'r1', status: 'ready', daily_number: 5 }),
      ticket({ id: 'w2', status: 'in_progress', daily_number: 2 }),
    ], config);
    assert.deepEqual(queue.entries.map((e) => e.id), ['r1', 'w1', 'w2']);
    assert.deepEqual(queue.entries.map((e) => e.position), [null, 1, 2]);
  });

  it('uses one database-backed call-out with a name and generic fallback', () => {
    const queue = boardQueue([
      ticket({ id: 'number', daily_number: 47, guest_label: 'Sara D.' }),
      ticket({ id: 'name', daily_number: null, guest_label: '  Sara D.  ' }),
      ticket({ id: 'guest', daily_number: null, guest_label: ' ' }),
    ], config);
    assert.deepEqual(
      Object.fromEntries(queue.entries.map((entry) => [entry.id, entry.callout])),
      { number: '47', name: 'Sara D.', guest: 'Guest' },
    );
  });

  it('keeps the longest-ready order at the very top', () => {
    // Re-sorting finished tickets as newer ones land would move a guest's own
    // line while they are walking toward it.
    const queue = boardQueue([
      ticket({ id: 'new', status: 'ready', daily_number: 9, updated_at: '2026-08-23T10:05:00Z' }),
      ticket({ id: 'old', status: 'ready', daily_number: 2, updated_at: '2026-08-23T10:01:00Z' }),
    ], config);
    assert.deepEqual(queue.entries.map((e) => e.id), ['old', 'new']);
  });

  it('draws no column for a state the guest cannot act on', () => {
    const queue = boardQueue([
      ticket({ id: '1', status: 'picked_up' }),
      ticket({ id: '2', status: 'cancelled' }),
    ], config);
    // The view already excludes these; if one arrived it must not be numbered
    // into the line ahead of somebody who is actually waiting.
    assert.deepEqual(queue.entries.map((e) => e.position), [1, 2]);
  });

  it('states the overflow rather than clipping it silently', () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      ticket({ id: `t${i}`, status: 'paid', daily_number: i + 1 }));
    const queue = boardQueue(many, { ...config, maxLines: 5 });
    assert.equal(queue.entries.length, 5);
    assert.equal(queue.overflow, 9);
  });

  it('never cuts into the ready block, however long it runs', () => {
    // Those are the people being called up right now. Dropping one to honour
    // a line cap would hide the only row on the board somebody must act on.
    const rows = [
      ...Array.from({ length: 6 }, (_, i) =>
        ticket({ id: `r${i}`, status: 'ready', daily_number: i + 1, updated_at: `2026-08-23T10:0${i}:00Z` })),
      ...Array.from({ length: 6 }, (_, i) => ticket({ id: `w${i}`, status: 'paid', daily_number: 20 + i })),
    ];
    const queue = boardQueue(rows, { ...config, maxLines: 3 });
    assert.equal(queue.entries.filter((e) => e.ready).length, 6, 'every ready row survives the cap');
    assert.equal(queue.overflow, 6);
  });

  it('reports no overflow when the whole queue fits', () => {
    const queue = boardQueue([ticket({ id: '1' })], { ...config, maxLines: 9 });
    assert.equal(queue.overflow, 0);
  });

  it('is empty for an empty board', () => {
    assert.deepEqual(boardQueue([], config), { entries: [], overflow: 0 });
  });
});

/**
 * The badge is the one thing on the board a brand is likely to want to control
 * pixel by pixel: four rungs of one accent do not read as four rungs across a
 * room. So colour and mark are per-tier config, and the resolver has to be as
 * forgiving about them as it is about everything else — a typo in HQ must cost
 * a brand its colour, never a guest their badge.
 */
describe('tier colour and icon', () => {
  const withTiers = (tier: Record<string, unknown>) => resolveBoardConfig({
    board: { tiers: [{ slug: 'a', label: 'A', minLifetimePoints: 0, ...tier }] },
  }).ladder[0];

  it('takes an explicit hex so a ladder can read as a ladder', () => {
    assert.equal(withTiers({ color: '#B08D57' })?.color, '#B08D57');
  });

  it('falls back to the semantic tone on a malformed colour', () => {
    for (const bad of ['B08D57', '#GGG', 'red', '#B08D5', 42, null]) {
      const tier = withTiers({ color: bad });
      assert.equal(tier?.color, null, `${String(bad)} must not reach a style attribute`);
      assert.ok(tier?.tone, 'the rung keeps a tone to fall back to');
    }
  });

  it('carries a mark, and refuses a sentence dressed up as one', () => {
    assert.equal(withTiers({ icon: '★' })?.icon, '★');
    assert.equal(withTiers({ icon: '  ◆  ' })?.icon, '◆', 'trimmed');
    assert.equal(withTiers({ icon: 'Silver Status' })?.icon, null);
    assert.equal(withTiers({ icon: '' })?.icon, null);
  });

  it('counts a mark in graphemes, not code units', () => {
    // An emoji is two code units and one mark. Measuring `.length` would have
    // refused most of the marks anyone would actually pick.
    assert.equal(withTiers({ icon: '💎' })?.icon, '💎');
  });

  it('leaves both unset on a ladder derived from the earn tiers', () => {
    // A derived ladder inherits the token palette; explicit colour is a
    // decision a brand makes, not one this code makes for them.
    for (const tier of boardLadderFrom(REWARD_TIERS)) {
      assert.equal(tier.color, null);
      assert.equal(tier.icon, null);
    }
  });
});
