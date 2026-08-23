import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { DEMO_BOARD } from './demo-board';

/**
 * The pickup display is the only surface here a whole room can read at once,
 * so what it is *allowed* to know matters more than what it shows.
 */
describe('board fixtures', () => {
  const tickets = DEMO_BOARD;

  it('carries no column a bystander should not see', () => {
    // The server route returns these rows verbatim. If a fixture ever grows a
    // field the view does not have, the display would show more than the
    // database would ever hand it, and the difference would go unnoticed.
    const forbidden = [
      'customer_id', 'totals', 'total_cents', 'subtotal_cents', 'tax_cents',
      'tip_cents', 'note', 'square_order_id', 'square_payment_id',
    ];
    for (const ticket of tickets) {
      for (const key of forbidden) {
        assert.ok(!(key in ticket), `board ticket must not carry ${key}`);
      }
    }
  });

  it('matches the columns board_tickets actually selects', () => {
    const sql = readFileSync(
      join(process.cwd(), '..', '..', 'supabase', 'migrations', '20260722000028_curbside_arrival.sql'),
      'utf8',
    );
    const view = /create or replace view public\.board_tickets[\s\S]*?;/.exec(sql);
    assert.ok(view, 'board_tickets is not defined in 0028');
    for (const key of Object.keys(tickets[0] ?? {})) {
      assert.ok(view[0].includes(key), `fixture field ${key} is not in the view`);
    }
  });

  it('covers the states the display has to draw', () => {
    const statuses = new Set(tickets.map((t) => t.status));
    assert.ok(statuses.has('in_progress'), 'need something being made');
    assert.ok(statuses.has('ready'), 'need something ready');
    assert.ok(tickets.some((t) => t.arrived_at !== null), 'need a curbside arrival to show the badge');
    assert.ok(tickets.some((t) => (t.guest_label ?? '').length > 10), 'need a long name to test truncation');
  });
});
