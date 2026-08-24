import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// Deep imports, not the package roots. This package is `"type": "module"`
// while the workspace packages are not, and Node's CJS named-export detection
// cannot see through the `export *` in their index files -- the root import
// resolves and then has no named exports at all. Naming the module skips the
// barrel and the problem with it.
import { queuePositions, type QueueMember } from '@platform/domain/src/board-display';
import {
  BOARD_STATUSES, OPERATOR_TRANSITIONS, type OrderStatus,
} from '@platform/schema/src/order-status';

import { nextActionFor } from '../../../apps/operator/src/features/operator/board';

/**
 * The wall and the bench, held to the same story.
 *
 * `apps/operator` and `apps/display` never speak to each other. A barista taps
 * "Ready", the operator inserts an `order_events` row, the state-machine
 * trigger projects it onto `orders.status`, and the display reads the result
 * through `board_tickets` on its next poll. That is the right coupling for two
 * apps on two devices on two networks — but it means nothing in either app
 * fails when they disagree. They just show different things to people standing
 * three metres apart, and the first anyone hears of it is a guest asking why
 * the screen says they are next when the barista says they are done.
 *
 * So the agreement is pinned here rather than assumed.
 */
const ROOT = join(process.cwd(), '..', '..');

describe('the operator and the wall agree on the states', () => {
  it('gives every board state exactly one forward action', () => {
    for (const status of BOARD_STATUSES) {
      assert.ok(nextActionFor(status), `the operator offers no way out of ${status}`);
    }
  });

  it('walks paid -> in_progress -> ready -> picked_up and no other route', () => {
    assert.equal(nextActionFor('paid')?.to, 'in_progress');
    assert.equal(nextActionFor('in_progress')?.to, 'ready');
    assert.equal(nextActionFor('ready')?.to, 'picked_up');
    // Nothing beyond the handover: a collected order is off the board, and an
    // action there would be an action on a row nobody can see.
    assert.equal(nextActionFor('picked_up'), null);
  });

  it('makes "ready" the last state the wall shows', () => {
    // The display draws a check for `ready` and nothing after it. If a status
    // were ever inserted between ready and picked_up, the check would start
    // meaning "nearly" and the guest would walk up to a counter with nothing
    // on it.
    assert.equal(BOARD_STATUSES[BOARD_STATUSES.length - 1], 'ready');
  });

  it('takes a collected order off the wall, because the guest has it', () => {
    assert.ok(!(BOARD_STATUSES as readonly OrderStatus[]).includes('picked_up'),
      'picked_up must not be a board state or the name stays up after they leave');
  });

  it('lets the operator write every transition the wall depends on', () => {
    // The operator's insert is the only writer in this path. A state it cannot
    // write is a state the wall can never reach.
    for (const status of ['in_progress', 'ready', 'picked_up'] as const) {
      assert.ok((OPERATOR_TRANSITIONS as readonly OrderStatus[]).includes(status),
        `RLS does not let the operator write ${status}`);
    }
  });
});

describe('the operator and the wall agree on the queue', () => {
  /**
   * Both apps call `queuePositions`, over their own row shapes. The guard is
   * that they call the *same* function: a barista asked "what number am I?"
   * has to give the number on the wall, and two implementations of "the line"
   * would disagree the first time either one changed.
   */
  const orders: QueueMember[] = [
    { id: 'a', status: 'ready', daily_number: 41, updated_at: '2026-08-23T10:00:00Z' },
    { id: 'b', status: 'in_progress', daily_number: 42, updated_at: '2026-08-23T10:01:00Z' },
    { id: 'c', status: 'paid', daily_number: 43, updated_at: '2026-08-23T10:02:00Z' },
  ];

  it('numbers the line the same way from either side', () => {
    // The display holds BoardTicketRow; the operator holds BoardOrder. Both
    // narrow to QueueMember, which is why one function can serve both.
    const fromDisplay = queuePositions(orders.map((order) => ({ ...order })));
    const fromOperator = queuePositions(orders.map((order) => ({
      id: order.id,
      status: order.status,
      daily_number: order.daily_number,
      updated_at: order.updated_at,
    })));
    assert.deepEqual([...fromDisplay.entries()], [...fromOperator.entries()]);
  });

  it('stops counting a ready order, so the numbers move as the bar works', () => {
    assert.equal(queuePositions(orders).get('a'), null, 'ready has a check, not a number');
    assert.equal(queuePositions(orders).get('b'), 1);
    assert.equal(queuePositions(orders).get('c'), 2);
  });
});

describe('the display reads the projection, never the table', () => {
  it('goes through board_tickets, so the wall cannot reach a cart', () => {
    const source = readFileSync(join(ROOT, 'packages', 'data', 'src', 'board.ts'), 'utf8');
    assert.match(source, /from\('board_tickets'\)/);
    assert.ok(!source.includes("from('orders')"),
      'a display read against orders would carry customer_id and the totals');
  });

  it('never writes: the wall is output, and a guest can reach it', () => {
    const source = readFileSync(join(ROOT, 'packages', 'data', 'src', 'board.ts'), 'utf8');
    for (const write of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.ok(!source.includes(write), `the board read must not ${write}`);
    }
  });
});
