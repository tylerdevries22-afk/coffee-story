import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OrderableItem, PortalBundle } from '@/types/domain';

import { searchClientAccount } from './client-search';

const MENU_ITEMS: readonly OrderableItem[] = [
  {
    slug: 'spanish-latte',
    name: 'Spanish Latte',
    category: 'signature',
    ounces: 16,
    durationMin: 5,
    priceCents: 700,
    depositCents: 0,
    description: 'Espresso with sweetened condensed milk.',
  },
  {
    slug: 'adeni-chai',
    name: 'Adeni Chai',
    category: 'specialty',
    ounces: 16,
    durationMin: 5,
    priceCents: 600,
    depositCents: 0,
    description: 'Spiced Yemeni tea, brewed with milk.',
  },
];

function portal(overrides: Partial<PortalBundle> = {}): PortalBundle {
  return {
    profile: {
      id: 'profile-1',
      fullName: 'Alex Rivera',
      email: 'alex@example.com',
      phone: null,
      birthday: null,
      avatarUrl: null,
    },
    role: 'client',
    orders: [
      {
        id: 'order-1',
        summary: 'Spanish Latte (16 oz)',
        lines: [],
        fulfillmentType: 'pickup',
        // Mid-month, mid-day UTC so the formatted month stays "Jul" whatever
        // zone the test runner sits in.
        placedAt: '2026-07-15T18:00:00.000Z',
        scheduledFor: '2026-07-15T18:15:00.000Z',
        status: 'paid',
        subtotalCents: 700,
        taxCents: 58,
        tipCents: 0,
        totalCents: 758,
        note: '',
      },
      {
        id: 'order-2',
        summary: 'Adeni Chai (16 oz)',
        lines: [],
        fulfillmentType: 'pickup',
        placedAt: '2026-02-10T18:00:00.000Z',
        scheduledFor: '2026-02-10T19:00:00.000Z',
        status: 'picked_up',
        subtotalCents: 600,
        taxCents: 50,
        tipCents: 0,
        totalCents: 650,
        note: '',
      },
    ],
    rewardAccount: {
      availablePoints: 1200,
      annualPoints: 3400,
      cashCents: 0,
      annualPeriodStart: '2026-01-01T00:00:00.000Z',
    },
    rewardLedger: [],
    rewardActivities: [],
    rewardCatalog: [],
    giftCards: [
      {
        id: 'gift-1',
        code: 'GIFT-9021',
        initialCents: 10000,
        balanceCents: 7500,
        recipientEmail: null,
        recipientName: null,
        designKey: 'classic',
        deliveryAt: null,
        status: 'claimed',
        createdAt: '2026-01-05T00:00:00.000Z',
        claimedByCurrentUser: true,
        purchasedByCurrentUser: false,
      },
      {
        id: 'gift-2',
        code: 'LATTE-2026',
        initialCents: 15000,
        balanceCents: 15000,
        recipientEmail: 'friend@example.com',
        recipientName: 'Jamie Lee',
        designKey: 'classic',
        deliveryAt: null,
        status: 'delivered',
        createdAt: '2026-03-01T00:00:00.000Z',
        claimedByCurrentUser: false,
        purchasedByCurrentUser: true,
      },
    ],
    ...overrides,
  };
}

describe('searchClientAccount empty input', () => {
  it('returns nothing for an empty query rather than the whole account', () => {
    assert.deepEqual(searchClientAccount('', portal(), MENU_ITEMS), []);
  });

  it('treats a whitespace-only query as empty', () => {
    assert.deepEqual(searchClientAccount('   ', portal(), MENU_ITEMS), []);
    assert.deepEqual(searchClientAccount('\n\t ', portal(), MENU_ITEMS), []);
  });

  it('returns nothing when the query matches no part of the account', () => {
    assert.deepEqual(searchClientAccount('kombucha', portal(), MENU_ITEMS), []);
  });
});

