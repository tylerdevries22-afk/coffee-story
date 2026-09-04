import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  BOARD_STATUSES,
  canTransition,
  isRevenueOrderStatus,
  isTerminal,
  OPERATOR_TRANSITIONS,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  transitionPath,
  type OrderStatus,
} from './order-status.js';

/**
 * The order lifecycle as a graph, rather than as a list of examples.
 *
 * order-status.test.ts already checks the individual edges a reader would think
 * to check. What it cannot check by enumeration is the shape of the whole
 * thing: that no state is stranded, that every state a guest can reach still
 * has a way out, that the operator's writable list and the machine agree, and
 * that revenue reporting counts exactly the states that took money. Those are
 * properties over all seven states and all twelve edges, and they are the ones
 * that break when someone adds a state.
 *
 * Rule 2 in CLAUDE.md fixes the lifecycle as
 * `created -> paid -> in_progress -> ready -> picked_up | cancelled | refunded`,
 * so this suite is the machine-readable form of that sentence.
 */
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

function successors(from: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS.filter(([a]) => a === from).map(([, b]) => b);
}

function predecessors(to: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS.filter(([, b]) => b === to).map(([a]) => a);
}

describe('the order lifecycle is a well-formed graph', () => {
  it('starts every order at created, which nothing transitions into', () => {
    assert.deepEqual(predecessors('created'), [],
      'created is the entry point; an edge into it would let a settled order be reopened');
  });

  it('reaches every state from created', () => {
    for (const status of ORDER_STATUSES) {
      if (status === 'created') continue;
      assert.notEqual(transitionPath('created', status), null,
        `${status} is unreachable from created, so no order can ever be in it`);
    }
  });

  it('offers a way out of every state a guest can be left waiting in', () => {
    // cancelled and refunded are ends. Everything else must move, or an order
    // parks there forever with a guest expecting a drink.
    for (const status of ORDER_STATUSES) {
      if (isTerminal(status)) continue;
      assert.ok(successors(status).length > 0, `${status} is a dead end and is not terminal`);
    }
  });

  it('lets every paying state be refunded, and only unpaid states be plainly cancelled', () => {
    for (const status of ORDER_STATUSES) {
      if (isTerminal(status)) continue;
      const outs = successors(status);
      if (isRevenueOrderStatus(status)) {
        assert.ok(outs.includes('refunded'),
          `${status} counts as collected revenue but cannot be refunded`);
      } else {
        assert.ok(!outs.includes('refunded'),
          `${status} never took money, so refunded is not a legal destination`);
      }
    }
  });

  it('keeps cancelled and refunded absolutely terminal', () => {
    for (const status of ORDER_STATUSES) {
      if (!isTerminal(status)) continue;
      assert.deepEqual(successors(status), [],
        `${status} is terminal, so nothing may follow it`);
    }
  });

  it('treats picked_up as collected but not finished, because it can still be refunded', () => {
    assert.ok(!isTerminal('picked_up'));
    assert.ok(isRevenueOrderStatus('picked_up'));
    assert.deepEqual(successors('picked_up'), ['refunded']);
  });

  it('counts as revenue exactly the states at or past payment', () => {
    for (const status of ORDER_STATUSES) {
      const paid = transitionPath('created', status);
      const throughPaid = status === 'paid'
        || (paid !== null && paid.includes('paid'));
      // cancelled is reachable without ever passing through paid, so the
      // question is whether EVERY route to it took money.
      const everyRouteTookMoney = status !== 'created'
        && predecessors(status).every((from) => from === 'paid' || isRevenueOrderStatus(from));
      if (isRevenueOrderStatus(status)) {
        assert.ok(throughPaid, `${status} counts as revenue but is reachable without paying`);
      } else if (status !== 'created') {
        assert.ok(!everyRouteTookMoney || status === 'refunded',
          `${status} is not counted as revenue, yet every route into it took money`);
      }
    }
  });

  it('has no self-edge and no duplicate edge', () => {
    const seen = new Set<string>();
    for (const [from, to] of ORDER_TRANSITIONS) {
      assert.notEqual(from, to, `${from} transitions to itself`);
      const key = `${from}->${to}`;
      assert.ok(!seen.has(key), `${key} is declared twice`);
      seen.add(key);
    }
  });

  it('names only real statuses on both ends of every edge', () => {
    for (const [from, to] of ORDER_TRANSITIONS) {
      assert.ok(ORDER_STATUSES.includes(from), `${from} is not a status`);
      assert.ok(ORDER_STATUSES.includes(to), `${to} is not a status`);
    }
  });
});

describe('the operator board matches the machine it drives', () => {
  it('exposes only destinations the machine actually allows', () => {
    for (const target of OPERATOR_TRANSITIONS) {
      const reachable = ORDER_STATUSES.some((from) => canTransition(from, target));
      assert.ok(reachable,
        `the operator app may write ${target}, but no transition leads there`);
    }
  });

  it('shows the three in-flight columns, all of which count as revenue', () => {
    for (const status of BOARD_STATUSES) {
      assert.ok(isRevenueOrderStatus(status), `the board shows ${status}, which took no money`);
      assert.ok(!isTerminal(status), `the board shows ${status}, which is terminal`);
    }
    assert.deepEqual([...BOARD_STATUSES], ['paid', 'in_progress', 'ready'],
      'column order is the physical order of work on the bar');
  });

  it('does not let the shop floor refund, which is a back-office action', () => {
    assert.ok(!OPERATOR_TRANSITIONS.includes('refunded'),
      'refunds move money and belong to HQ, not the board');
  });

  it('expands a queued multi-step advance rather than dropping it', () => {
    // A barista offline taps Start then Ready; one intent arrives asking for
    // `ready` against an order the server still has at `paid`.
    assert.deepEqual(transitionPath('paid', 'ready'), ['in_progress', 'ready']);
    // And the direct edge stays direct rather than wandering.
    assert.deepEqual(transitionPath('paid', 'refunded'), ['refunded']);
    assert.equal(transitionPath('picked_up', 'created'), null);
  });
});

describe('the database enforces the same lifecycle', () => {
  it('declares every status in the schema, so the app cannot write one the database rejects', () => {
    const sql = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
      .join('\n');
    for (const status of ORDER_STATUSES) {
      assert.ok(sql.includes(`'${status}'`),
        `${status} appears nowhere in the migrations; the column would reject it`);
    }
  });
});
