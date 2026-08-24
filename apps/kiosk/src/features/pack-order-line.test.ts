import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildOrderLine } from '@platform/domain';

import { withPackFill } from './pack-order-line';

function sixPackLine() {
  return buildOrderLine({
    itemId: 'mochi-six-pack',
    name: 'Mochi Six Pack',
    sizeSlug: 'mochi-six-pack',
    sizeLabel: 'Six pack',
    basePriceCents: 2100,
    groups: [],
    selection: {},
  });
}

const NAME: Record<string, string> = { matcha: 'Matcha', ube: 'Ube' };

describe('withPackFill', () => {
  it('refuses an incomplete pack rather than losing its contents', () => {
    assert.equal(withPackFill(sixPackLine(), 6, { matcha: 5 }, (id) => NAME[id] ?? id), null);
  });

  it('adds readable contents to the bag and a structured fulfillment recipe', () => {
    const line = withPackFill(sixPackLine(), 6, { matcha: 2, ube: 4 }, (id) => NAME[id] ?? id);
    assert.ok(line);
    assert.match(line.optionSummary, /2 × Matcha, 4 × Ube/);
    assert.deepEqual(line.packContents, [
      { itemSlug: 'matcha', name: 'Matcha', quantity: 2 },
      { itemSlug: 'ube', name: 'Ube', quantity: 4 },
    ]);
  });

  it('gives differently filled boxes different cart identities', () => {
    const mixed = withPackFill(sixPackLine(), 6, { matcha: 2, ube: 4 }, (id) => NAME[id] ?? id);
    const matcha = withPackFill(sixPackLine(), 6, { matcha: 6 }, (id) => NAME[id] ?? id);
    assert.ok(mixed);
    assert.ok(matcha);
    assert.notEqual(mixed.id, matcha.id);
  });

  it('does not truncate long display names because the wire uses stable slugs', () => {
    const longName = 'A'.repeat(190);
    const longId = 'long-choice-'.repeat(18);
    const line = withPackFill(sixPackLine(), 6, { [longId]: 6 }, () => longName);
    assert.ok(line);
    assert.equal(line.packContents?.[0]?.name, longName);
  });
});
