import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { resolveBoardConfig, toEntry } from '@platform/domain';

import { demoAllowed, isLocationId } from './board';
import {
  DEMO_BRAND_CONFIG, DEMO_STEP_MS, DEMO_TICKETS, demoBoardAt, demoLocationName,
} from './demo-board';
import { displayTheme } from './theme';

const MIGRATIONS = join(process.cwd(), '..', '..', 'supabase', 'migrations');

/**
 * Take the definition actually in force rather than pinning a filename: a
 * later migration may redefine what an earlier one created, and this test used
 * to read 0028 by name -- which meant 0030's redefinition would have been
 * checked against a view that no longer existed. surfaces.test.ts already
 * makes this point; it applies here too.
 */
function allSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
    .join('\n');
}

function boardTicketsView(): string {
  const views = [...allSql().matchAll(/create (?:or replace )?view public\.board_tickets[\s\S]*?;/g)];
  assert.ok(views.length > 0, 'board_tickets is not defined');
  return views[views.length - 1]?.[0] ?? '';
}


/**
 * The view's output columns, by the name a caller would see.
 *
 * Substring-matching the whole definition was the obvious check and it is
 * wrong in both directions: it misses a column smuggled in under an alias, and
 * since 0030 it false-positives on `app.loyalty_tier_for(o.customer_id, ...)`
 * -- an argument handed to a definer function, which is the opposite of an
 * exposed column. What a bystander can read is the select list, so that is
 * what gets checked.
 */
function projectedColumns(view: string): string[] {
  const body = /\bas\s+select\b([\s\S]*?)\bfrom\b/i.exec(view);
  if (!body) return [];
  const columns: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of body[1] ?? '') {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      columns.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  columns.push(current);
  return columns.map((column) => {
    const trimmed = column.trim();
    const aliased = /\bas\s+([a-z_][a-z0-9_]*)$/i.exec(trimmed);
    if (aliased) return (aliased[1] ?? '').toLowerCase();
    return (trimmed.split('.').pop() ?? trimmed).toLowerCase();
  }).filter(Boolean);
}

/**
 * The pickup display is the only surface here a whole room can read at once,
 * so what it is *allowed* to know matters more than what it shows.
 */