describe('searchClientAccount matching', () => {
  it('is case-insensitive and ignores surrounding whitespace', () => {
    const lower = searchClientAccount('yemeni', portal(), MENU_ITEMS);
    const upper = searchClientAccount('  YEMENI  ', portal(), MENU_ITEMS);
    assert.deepEqual(upper, lower);
    assert.deepEqual(lower.map((result) => result.title), ['Adeni Chai']);
  });

  it('matches a More destination and reports the view to open', () => {
    const results = searchClientAccount('privacy', portal(), MENU_ITEMS);
    assert.deepEqual(results.map((result) => result.kind), ['page']);
    assert.equal(results[0]?.title, 'Privacy & terms');
    assert.deepEqual(results[0]?.target, { view: 'privacy' });
  });

  it('matches a page by its detail copy, not only its title', () => {
    const results = searchClientAccount('parking', portal(), MENU_ITEMS);
    assert.deepEqual(results.map((result) => result.target), [{ view: 'location' }]);
  });

  it('covers every More destination the client page lists', () => {
    const views = new Set<string>();
    for (const term of ['gift card balance', 'menu & prices', 'shop location',
      'brewing guides', 'frequently asked', 'refund policy', 'privacy & terms',
      'pickup history', 'account settings', 'my usual', 'messages', 'membership',
      'payment methods']) {
      for (const result of searchClientAccount(term, portal(), MENU_ITEMS)) {
        if (result.kind === 'page' && 'view' in result.target) views.add(result.target.view);
      }
    }
    assert.deepEqual([...views].sort(), [
      'book',
      'care-policy',
      'faq',
      'gift-balance',
      'intake',
      'location',
      'membership',
      'messages',
      'payments',
      'privacy',
      'profile',
      'resources',
      'visits',
    ]);
  });

  it('matches an order by its summary', () => {
    // "spanish" reaches both the past order and the menu item it was, which
    // is the grouping working, not a miss.
    const results = searchClientAccount('spanish', portal(), MENU_ITEMS);
    assert.deepEqual(results.map((result) => result.kind), ['visit', 'service']);
    assert.equal(results[0]?.title, 'Spanish Latte (16 oz)');
    assert.deepEqual(results[0]?.target, { view: 'visits' });
  });

  it('matches an order by its formatted date', () => {
    const results = searchClientAccount('jul', portal(), MENU_ITEMS);
    assert.deepEqual(results.map((result) => result.id), ['visit-order-1']);
    assert.match(results[0]?.detail ?? '', /Jul/);
  });

  it('matches a gift card by its code', () => {
    const results = searchClientAccount('gift-9', portal(), MENU_ITEMS);
    assert.deepEqual(results.map((result) => result.kind), ['gift']);
    assert.equal(results[0]?.title, 'GIFT-9021');
    assert.deepEqual(results[0]?.target, { view: 'gift-balance' });
  });

  it('matches a gift card by its remaining amount', () => {
    const results = searchClientAccount('$75.00', portal(), MENU_ITEMS);
    assert.deepEqual(results.map((result) => result.id), ['gift-gift-1']);
  });

  it('matches a menu item and reports its slug', () => {
    const results = searchClientAccount('yemeni', portal(), MENU_ITEMS);
    assert.deepEqual(results.map((result) => result.kind), ['service']);
    assert.deepEqual(results[0]?.target, { itemId: 'adeni-chai' });
    assert.equal(results[0]?.detail, '16 oz · $6 · Spiced Yemeni tea, brewed with milk.');
  });

  it('tolerates an account with no orders, gifts, or menu items', () => {
    const bare = portal({ orders: [], giftCards: [] });
    assert.deepEqual(searchClientAccount('espresso', bare, []), []);
    assert.deepEqual(searchClientAccount('privacy', bare, []).map((result) => result.kind), ['page']);
  });
});

describe('searchClientAccount ordering and cap', () => {
  it('groups results pages, then orders, then gifts, then menu items', () => {
    const results = searchClientAccount('latte', portal(), MENU_ITEMS);
    assert.deepEqual(
      results.map((result) => result.kind),
      ['page', 'visit', 'gift', 'service'],
    );
    assert.deepEqual(
      results.map((result) => result.title),
      ['Menu & prices', 'Spanish Latte (16 oz)', 'LATTE-2026', 'Spanish Latte'],
    );
  });

  it('caps the result list at twelve', () => {
    // "e" appears in every More destination, so the pages alone overflow.
    const results = searchClientAccount('e', portal(), MENU_ITEMS);
    assert.equal(results.length, 12);
    assert.ok(results.every((result) => result.kind === 'page'));
  });

  it('gives every result a unique id', () => {
    const results = searchClientAccount('e', portal(), MENU_ITEMS);
    assert.equal(new Set(results.map((result) => result.id)).size, results.length);
  });
});
