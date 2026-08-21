import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupBookingServices, projectFirstServices, projectService, projectServices } from './service-projections';

const source = {
  id: 'latte',
  name: 'Latte',
  description: 'Espresso with steamed milk and foam.',
  image: 1,
  category: 'coffee',
  durations: [{ slug: 'latte-12', minutes: 12, price: 4 }, { slug: 'latte-16', minutes: 16, price: 5 }],
} as const;

test('projects every catalog duration into integer cents', () => {
  assert.deepEqual(projectServices([source]).map((service) => [service.slug, service.priceCents]), [
    ['latte-12', 400], ['latte-16', 500],
  ]);
});

test('a service without a duration receives the safe fallback shape', () => {
  const noDuration = { ...source, durations: [] as const };
  assert.deepEqual(projectService(noDuration), {
    slug: 'latte', name: 'Latte', category: 'specialty', durationMin: 60,
    priceCents: 0, depositCents: 0, description: 'Espresso with steamed milk and foam.',
  });
});

test('the account and staff projections keep one service-level slug', () => {
  assert.deepEqual(projectFirstServices([source]).map((service) => service.slug), ['latte']);
});

test('grouping preserves service order and uses the first session image', () => {
  const services = projectServices([source]);
  const groups = groupBookingServices(services, (slug) => slug.endsWith('12') ? 7 : 9);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.image, 7);
  assert.deepEqual(groups[0]?.sessions.map((service) => service.slug), ['latte-12', 'latte-16']);
});
