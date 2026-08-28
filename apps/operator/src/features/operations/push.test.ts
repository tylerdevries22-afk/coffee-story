import assert from 'node:assert/strict';
import test from 'node:test';

import { operationNotificationOccurrenceId } from './push-navigation';

test('notification navigation accepts only a UUID occurrence identifier', () => {
  assert.equal(operationNotificationOccurrenceId({
    occurrenceId: '50000000-0000-4000-8000-000000000001',
  }), '50000000-0000-4000-8000-000000000001');
  assert.equal(operationNotificationOccurrenceId({ occurrenceId: '/staff/orders' }), null);
  assert.equal(operationNotificationOccurrenceId({ url: 'https://example.com' }), null);
});
