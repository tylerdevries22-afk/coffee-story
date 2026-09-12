import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { safeImageSource } from './image-source';

describe('safeImageSource', () => {
  it('preserves web URLs, signed queries, local paths, and browser previews', () => {
    for (const value of ['https://assets.example/image.webp?token=signed', 'http://localhost/image.png',
      '/media/image.webp', 'blob:https://app.example/preview']) {
      assert.equal(safeImageSource(value), value);
    }
  });

  it('refuses non-image URL schemes, credentials, malformed URLs, and missing input', () => {
    for (const value of ['file:///image.png', 'mailto:media@example.com', 'data:text/html,',
      'https://user:password@assets.example/image.png', 'http://[', '', null, undefined]) {
      assert.equal(safeImageSource(value), null);
    }
    assert.equal(safeImageSource('a'.repeat(8193)), null);
  });
});
