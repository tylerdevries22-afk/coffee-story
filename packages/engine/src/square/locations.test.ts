import assert from 'node:assert/strict';
import test from 'node:test';

import { PLATFORM_CURRENCY, chooseSquareLocation, type SquareMerchantLocation } from './client';

const location = (over: Partial<SquareMerchantLocation> = {}): SquareMerchantLocation => ({
  id: 'L1', name: 'Main', status: 'ACTIVE', currency: PLATFORM_CURRENCY, ...over,
});

test('binds the one location a single-shop merchant has', () => {
  const choice = chooseSquareLocation([location()]);
  assert.equal(choice.ok, true);
  assert.equal(choice.ok && choice.location.id, 'L1');
});

test('ignores locations Square has deactivated', () => {
  const choice = chooseSquareLocation([
    location({ id: 'closed', status: 'INACTIVE' }),
    location({ id: 'open' }),
  ]);
  assert.equal(choice.ok && choice.location.id, 'open');
});

test('refuses to guess between several live locations', () => {
  // Guessing here would send one shop's takings to a sibling store's books.
  const choice = chooseSquareLocation([location({ id: 'A' }), location({ id: 'B' })]);
  assert.deepEqual(choice, { ok: false, reason: 'several_locations' });
});

test('refuses a merchant who settles in another currency', () => {
  // Said once, at connect time, rather than as a rejected first checkout.
  assert.deepEqual(
    chooseSquareLocation([location({ currency: 'CAD' })]),
    { ok: false, reason: 'unsupported_currency' },
  );
});

test('refuses a merchant with nothing live to bill', () => {
  assert.deepEqual(chooseSquareLocation([]), { ok: false, reason: 'no_active_location' });
  assert.deepEqual(
    chooseSquareLocation([location({ status: 'INACTIVE' })]),
    { ok: false, reason: 'no_active_location' },
  );
  assert.deepEqual(
    chooseSquareLocation([location({ id: '' })]),
    { ok: false, reason: 'no_active_location' },
  );
});

test('reads a missing status or currency generously', () => {
  // Square sends both. Refusing a whole merchant over a field that did not
  // arrive would be a worse failure than the one this guards against.
  const choice = chooseSquareLocation([{ id: 'L1' }]);
  assert.equal(choice.ok && choice.location.id, 'L1');
});