describe('board fixtures', () => {
  const tickets = DEMO_TICKETS;

  it('carries no column a bystander should not see', () => {
    // The server route returns these rows verbatim. If a fixture ever grows a
    // field the view does not have, the display would show more than the
    // database would ever hand it, and the difference would go unnoticed.
    const forbidden = [
      'customer_id', 'totals', 'total_cents', 'subtotal_cents', 'tax_cents',
      'tip_cents', 'note', 'square_order_id', 'square_payment_id',
      'points_balance', 'lifetime_points',
    ];
    for (const ticket of demoBoardAt(0)) {
      for (const key of forbidden) {
        assert.ok(!(key in ticket), `board ticket must not carry ${key}`);
      }
    }
  });

  it('matches the columns board_tickets actually selects', () => {
    const columns = projectedColumns(boardTicketsView());
    assert.deepEqual(
      Object.keys(demoBoardAt(0)[0] ?? {}).sort(),
      [...columns].sort(),
      'the fixtures and the view must project exactly the same columns',
    );
  });

  it('covers the states the display has to draw', () => {
    const statuses = new Set(demoBoardAt(0).map((t) => t.status));
    assert.ok(statuses.has('paid'), 'need something paid but not started');
    assert.ok(statuses.has('in_progress'), 'need something being made');
    assert.ok(statuses.has('ready'), 'need something ready');
  });

  it('keeps both columns occupied at every point in the cycle', () => {
    // A demo that empties a column for two steps looks like a bug to whoever
    // is watching it, and the whole point of the fixtures is that somebody
    // can watch them.
    for (let step = 0; step < DEMO_TICKETS.length * 2; step += 1) {
      const board = demoBoardAt(step * DEMO_STEP_MS);
      const making = board.filter((t) => t.status === 'paid' || t.status === 'in_progress');
      const ready = board.filter((t) => t.status === 'ready');
      assert.ok(making.length > 0, `nothing being made at step ${step}`);
      assert.ok(ready.length > 0, `nothing ready at step ${step}`);
    }
  });

  it('moves, and drops a ticket off the read the way a collection does', () => {
    // A collected ticket must leave the authoritative replacement set. If the
    // demo never dropped one, that removal path would go unexercised.
    const first = demoBoardAt(0).map((t) => t.id);
    const later = demoBoardAt(DEMO_STEP_MS * 3).map((t) => t.id);
    assert.notDeepEqual(first, later, 'the demo board must move');
    assert.ok(first.some((id) => !later.includes(id)), 'a ticket must leave the read');
  });

  it('is a pure function of the clock, so two screens agree', () => {
    assert.deepEqual(demoBoardAt(1_000), demoBoardAt(1_000));
    // Mid-step, not on a boundary: the same step must give the same board.
    assert.deepEqual(demoBoardAt(1_000), demoBoardAt(1_000 + DEMO_STEP_MS / 3));
  });

  it('holds up before the epoch rather than emitting a negative-modulo board', () => {
    assert.ok(demoBoardAt(-DEMO_STEP_MS * 5).length > 0);
  });

  it('stamps the location it was asked for, not the fixture default', () => {
    for (const ticket of demoBoardAt(0, 'loc-uptown')) {
      assert.equal(ticket.location_id, 'loc-uptown');
    }
  });

  it('exercises every channel and every tier the demo config declares', () => {
    const channels = new Set(tickets.map((t) => t.channel));
    for (const channel of ['app', 'web', 'kiosk', 'pos']) {
      assert.ok(channels.has(channel as never), `no fixture came in via ${channel}`);
    }
    const shown = new Set(tickets.map((t) => t.loyalty_tier).filter(Boolean));
    for (const tier of DEMO_BRAND_CONFIG.board.tiers) {
      assert.ok(shown.has(tier.slug), `no fixture is on the ${tier.slug} rung`);
    }
    assert.ok(tickets.some((t) => t.loyalty_tier === null),
      'need a guest with no account, which is most of them');
    assert.ok(tickets.some((t) => t.arrived_at !== null),
      'need a curbside arrival to show the badge');
    assert.ok(tickets.some((t) => (t.guest_label ?? '').length > 18),
      'need a long name to test truncation');
    assert.ok(tickets.some((t) => (t.guest_label ?? '') === ''), 'need a nameless ticket');
  });

  it('has a tier slug for every badge the SQL projection could emit', () => {
    // app.loyalty_tier_for emits board.tiers[].slug verbatim. A fixture
    // carrying a slug the ladder does not have would render an empty chip
    // here and, worse, would hide that the same thing happens in production.
    const config = resolveBoardConfig(DEMO_BRAND_CONFIG);
    for (const ticket of demoBoardAt(0)) {
      if (ticket.loyalty_tier === null) continue;
      assert.ok(toEntry(ticket, config, 1).tier, `no ladder rung named ${ticket.loyalty_tier}`);
    }
  });
});

describe('the board read', () => {
  it('is gated by the view, not by the app remembering to ask nicely', () => {
    const view = boardTicketsView();
    assert.match(view, /app\.can_read_board/,
      'board_tickets must carry its own authorization');
    assert.ok(!projectedColumns(view).includes('customer_id'),
      'a wall screen is not a private surface');
  });

  it('leaves a display device no way to reach orders directly', () => {
    // This is the whole point of 0030: 0014 grants every column of every table
    // to `authenticated`, so a policy on `orders` hands the wall tablet the
    // cart, the total and the customer id no matter how narrow the view is.
    assert.match(allSql(), /drop policy if exists orders_display_select on public\.orders/);
  });

  it('keeps points off the wall while letting a bucket through', () => {
    const view = boardTicketsView();
    const columns = projectedColumns(view);
    assert.ok(columns.includes('loyalty_tier'));
    assert.ok(!columns.includes('lifetime_points'), 'a balance is not a badge');
    assert.ok(!columns.includes('points_balance'), 'a balance is not a badge');
  });
});

describe('isLocationId', () => {
  it('accepts a uuid', () => {
    assert.ok(isLocationId('3dcaf174-4065-4c3b-8c57-35ce0a4bad19'));
  });

  it('refuses anything Postgres would answer with 22P02', () => {
    // Which the page turned into a 500 and a Next error page, on a wall.
    for (const bad of ['loc-downtown', '', '../../etc', "' or 1=1--", 'null']) {
      assert.ok(!isLocationId(bad), `${bad} must not reach a uuid column`);
    }
  });
});

