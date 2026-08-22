import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cashEntries } from './cash-entries';

const entry = (over: Partial<{
  id: string; entryType: 'purchase' | 'activity' | 'redemption' | 'adjustment' | 'expiration'; description: string;
}> = {}) => ({
  id: 'entry', entryType: 'redemption' as const, points: -500, description: 'Redeemed $10 session credit',
  earnedAt: '2026-08-01T00:00:00Z', expiresAt: null, ...over,
});

test('cash entries keep only redemption descriptions with dollar values', () => {
  assert.deepEqual(cashEntries([entry(), entry({ id: 'purchase', entryType: 'purchase' }), entry({ id: 'bad', description: 'Redeemed a session' })]).map((item) => [item.entry.id, item.delta]), [['entry', 1000]]);
});

test('cash entries preserve ledger order and parse cents', () => {
  assert.deepEqual(cashEntries([entry({ id: 'a', description: 'Redeemed $5.25 credit' }), entry({ id: 'b', description: 'Redeemed $25 credit' })]).map((item) => item.delta), [525, 2500]);
});
