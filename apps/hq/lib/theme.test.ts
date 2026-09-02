import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hqTheme } from './theme';

test('HQ variables resolve through the shared tenant token contract', () => {
  const variables = hqTheme({ tokens: {
    primary: '#123456', surface: '#F7F6F3', textPrimary: '#201A17',
    accent: '#654321', radius: { md: 20 },
  } });
  assert.equal(variables['--bg'], '#F7F6F3');
  assert.equal(variables['--text'], '#201A17');
  assert.equal(variables['--action'], '#123456');
  assert.equal(variables['--accent'], '#654321');
  assert.equal(variables['--hq-rail'], '#201A17');
  assert.equal(variables['--hq-rail-foreground'], '#FFFFFF');
  assert.equal(variables['--radius'], '20px');
  assert.equal(variables['--primary'], '#123456');
  assert.equal(variables['--background'], '#F7F6F3');
  assert.match(variables['--bg-hover'] ?? '', /#123456/);
});

test('the kiosk preview takes its surface from the tenant, not from one shop', () => {
  const mine = hqTheme({ tokens: { surface: '#FAF5EF', textPrimary: '#241710', primary: '#2E211A' } });
  const theirs = hqTheme({ tokens: { surface: '#F0F4FA', textPrimary: '#101724', primary: '#1A212E' } });
  assert.equal(mine['--kiosk-surface'], '#FAF5EF');
  assert.equal(theirs['--kiosk-surface'], '#F0F4FA');
  assert.equal(theirs['--kiosk-ink'], '#101724');
  assert.equal(theirs['--kiosk-hero'], '#1A212E');
  // The derived lines follow whichever palette they were given.
  assert.match(theirs['--kiosk-line'] ?? '', /#F0F4FA/);
  assert.notEqual(mine['--kiosk-line'], theirs['--kiosk-line']);
});

test('motion durations and curves are exposed as CSS variables', () => {
  const variables = hqTheme({ tokens: { motion: { fast: 100, base: 200, slow: 300 } } });
  assert.equal(variables['--motion-fast'], '100ms');
  assert.equal(variables['--motion-base'], '200ms');
  assert.equal(variables['--motion-slow'], '300ms');
  assert.match(variables['--ease-enter'] ?? '', /^cubic-bezier\(0\.16, 1, 0\.3, 1\)$/);
  assert.match(variables['--ease-land'] ?? '', /^cubic-bezier\(/);
  assert.equal(variables['--radius-sm'], '8px');
  assert.equal(variables['--type-xs'], '12px');
});

test('wall tap target is at least 44px under default tokens', () => {
  const variables = hqTheme(null);
  assert.ok(Number.parseFloat(variables['--wall-tap-target'] ?? '0') >= 44);
  assert.ok(Number.parseFloat(variables['--wall-chip-min'] ?? '0') < Number.parseFloat(variables['--wall-chip-max'] ?? '0'));
});
