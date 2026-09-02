import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BoardOrder } from './board';
import { orderReceiptHtml } from './order-receipt';

const ORDER: BoardOrder = {
  id: 'order-1', shortCode: '42', guestName: '<Maya>', status: 'in_progress',
  placedAt: '2026-09-01T15:00:00Z', updatedAt: '2026-09-01T15:01:00Z',
  scheduledFor: null, dailyNumber: 42, totalCents: 625, note: 'No & sugar',
  tenderType: 'square_card',
  lines: [{ name: 'Latte', quantity: 1, options: ['Oat <milk>'], note: '', packContents: [] }],
};

describe('offline order receipt', () => {
  it('renders only local order data and escapes customer-authored text', () => {
    const html = orderReceiptHtml({
      locationName: 'Uptown', order: ORDER, printedAt: '2026-09-01T15:02:00Z',
    });
    assert.match(html, /Order 42/u);
    assert.match(html, /\$6\.25/u);
    assert.match(html, /&lt;Maya&gt;/u);
    assert.match(html, /No &amp; sugar/u);
    assert.doesNotMatch(html, /https?:\/\//u);
    assert.doesNotMatch(html, /<Maya>/u);
  });

  it('marks retries as copies so a delayed first job cannot make two orders', () => {
    assert.match(orderReceiptHtml({
      locationName: 'Uptown', order: ORDER, printedAt: '2026-09-01T15:02:00Z',
    }, 2), /COPY &mdash; VERIFY BEFORE MAKING/u);
  });
});
