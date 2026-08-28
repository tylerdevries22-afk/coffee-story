import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  boundedText,
  operationChildActionId,
  operationDatabaseError,
  operationsRateLimited,
  roleAtLeast,
  validNotificationIds,
  validOperationDevice,
  validOperationsRange,
  validUuid,
} from './operations-api';

describe('operations API boundary', () => {
  it('accepts UUIDs and bounded text without coercing unsafe values', () => {
    assert.equal(validUuid('11111111-1111-4111-8111-111111111111'), true);
    assert.equal(validUuid('not-a-uuid'), false);
    assert.equal(boundedText('  ready  ', 20, true), 'ready');
    assert.equal(boundedText('', 20, true), null);
    assert.equal(boundedText('long', 3), null);
    assert.equal(boundedText(42, 20), '');
  });

  it('validates bounded notification batches and operation devices', () => {
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    assert.deepEqual(validNotificationIds([first, second]), [first, second]);
    assert.equal(validNotificationIds([]), null);
    assert.equal(validNotificationIds([first, first]), null);
    assert.deepEqual(validOperationDevice({ token: '  ExpoPushToken[valid]  ', platform: 'ios' }), {
      token: 'ExpoPushToken[valid]', platform: 'ios',
    });
    assert.equal(validOperationDevice({ token: 'short', platform: 'ios' }), null);
    assert.equal(validOperationDevice({ token: 'ExpoPushToken[valid]', platform: 'web' }), null);
  });

  it('derives stable, distinct UUID action IDs for batched acknowledgements', () => {
    const root = '11111111-1111-4111-8111-111111111111';
    const first = operationChildActionId(root, '22222222-2222-4222-8222-222222222222');
    const second = operationChildActionId(root, '33333333-3333-4333-8333-333333333333');
    assert.equal(validUuid(first), true);
    assert.equal(first, operationChildActionId(root, '22222222-2222-4222-8222-222222222222'));
    assert.notEqual(first, second);
    assert.equal(operationChildActionId('bad', root), null);
  });

  it('enforces role ordering and never treats a missing role as staff', () => {
    assert.equal(roleAtLeast('platform_admin', 'brand_owner'), true);
    assert.equal(roleAtLeast('location_manager', 'location_manager'), true);
    assert.equal(roleAtLeast('staff', 'location_manager'), false);
    assert.equal(roleAtLeast(undefined, 'staff'), false);
  });

  it('bounds queue ranges to 36 days with stable defaults', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    assert.deepEqual(validOperationsRange(null, null, now), {
      from: '2026-08-26T12:00:00.000Z',
      to: '2026-10-01T12:00:00.000Z',
    });
    assert.equal(validOperationsRange('bad', now.toISOString(), now), null);
    assert.equal(validOperationsRange('2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z', now), null);
    assert.equal(validOperationsRange(now.toISOString(), now.toISOString(), now), null);
  });

  it('limits repeated calls per identity and route without mixing routes', () => {
    const identity = `test-${Math.random()}`;
    assert.equal(operationsRateLimited(identity, '/queue', 1_000, 2), false);
    assert.equal(operationsRateLimited(identity, '/queue', 1_001, 2), false);
    assert.equal(operationsRateLimited(identity, '/queue', 1_002, 2), true);
    assert.equal(operationsRateLimited(identity, '/issues', 1_002, 2), false);
    assert.equal(operationsRateLimited(identity, '/queue', 61_001, 2), false);
  });

  it('maps database details to stable public errors without exposing internals', async () => {
    const forbidden = operationDatabaseError({ code: '42501', message: 'secret table detail' });
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await forbidden.json(), {
      error: { code: 'forbidden', message: 'You do not have access to that operation.' },
    });
    const unavailable = operationDatabaseError({ code: 'XX000', message: 'private stack detail' });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), {
      error: { code: 'operations_unavailable', message: 'Operations are temporarily unavailable.' },
    });
  });
});
