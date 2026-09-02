import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { PrintStorage } from './print-outbox';
import { loadPrinterPreferences, savePrinterPreferences } from './printer-preferences';

class MemoryStorage implements PrintStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

it('persists only a usable selected printer as enabled', async () => {
  const storage = new MemoryStorage();
  assert.equal(await savePrinterPreferences(storage, 'l1', {
    enabled: true, printerName: 'Counter', printerUrl: 'ipp://printer.local',
  }), true);
  assert.deepEqual(await loadPrinterPreferences(storage, 'l1'), {
    enabled: true, printerName: 'Counter', printerUrl: 'ipp://printer.local',
  });
  await storage.setItem('platform:operator-printer:l2', JSON.stringify({ version: 1, enabled: true }));
  assert.equal((await loadPrinterPreferences(storage, 'l2')).enabled, false);
});
