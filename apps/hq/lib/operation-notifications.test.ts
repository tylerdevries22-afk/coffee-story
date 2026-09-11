import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { deliverOperationNotifications, persistOperationPushResults } from './operation-notifications';

const now = new Date('2026-09-07T22:30:00Z');
const row = { id: 'outbox', brand_id: 'brand', location_id: 'location', occurrence_id: 'task',
  recipient_id: 'member', channel: 'push', attempt_count: 2 };

function database(error: Error | null = null) {
  const writes: Record<string, unknown>[] = [];
  const filters: unknown[][] = [];
  const query = {
    eq(key: string, value: unknown) { filters.push([key, value]); return query; },
    then(resolve: (value: { error: Error | null }) => unknown) { return Promise.resolve(resolve({ error })); },
  };
  const db = { from(table: string) {
    assert.equal(table, 'operation_notification_outbox');
    return { update(values: Record<string, unknown>) { writes.push(values); return query; } };
  } } as unknown as SupabaseClient;
  return { db, writes, filters };
}

test('uncertain delivery is held without scheduling a resend, guarded by the claimed attempt', async () => {
  const { db, writes, filters } = database();
  await persistOperationPushResults(db, [row], [
    { outboxId: row.id, outcome: 'uncertain', errorCode: 'delivery_uncertain' },
  ], now);
  assert.deepEqual(writes, [{ status: 'cancelled', last_error: 'delivery_uncertain' }]);
  assert.deepEqual(filters, [['id', row.id], ['status', 'sending'], ['attempt_count', 2]]);
});

test('known rejection schedules bounded backoff while confirmed delivery records its timestamp', async () => {
  const { db, writes } = database();
  await persistOperationPushResults(db, [row], [
    { outboxId: row.id, outcome: 'failed', errorCode: 'delivery_failed' },
    { outboxId: row.id, outcome: 'sent', errorCode: null },
  ], now);
  assert.deepEqual(writes, [
    { status: 'failed', available_at: '2026-09-07T22:32:00.000Z', last_error: 'delivery_failed' },
    { status: 'sent', sent_at: now.toISOString(), last_error: null },
  ]);
});

test('persistence failures and missing claim context fail visibly', async () => {
  const failure = new Error('database unavailable');
  const result = { outboxId: row.id, outcome: 'sent' as const, errorCode: null };
  await assert.rejects(persistOperationPushResults(database(failure).db, [row], [result], now), failure);
  const { db, writes } = database();
  await assert.rejects(persistOperationPushResults(db, [], [result], now), /context was lost/);
  assert.deepEqual(writes, []);
});

test('empty claims do not invoke a provider and claim errors propagate', async () => {
  const db = { rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient;
  assert.deepEqual(await deliverOperationNotifications(db, now), { sent: 0, failed: 0, uncertain: 0 });
  const failure = new Error('claim unavailable');
  const failed = { rpc: async () => ({ data: null, error: failure }) } as unknown as SupabaseClient;
  await assert.rejects(deliverOperationNotifications(failed, now), failure);
});
