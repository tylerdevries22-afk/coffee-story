import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeGiftCardOwnership } from './ownership';
import type { GiftCard } from '../../types/domain';

function gift(overrides: Partial<GiftCard>): GiftCard {
  return {
    id: 'gift',
    code: 'FH-TEST',
    initialCents: 5000,
    balanceCents: 5000,
    recipientEmail: 'client@example.com',
    recipientName: 'Client',
    designKey: 'quiet-hour',
    deliveryAt: null,
    status: 'claimed',
    createdAt: '2026-07-29T00:00:00.000Z',
    claimedByCurrentUser: true,
    purchasedByCurrentUser: false,
    ...overrides,
  };
}

test('counts only claimant-owned cards as spendable', () => {
  const summary = summarizeGiftCardOwnership([
    gift({ id: 'claimed', balanceCents: 3200, claimedByCurrentUser: true }),
    gift({
      id: 'sent',
      balanceCents: 7800,
      claimedByCurrentUser: false,
      purchasedByCurrentUser: true,
      status: 'delivered',
    }),
  ]);
  assert.equal(summary.spendableBalanceCents, 3200);
  assert.equal(summary.sentBalanceCents, 7800);
  assert.deepEqual(summary.spendableCards.map(({ id }) => id), ['claimed']);
  assert.deepEqual(summary.sentCards.map(({ id }) => id), ['sent']);
});

test('fails closed when ownership metadata is missing at runtime', () => {
  const legacy: Partial<GiftCard> = gift({ purchasedByCurrentUser: true });
  Reflect.deleteProperty(legacy, 'claimedByCurrentUser');
  Reflect.deleteProperty(legacy, 'purchasedByCurrentUser');
  const summary = summarizeGiftCardOwnership([legacy as GiftCard]);
  assert.equal(summary.spendableBalanceCents, 0);
  assert.equal(summary.sentBalanceCents, 0);
});

test('preserves both roles for a self-purchased and claimed gift', () => {
  const selfGift = gift({
    balanceCents: 4100,
    claimedByCurrentUser: true,
    purchasedByCurrentUser: true,
  });
  const summary = summarizeGiftCardOwnership([selfGift]);
  assert.equal(summary.spendableBalanceCents, 4100);
  assert.equal(summary.sentBalanceCents, 4100);
  assert.equal(summary.spendableCards[0]?.id, selfGift.id);
  assert.equal(summary.sentCards[0]?.id, selfGift.id);
});
