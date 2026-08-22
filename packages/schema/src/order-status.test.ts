import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { ORDER_TRANSITIONS, OPERATOR_TRANSITIONS, canTransition } from './order-status';

// Migrations live in the repo-root supabase/ dir (CLI layout) since 0009+.
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

const sql = readFileSync(join(MIGRATIONS, '20260722000005_orders.sql'), 'utf8');

describe('order status machine', () => {
  it('matches the SQL trigger transition for transition', () => {
    // Parse the pairs out of app.order_transition_allowed.
    const body = sql.split('order_transition_allowed')[1]!.split('$$')[1]!;
    const sqlPairs = [...body.matchAll(
      /\('(\w+)'::app\.order_status,\s*'(\w+)'::app\.order_status\)/g,
    )].map((m) => [m[1], m[2]] as const);
    assert.equal(sqlPairs.length, ORDER_TRANSITIONS.length, 'same number of legal moves');
    for (const [from, to] of ORDER_TRANSITIONS) {
      assert.ok(
        sqlPairs.some(([a, b]) => a === from && b === to),
        `SQL is missing ${from} -> ${to}`,
      );
    }
  });

  it('matches the RLS insert policy for what operators may write', () => {
    // 0010 supersedes 0007's order_events_insert; the drift check reads the
    // definition actually in force.
    const rls = readFileSync(join(MIGRATIONS, '20260722000010_rls_fixes.sql'), 'utf8');
    const policy = rls.split('create policy order_events_insert')[1]!.split(';')[0]!;
    for (const status of OPERATOR_TRANSITIONS) {
      assert.ok(policy.includes(`'${status}'`), `RLS is missing operator state ${status}`);
    }
  });

  it('never allows leaving a refund, or paying twice', () => {
    assert.equal(canTransition('refunded', 'paid'), false);
    assert.equal(canTransition('paid', 'paid'), false);
    assert.equal(canTransition('cancelled', 'in_progress'), false);
  });

  it('walks the happy path end to end', () => {
    const path = ['created', 'paid', 'in_progress', 'ready', 'picked_up'] as const;
    for (let i = 1; i < path.length; i += 1) {
      assert.ok(canTransition(path[i - 1]!, path[i]!), `${path[i - 1]} -> ${path[i]}`);
    }
  });
});
