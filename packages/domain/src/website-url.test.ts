import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWebsiteUrl } from './website-url';

test('resolves internal paths against the brand website', () => {
  assert.equal(resolveWebsiteUrl('/menu', 'https://example.com'), 'https://example.com/menu');
  assert.equal(resolveWebsiteUrl('/menu', 'https://example.com/'), 'https://example.com/menu');
});

test('refuses external or scheme-relative escapes', () => {
  assert.throws(() => resolveWebsiteUrl('//attacker.example', 'https://example.com'));
  assert.throws(() => resolveWebsiteUrl('/\\attacker.example/x', 'https://example.com'));
  assert.throws(() => resolveWebsiteUrl('menu', 'https://example.com'));
  assert.throws(() => resolveWebsiteUrl('/menu', 'http://example.com'));
});
