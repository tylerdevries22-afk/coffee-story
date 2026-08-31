import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { brandEditorStateOf, brandSettingsPatch } from './brand-config';

describe('brandEditorStateOf', () => {
  it('hydrates valid persisted settings and rejects malformed fields individually', () => {
    const state = brandEditorStateOf({
      tokens: { primary: '#123456', accent: 'red' },
      copy: { appName: ' North Star ', pointsName: '' },
      features: { drops: true, sms: 'yes' },
      board: { tiers: [{ slug: 'local', label: 'Local', minLifetimePoints: 900, tone: 'accent', color: '#ABCDEF', icon: '◆' }] },
    });
    assert.equal(state.tokens.primary, '#123456');
    assert.equal(state.tokens.accent, '#4A5568');
    assert.equal(state.appName, 'North Star');
    assert.equal(state.pointsName, 'Points');
    assert.equal(state.flags.drops, true);
    assert.equal(state.flags.sms, false);
    assert.deepEqual(state.tiers, [{ slug: 'local', label: 'Local', minLifetimePoints: 900, tone: 'accent', color: '#ABCDEF', icon: '◆' }]);
  });

  it('returns detached defaults for an absent config', () => {
    const first = brandEditorStateOf(null);
    first.tiers[0]!.label = 'Changed';
    assert.notEqual(brandEditorStateOf(null).tiers[0]!.label, 'Changed');
  });

  it('pre-fills no other brand into an unconfigured editor', () => {
    // Whatever is on screen is one Save away from this brand's own row.
    const state = brandEditorStateOf(null);
    const words = state.tiers.flatMap((tier) => [tier.slug, tier.label]).join(' ').toLowerCase();
    for (const word of ['coffee', 'sip', 'ritual', 'house', 'brew', 'roast']) {
      assert.ok(!words.includes(word), `the default ladder says "${word}"`);
    }
    assert.deepEqual(state.tiers.map((tier) => tier.color), ['', '', '', '']);
  });
});

describe('brandSettingsPatch', () => {
  it('writes only the four config sections the editor owns', () => {
    const patch = brandSettingsPatch({ appName: 'A', pointsName: 'Stars' });
    assert.deepEqual(Object.keys(patch).sort(), ['board', 'copy', 'features', 'tokens']);
    assert.equal('kiosk' in patch, false);
    assert.equal('tax' in patch, false);
  });
});
