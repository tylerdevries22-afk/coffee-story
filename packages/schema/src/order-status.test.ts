import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { ORDER_STATUSES, ORDER_TRANSITIONS, OPERATOR_TRANSITIONS, canTransition, transitionPath } from './order-status';

// Migrations live in the repo-root supabase/ dir (CLI layout) since 0009+.
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

/**
 * The definition actually in force, not the first one written: a later
 * migration may redefine the function, and pinning the table to 0005 would
 * check this list against SQL the database no longer runs. Same reasoning as
 * the RLS check below, which already reads 0010 over 0007.
 */
function latestDefining(marker: string): string {
  const file = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse()
    .find((name) => readFileSync(join(MIGRATIONS, name), 'utf8').includes(`function app.${marker}`));
  if (!file) throw new Error(`No migration defines app.${marker}`);
  return readFileSync(join(MIGRATIONS, file), 'utf8');
}

const sql = latestDefining('order_transition_allowed');

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

describe('transitionPath', () => {
  it('finds the run a collapsed queue entry stands for', () => {
    assert.deepEqual(transitionPath('paid', 'ready'), ['in_progress', 'ready']);
    assert.deepEqual(transitionPath('paid', 'picked_up'), ['in_progress', 'ready', 'picked_up']);
  });

  it('prefers the direct edge over a longer route', () => {
    assert.deepEqual(transitionPath('paid', 'refunded'), ['refunded']);
    assert.deepEqual(transitionPath('paid', 'cancelled'), ['cancelled']);
  });

  it('is empty for a state already reached, and null where no route exists', () => {
    assert.deepEqual(transitionPath('ready', 'ready'), []);
    assert.equal(transitionPath('refunded', 'ready'), null, 'refunded is terminal');
    assert.equal(transitionPath('picked_up', 'in_progress'), null, 'the machine does not run backwards');
  });

  it('agrees with canTransition on every single step it returns', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const path = transitionPath(from, to);
        if (!path) continue;
        let cursor = from;
        for (const step of path) {
          assert.equal(canTransition(cursor, step), true, `${cursor} -> ${step}`);
          cursor = step;
        }
      }
    }
  });
});
