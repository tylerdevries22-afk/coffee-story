import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEMO_ADD_ONS } from '@platform/domain';

// Contract for the Coffee Story drink customization list.
describe('DEMO_ADD_ONS', () => {
  it('matches the menu add-on catalog exactly', () => {
    assert.deepEqual(
      DEMO_ADD_ONS.map(({ slug, name, priceCents, durationMin }) => ({ slug, name, priceCents, durationMin })),
      [
        { slug: 'extra-shot', name: 'Extra Espresso Shot', priceCents: 150, durationMin: 0 },
        { slug: 'oat-milk', name: 'Oat Milk', priceCents: 75, durationMin: 0 },
        { slug: 'boba-pearls', name: 'Boba Pearls', priceCents: 100, durationMin: 0 },
        { slug: 'pistachio-cold-foam', name: 'Pistachio Cold Foam', priceCents: 125, durationMin: 0 },
      ],
    );
  });
});
