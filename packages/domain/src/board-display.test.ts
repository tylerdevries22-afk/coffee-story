import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BoardTicketRow } from '@platform/schema';

import {
  boardColumns, boardLadderFrom, capColumn, DEFAULT_BOARD_CONFIG, DEFAULT_TIER_LADDER,
  displayName, isDisplayableAppUrl, provenanceLabel, reconcileBoard, resolveBoardConfig,
  tierBySlug, tierFor, tierSlug, toEntry, type BoardSlot,
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
    const ladder = [{ slug: 'a', label: 'A', minLifetimePoints: 100, tone: 'muted' as const }];
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
      board: { showGuestStatus: true, appUrl: 'javascript:alert(1)', maxPerColumn: 'lots' },
    });
    assert.equal(config.showGuestStatus, true, 'the good field survives');
    assert.equal(config.appUrl, null, 'the dangerous one does not');
    assert.equal(config.maxPerColumn, DEFAULT_BOARD_CONFIG.maxPerColumn);
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

  it('bounds maxPerColumn so a typo cannot ask for a thousand rows', () => {
    assert.equal(resolveBoardConfig({ board: { maxPerColumn: 1000 } }).maxPerColumn,
      DEFAULT_BOARD_CONFIG.maxPerColumn);
    assert.equal(resolveBoardConfig({ board: { maxPerColumn: 0 } }).maxPerColumn,
      DEFAULT_BOARD_CONFIG.maxPerColumn);
    assert.equal(resolveBoardConfig({ board: { maxPerColumn: 12 } }).maxPerColumn, 12);
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

  it('shows a dash for a ticket with no number rather than blank space', () => {
    assert.equal(toEntry(ticket({ id: '1', daily_number: null }), config).number, '—');
  });

  it('badges the tier the projection resolved', () => {
    const entry = toEntry(ticket({ id: '1', loyalty_tier: 'house-regular' }), config);
    assert.equal(entry.tier?.label, 'House Regular');
  });

  it('withholds the badge entirely when the brand keeps status private', () => {
    const entry = toEntry(ticket({ id: '1', loyalty_tier: 'house-regular' }),
      { ...config, showGuestStatus: false });
    assert.equal(entry.tier, null);
  });

  it('withholds provenance when the brand turns the channel line off', () => {
    const entry = toEntry(ticket({ id: '1' }), { ...config, showChannel: false });
    assert.equal(entry.provenance, null);
  });
});

describe('capColumn', () => {
  const entries = Array.from({ length: 10 }, (_, i) =>
    toEntry(ticket({ id: `t${i}`, daily_number: i }), DEFAULT_BOARD_CONFIG));

  it('states the overflow rather than clipping it silently', () => {
    const view = capColumn(entries, 4);
    assert.equal(view.entries.length, 4);
    assert.equal(view.overflow, 6);
  });

  it('reports no overflow when everything fits', () => {
    assert.equal(capColumn(entries, 10).overflow, 0);
    assert.equal(capColumn(entries, 99).overflow, 0);
  });
});

describe('reconcileBoard', () => {
  const now = 1_000_000;
  const linger = 90_000;

  it('takes the fresh read as the truth', () => {
    const slots = reconcileBoard([], [ticket({ id: 'a', daily_number: 2 }),
      ticket({ id: 'b', daily_number: 1 })], now, linger);
    assert.deepEqual(slots.map((s) => s.ticket.id), ['b', 'a'], 'ordered by ticket number');
    assert.ok(slots.every((s) => s.goneSince === null));
  });

  it('holds a collected ticket on screen instead of vanishing it mid-walk', () => {
    const before: BoardSlot[] = [{ ticket: ticket({ id: 'a', status: 'ready' }), goneSince: null }];
    const after = reconcileBoard(before, [], now, linger);
    assert.equal(after.length, 1);
    assert.equal(after[0]?.goneSince, now, 'the clock starts at the read that lost it');
  });

  it('drops it once the linger is spent', () => {
    const lingering: BoardSlot[] = [{ ticket: ticket({ id: 'a' }), goneSince: now - linger }];
    assert.deepEqual(reconcileBoard(lingering, [], now, linger), []);
  });

  it('does not restart the linger clock on every reconcile', () => {
    const started = now - 45_000;
    const lingering: BoardSlot[] = [{ ticket: ticket({ id: 'a' }), goneSince: started }];
    assert.equal(reconcileBoard(lingering, [], now, linger)[0]?.goneSince, started);
  });

  it('revives a ticket that comes back, e.g. a refund reversing a collection', () => {
    const lingering: BoardSlot[] = [{ ticket: ticket({ id: 'a' }), goneSince: now - 1_000 }];
    const after = reconcileBoard(lingering, [ticket({ id: 'a', status: 'ready' })], now, linger);
    assert.equal(after[0]?.goneSince, null);
  });

  it('never duplicates a ticket that is both lingering and live', () => {
    const lingering: BoardSlot[] = [{ ticket: ticket({ id: 'a' }), goneSince: now - 1_000 }];
    assert.equal(reconcileBoard(lingering, [ticket({ id: 'a' })], now, linger).length, 1);
  });
});

describe('boardColumns', () => {
  it('puts paid and in-progress together, ready apart', () => {
    const slots: BoardSlot[] = [
      { ticket: ticket({ id: '1', status: 'paid', daily_number: 1 }), goneSince: null },
      { ticket: ticket({ id: '2', status: 'in_progress', daily_number: 2 }), goneSince: null },
      { ticket: ticket({ id: '3', status: 'ready', daily_number: 3 }), goneSince: null },
    ];
    const columns = boardColumns(slots, DEFAULT_BOARD_CONFIG);
    assert.deepEqual(columns.inProgress.entries.map((e) => e.id), ['1', '2']);
    assert.deepEqual(columns.ready.entries.map((e) => e.id), ['3']);
  });

  it('drops a collected ghost before a guest who is still waiting', () => {
    const slots: BoardSlot[] = [
      { ticket: ticket({ id: 'ghost', status: 'ready', daily_number: 1 }), goneSince: 1 },
      { ticket: ticket({ id: 'live', status: 'ready', daily_number: 2 }), goneSince: null },
    ];
    const columns = boardColumns(slots, { ...DEFAULT_BOARD_CONFIG, maxPerColumn: 1 });
    assert.deepEqual(columns.ready.entries.map((e) => e.id), ['live']);
    assert.equal(columns.ready.overflow, 1);
  });

  it('marks a lingering ticket so the view can fade it', () => {
    const slots: BoardSlot[] = [
      { ticket: ticket({ id: 'ghost', status: 'ready' }), goneSince: 1 },
    ];
    assert.equal(boardColumns(slots, DEFAULT_BOARD_CONFIG).ready.entries[0]?.collected, true);
  });

  it('invents no column for a state the guest cannot act on', () => {
    const slots: BoardSlot[] = [
      { ticket: ticket({ id: '1', status: 'picked_up' }), goneSince: null },
      { ticket: ticket({ id: '2', status: 'cancelled' }), goneSince: null },
    ];
    const columns = boardColumns(slots, DEFAULT_BOARD_CONFIG);
    assert.deepEqual(columns.inProgress.entries, []);
    assert.deepEqual(columns.ready.entries, []);
  });
});
