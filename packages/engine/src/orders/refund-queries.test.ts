/**
 * `endOrderRefund` releases the refund claim after Square has answered, so it
 * must never throw -- and it must never be silent either. supabase-js returns
 * a Postgres refusal as `error` instead of throwing, which is the shape the
 * old `try { await rpc } catch {}` never looked at: a refused release passed
 * as a success and the order stayed locked for the claim's TTL with nothing
 * to explain why the next attempt was told "already in progress".
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { endOrderRefund } from './refund-queries';

type RpcAnswer = { data: unknown; error: { message: string } | null };

function dbAnswering(answer: () => Promise<RpcAnswer>): SupabaseClient {
  return { rpc: answer } as unknown as SupabaseClient;
}

/** Every structured line `console.warn` received, parsed, until `restore`. */
function warnings(): { lines: () => Record<string, unknown>[]; restore: () => void } {
  const warn = mock.method(console, 'warn', () => undefined);
  return {
    lines: () => warn.mock.calls.map((call) => JSON.parse(String(call.arguments[0])) as Record<string, unknown>),
    restore: () => warn.mock.restore(),
  };
}

describe('endOrderRefund', () => {
  it('logs a refused release instead of treating it as a success', async () => {
    const captured = warnings();
    try {
      const db = dbAnswering(async () => ({ data: null, error: { message: 'claim held by another attempt' } }));
      await endOrderRefund(db, 'order-1', 'key-1');
      assert.deepEqual(captured.lines(), [{
        component: 'order-refund',
        event: 'claim_release_failed',
        orderId: 'order-1',
        message: 'claim held by another attempt',
      }]);
    } finally {
      captured.restore();
    }
  });

  it('logs, and still does not throw, when the release call itself fails', async () => {
    const captured = warnings();
    try {
      const db = dbAnswering(async () => { throw new Error('socket hang up'); });
      await endOrderRefund(db, 'order-2', 'key-2');
      assert.deepEqual(
        captured.lines().map((line) => [line.event, line.message]),
        [['claim_release_failed', 'socket hang up']],
      );
    } finally {
      captured.restore();
    }
  });

  it('says nothing when the release succeeds', async () => {
    const captured = warnings();
    try {
      await endOrderRefund(dbAnswering(async () => ({ data: null, error: null })), 'order-3', 'key-3');
      assert.deepEqual(captured.lines(), []);
    } finally {
      captured.restore();
    }
  });
});
