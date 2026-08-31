import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { previewTargets } from './preview-directory';

const directory = JSON.stringify([
  { slug: 'alpha-coffee', label: 'Alpha Coffee', urls: { customer: 'https://alpha.example/customer#top' } },
  { slug: 'beta-coffee', label: 'Beta Coffee', urls: { customer: 'http://127.0.0.1:3000/' } },
]);

describe('previewTargets', () => {
  it('selects a surface, identifies the current tenant, and strips fragments', () => {
    assert.deepEqual(previewTargets(directory, 'customer', 'alpha-coffee'), [
      { slug: 'alpha-coffee', label: 'Alpha Coffee', url: 'https://alpha.example/customer', current: true },
      { slug: 'beta-coffee', label: 'Beta Coffee', url: 'http://127.0.0.1:3000/', current: false },
    ]);
  });

  it('rejects credentials, insecure remote URLs, duplicates, and malformed input', () => {
    const unsafe = JSON.stringify([
      { slug: 'alpha', label: 'Alpha', urls: { kiosk: 'http://example.com' } },
      { slug: 'beta', label: 'Beta', urls: { kiosk: 'https://user:secret@example.com' } },
      { slug: 'alpha', label: 'Duplicate', urls: { kiosk: 'https://safe.example' } },
    ]);
    assert.deepEqual(previewTargets(unsafe, 'kiosk', 'alpha'), [
      { slug: 'alpha', label: 'Duplicate', url: 'https://safe.example/', current: true },
    ]);
    assert.deepEqual(previewTargets('{', 'display', 'alpha'), []);
  });
});