describe('displayTheme', () => {
  it('hydrates the tenant palette rather than a hard-coded one', () => {
    const theme = displayTheme(DEMO_BRAND_CONFIG);
    assert.equal(theme.cssVariables['--board-surface'], DEMO_BRAND_CONFIG.tokens.surface);
    assert.equal(theme.cssVariables['--board-accent'], DEMO_BRAND_CONFIG.tokens.accent);
  });

  it('falls back to the platform defaults for a brand with no config at all', () => {
    const theme = displayTheme(null);
    assert.match(theme.cssVariables['--board-surface'] ?? '', /^#[0-9A-Fa-f]{6}$/);
  });

  it('drops one malformed token without unbranding the whole screen', () => {
    const theme = displayTheme({ tokens: { ...DEMO_BRAND_CONFIG.tokens, accent: 'not-a-color' } });
    assert.equal(theme.cssVariables['--board-surface'], DEMO_BRAND_CONFIG.tokens.surface);
    assert.notEqual(theme.cssVariables['--board-accent'], 'not-a-color');
  });

  it('names every variable the stylesheet reads', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'display.css'), 'utf8');
    const used = new Set([...css.matchAll(/var\((--board-[a-z-]+)/g)].map((m) => m[1]));
    const provided = new Set(Object.keys(displayTheme(DEMO_BRAND_CONFIG).cssVariables));
    for (const name of used) {
      assert.ok(provided.has(name as string), `${name} is read by the CSS but never hydrated`);
    }
  });
});

describe('demoLocationName', () => {
  it('names the sample locations and falls back for anything else', () => {
    assert.equal(demoLocationName('loc-uptown'), 'Uptown');
    assert.equal(demoLocationName('whatever'), 'Downtown');
  });
});

/**
 * The failure this surface must never have.
 *
 * A wall board reporting an empty queue with a green "Live" chip, while eight
 * people wait, is worse than a dark screen: every signal it shows says it is
 * working. The anon key produces exactly that against a gated view, so it is
 * not an acceptable credential here.
 */
describe('the display credential', () => {
  it('requires a device token and never falls back to the anon key', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'board.ts'), 'utf8');
    const fn = /function client\(\)[\s\S]*?\n}/.exec(source);
    assert.ok(fn, 'client() is not defined');
    assert.match(fn[0], /DISPLAY_DEVICE_TOKEN/);
    assert.ok(!fn[0].includes('ANON_KEY'),
      'the anon key satisfies app.can_read_board for nothing: it reads zero '
      + 'rows and the board calls that "Live"');
  });
});

/**
 * A wall in a shop must never show invented guests.
 *
 * The fixtures are the right answer on a laptop and a liability on a wall: an
 * unpaired production display falling back to them would put six fabricated
 * names on a screen the room can read, indistinguishable from the real queue
 * except that nobody present is holding those orders.
 */
describe('demoAllowed', () => {
  const withEnv = (patch: Record<string, string | undefined>, run: () => void) => {
    const saved = { ...process.env };
    Object.assign(process.env, patch);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
    }
    try { run(); } finally {
      for (const key of Object.keys(patch)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  };

  it('never invents a queue in a production build', () => {
    withEnv({ NODE_ENV: 'production', DISPLAY_DEMO_MODE: undefined }, () => {
      assert.equal(demoAllowed(), false);
    });
  });

  it('still demos everywhere else, which is what the fixtures are for', () => {
    withEnv({ NODE_ENV: 'development', DISPLAY_DEMO_MODE: undefined }, () => {
      assert.equal(demoAllowed(), true);
    });
  });

  it('lets a trade stand opt in explicitly', () => {
    withEnv({ NODE_ENV: 'production', DISPLAY_DEMO_MODE: '1' }, () => {
      assert.equal(demoAllowed(), true);
    });
  });

  it('treats any other value as off, so a typo fails safe', () => {
    for (const value of ['true', 'yes', '0', '']) {
      withEnv({ NODE_ENV: 'production', DISPLAY_DEMO_MODE: value }, () => {
        assert.equal(demoAllowed(), false, `DISPLAY_DEMO_MODE=${value} must not enable demo`);
      });
    }
  });
});

describe('the configuration reference', () => {
  it('documents every env var the app actually reads', () => {
    const source = readFileSync(join(process.cwd(), 'lib', 'board.ts'), 'utf8');
    const example = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    const read = new Set([...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]));
    for (const name of read) {
      if (name === 'NODE_ENV') continue;  // set by the runtime, not by an operator
      assert.ok(example.includes(name as string),
        `${name} is read by the app but absent from apps/display/.env.example — `
        + 'a deployment has no way to know it is needed');
    }
  });
});
