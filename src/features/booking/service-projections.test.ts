import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupBookingServices, projectFirstServices, projectService, projectServices } from './service-projections';

const source = {
  id: 'deep-tissue',
  name: 'Deep Tissue Massage',
  description: 'Slow, focused work.',
  image: 1,
  durations: [{ slug: 'deep-tissue-45', minutes: 45, price: 100 }, { slug: 'deep-tissue-60', minutes: 60, price: 110 }],
} as const;

test('projects every catalog duration into integer cents', () => {
  assert.deepEqual(projectServices([source]).map((service) => [service.slug, service.priceCents]), [
    ['deep-tissue-45', 10000], ['deep-tissue-60', 11000],
  ]);
});

test('a service without a duration receives the safe fallback shape', () => {
  const noDuration = { ...source, durations: [] as const };
  assert.deepEqual(projectService(noDuration), {
    slug: 'deep-tissue', name: 'Deep Tissue Massage', category: 'therapeutic', durationMin: 60,
    priceCents: 0, depositCents: 2500, description: 'Slow, focused work.',
  });
});

test('the account and staff projections keep one service-level slug', () => {
  assert.deepEqual(projectFirstServices([source]).map((service) => service.slug), ['deep-tissue']);
});

test('grouping preserves service order and uses the first session image', () => {
  const services = projectServices([source]);
  const groups = groupBookingServices(services, (slug) => slug.endsWith('45') ? 7 : 9);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.image, 7);
  assert.deepEqual(groups[0]?.sessions.map((service) => service.slug), ['deep-tissue-45', 'deep-tissue-60']);
});
