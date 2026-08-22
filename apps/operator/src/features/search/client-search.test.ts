import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BookingService, PortalBundle } from '@/types/domain';

import { searchClientAccount } from './client-search';

const SERVICES: readonly BookingService[] = [
  {
    slug: 'deep-tissue',
    name: 'Deep Tissue Massage',
    category: 'therapeutic',
    durationMin: 45,
    priceCents: 10000,
    depositCents: 2500,
    description: 'Slow, focused session work for chronic tension.',
  },
  {
    slug: 'prenatal',
    name: 'Prenatal Massage',
    category: 'specialty',
    durationMin: 60,
    priceCents: 11000,
    depositCents: 2500,
    description: 'Safe, nurturing support for every trimester.',
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
    appointments: [
      {
        id: 'visit-1',
        serviceName: 'Signature Session',
        // Mid-month, mid-day UTC so the formatted month stays "Jul" whatever
        // zone the test runner sits in.
        startsAt: '2026-07-15T18:00:00.000Z',
        endsAt: '2026-07-15T19:30:00.000Z',
        status: 'confirmed',
        subtotalCents: 17000,
        depositCents: 2500,
        balanceCents: 14500,
      },
      {
        id: 'visit-2',
        serviceName: 'Swedish Massage',
        startsAt: '2026-02-10T18:00:00.000Z',
        endsAt: '2026-02-10T19:00:00.000Z',
        status: 'completed',
        subtotalCents: 10500,
        depositCents: 0,
        balanceCents: 0,
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
        code: 'SESSION-2026',
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
    assert.deepEqual(searchClientAccount('', portal(), SERVICES), []);
  });

  it('treats a whitespace-only query as empty', () => {
    assert.deepEqual(searchClientAccount('   ', portal(), SERVICES), []);
    assert.deepEqual(searchClientAccount('\n\t ', portal(), SERVICES), []);
  });

  it('returns nothing when the query matches no part of the account', () => {
    assert.deepEqual(searchClientAccount('kombucha', portal(), SERVICES), []);
  });
});

describe('searchClientAccount matching', () => {
  it('is case-insensitive and ignores surrounding whitespace', () => {
    const lower = searchClientAccount('prenatal', portal(), SERVICES);
    const upper = searchClientAccount('  PRENATAL  ', portal(), SERVICES);
    assert.deepEqual(upper, lower);
    assert.deepEqual(lower.map((result) => result.title), ['Prenatal Massage']);
  });

  it('matches a More destination and reports the view to open', () => {
    const results = searchClientAccount('privacy', portal(), SERVICES);
    assert.deepEqual(results.map((result) => result.kind), ['page']);
    assert.equal(results[0]?.title, 'Privacy & terms');
    assert.deepEqual(results[0]?.target, { view: 'privacy' });
  });

  it('matches a page by its detail copy, not only its title', () => {
    const results = searchClientAccount('parking', portal(), SERVICES);
    assert.deepEqual(results.map((result) => result.target), [{ view: 'location' }]);
  });

  it('covers every More destination the client page lists', () => {
    const views = new Set<string>();
    for (const term of ['gift card balance', 'services & pricing', 'studio location',
      'wellness resources', 'frequently asked', 'cancellation policy', 'privacy & terms',
      'visit history', 'account settings', 'intake & consent', 'messages', 'membership',
      'payment methods']) {
      for (const result of searchClientAccount(term, portal(), SERVICES)) {
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

  it('matches a visit by its service name', () => {
    const results = searchClientAccount('signature', portal(), SERVICES);
    assert.deepEqual(results.map((result) => result.kind), ['visit']);
    assert.equal(results[0]?.title, 'Signature Session');
    assert.deepEqual(results[0]?.target, { view: 'visits' });
  });

  it('matches a visit by its formatted date', () => {
    const results = searchClientAccount('jul', portal(), SERVICES);
    assert.deepEqual(results.map((result) => result.id), ['visit-visit-1']);
    assert.match(results[0]?.detail ?? '', /Jul/);
  });

  it('matches a gift card by its code', () => {
    const results = searchClientAccount('gift-9', portal(), SERVICES);
    assert.deepEqual(results.map((result) => result.kind), ['gift']);
    assert.equal(results[0]?.title, 'GIFT-9021');
    assert.deepEqual(results[0]?.target, { view: 'gift-balance' });
  });

  it('matches a gift card by its remaining amount', () => {
    const results = searchClientAccount('$75.00', portal(), SERVICES);
    assert.deepEqual(results.map((result) => result.id), ['gift-gift-1']);
  });

  it('matches a bookable service and reports its slug', () => {
    const results = searchClientAccount('deep tissue', portal(), SERVICES);
    assert.deepEqual(results.map((result) => result.kind), ['service']);
    assert.deepEqual(results[0]?.target, { serviceId: 'deep-tissue' });
    assert.equal(results[0]?.detail, '45 min · $100 · Slow, focused session work for chronic tension.');
  });

  it('tolerates an account with no visits, gifts, or services', () => {
    const bare = portal({ appointments: [], giftCards: [] });
    assert.deepEqual(searchClientAccount('signature', bare, []), []);
    assert.deepEqual(searchClientAccount('privacy', bare, []).map((result) => result.kind), ['page']);
  });
});

describe('searchClientAccount ordering and cap', () => {
  it('groups results pages, then visits, then gifts, then services', () => {
    const results = searchClientAccount('session', portal(), SERVICES);
    assert.deepEqual(
      results.map((result) => result.kind),
      ['page', 'page', 'page', 'visit', 'gift', 'service'],
    );
    assert.deepEqual(
      results.map((result) => result.title),
      [
        'Services & pricing',
        'Wellness resources',
        'Frequently asked questions',
        'Signature Session',
        'SESSION-2026',
        'Deep Tissue Massage',
      ],
    );
  });

  it('caps the result list at twelve', () => {
    // "e" appears in every More destination, so the pages alone overflow.
    const results = searchClientAccount('e', portal(), SERVICES);
    assert.equal(results.length, 12);
    assert.ok(results.every((result) => result.kind === 'page'));
  });

  it('gives every result a unique id', () => {
    const results = searchClientAccount('e', portal(), SERVICES);
    assert.equal(new Set(results.map((result) => result.id)).size, results.length);
  });
});
