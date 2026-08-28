import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createOperationNotificationReadBus,
  operationNotificationBatches,
} from './notification-reads';

describe('operation notification acknowledgements', () => {
  it('deduplicates and chunks IDs to the API boundary', () => {
    const ids = Array.from({ length: 205 }, (_, index) => `notification-${index}`);
    assert.deepEqual(operationNotificationBatches([...ids, ids[0]!]).map((batch) => batch.length),
      [100, 100, 5]);
    assert.deepEqual(operationNotificationBatches(ids, 0), []);
  });

  it('publishes successful reads and supports clean unsubscription', () => {
    const bus = createOperationNotificationReadBus();
    const received: string[][] = [];
    const unsubscribe = bus.subscribe((ids) => received.push([...ids]));
    bus.publish(['one', 'two', 'one']);
    unsubscribe();
    bus.publish(['three']);
    assert.deepEqual(received, [['one', 'two']]);
  });
});
