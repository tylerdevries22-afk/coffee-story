import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FONT_REGISTRY, isRegisteredFont, resolveFontFace } from './font-registry';

describe('font registry', () => {
  it('resolves every weight the native theme exports', () => {
    assert.equal(resolveFontFace('Inter', 400), 'Inter_400Regular');
    assert.equal(resolveFontFace('Inter', 600), 'Inter_600SemiBold');
    assert.equal(resolveFontFace('Fraunces', 700), 'Fraunces_700Bold');
  });

  it('falls back to a real system face for an unsupported tenant family', () => {
    assert.equal(isRegisteredFont('Unbundled Sans'), false);
    assert.equal(resolveFontFace('Unbundled Sans', 400), 'System');
  });

  it('keeps registry keys and declared families aligned', () => {
    for (const [key, font] of Object.entries(FONT_REGISTRY)) assert.equal(key, font.family);
  });
});
