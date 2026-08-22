import assert from 'node:assert/strict';
import test from 'node:test';

import { isTenantRedirect, tenantSchemeOf } from './tenant-redirect';

const CONFIG = { identity: { scheme: 'coffeestory' } };

test('reads the tenant scheme from brand config', () => {
  assert.equal(tenantSchemeOf(CONFIG), 'coffeestory');
  assert.equal(tenantSchemeOf({ identity: { scheme: 'CoffeeStory' } }), 'coffeestory');
});

test('treats a missing or unusable scheme as none at all', () => {
  for (const config of [null, undefined, {}, { identity: {} }, { identity: { scheme: 42 } },
    { identity: { scheme: 'has space' } }, { identity: { scheme: 'evil://x' } }]) {
    assert.equal(tenantSchemeOf(config), null);
  }
});

test('accepts this tenant’s own deep link', () => {
  const scheme = tenantSchemeOf(CONFIG);
  assert.equal(isTenantRedirect('coffeestory://order', scheme), true);
  assert.equal(isTenantRedirect('coffeestory://client/book?x=1', scheme), true);
  assert.equal(isTenantRedirect('CoffeeStory://order', scheme), true, 'schemes are case-insensitive in URLs');
});

test('refuses anywhere else, including plausible lookalikes', () => {
  const scheme = tenantSchemeOf(CONFIG);
  for (const value of [
    'https://coffeestory.example.com/thanks',
    'http://localhost/steal',
    'coffeestory.evil://order',
    'coffee-story://order',
    'javascript:alert(1)',
    'data:text/html,<script>',
    'file:///etc/passwd',
    '//evil.example.com',
    'not a url',
    '',
  ]) {
    assert.equal(isTenantRedirect(value, scheme), false, value);
  }
});

test('refuses non-strings and oversized values', () => {
  const scheme = tenantSchemeOf(CONFIG);
  for (const value of [undefined, null, 42, {}, ['coffeestory://order']]) {
    assert.equal(isTenantRedirect(value, scheme), false);
  }
  assert.equal(isTenantRedirect(`coffeestory://${'a'.repeat(600)}`, scheme), false);
});

test('a brand that declares no scheme accepts no redirect', () => {
  assert.equal(isTenantRedirect('coffeestory://order', null), false);
});
