import assert from 'node:assert/strict';
import test from 'node:test';

import { isNeutralColor, normalizeCssColor, paletteCandidates } from './css-colors';

test('every solid colour notation normalises to #RRGGBB', () => {
  const cases: [string, string | null][] = [
    ['#7a3e1d', '#7A3E1D'],
    ['#abc', '#AABBCC'],
    ['#abcf', '#AABBCC'],
    ['#7A3E1DFF', '#7A3E1D'],
    ['rgb(232 169 72)', '#E8A948'],
    ['rgb(232, 169, 72)', '#E8A948'],
    ['rgba(232,169,72,0.9)', '#E8A948'],
    ['rgb(100% 0% 0%)', '#FF0000'],
    ['hsl(0 100% 50%)', '#FF0000'],
    ['hsl(120, 100%, 25%)', '#008000'],
    ['hsla(240 100% 50% / 0.8)', '#0000FF'],
    ['#2F5D3A !important', '#2F5D3A'],
  ];
  for (const [value, expected] of cases) assert.equal(normalizeCssColor(value), expected, value);
});

test('what is not a solid colour is not a candidate', () => {
  for (const value of ['#12345', '#7A3E1D20', 'rgba(0, 0, 0, 0.2)', 'transparent', 'teal', 'var(--x)', 'rgb(1, 2)', 'calc(1px + 2px)', '']) {
    assert.equal(normalizeCssColor(value), null, value);
  }
});

test('whites, blacks and greys are neutral; real hues are not', () => {
  for (const hex of ['#FFFFFF', '#000000', '#222222', '#F7F7F5', '#808080']) assert.equal(isNeutralColor(hex), true, hex);
  for (const hex of ['#7A3E1D', '#2F5D3A', '#E8A948', '#1D4ED8']) assert.equal(isNeutralColor(hex), false, hex);
});

test('the theme colour leads, brand-named properties follow, aliases resolve and core presets are skipped', () => {
  const css = [
    ':root { --text: #222222; --wp--preset--color--vivid-red: #cf2e2e; --brand-accent: rgb(232 169 72); }',
    ':root { --color-primary: var(--palette-forest); --palette-forest: #2F5D3A; --fallback: var(--missing, #1D4ED8); }',
    '.dark { --text: #EEEEEE; }',
  ];
  const palette = paletteCandidates(['#7A3E1D'], css);
  assert.deepEqual(palette.map((color) => color.hex), ['#7A3E1D', '#2F5D3A', '#E8A948', '#1D4ED8', '#222222']);
  assert.deepEqual(palette[1]?.names, ['--color-primary', '--palette-forest']);
  assert.equal(palette.at(-1)?.neutral, true);
  assert.ok(!palette.some((color) => color.hex === '#CF2E2E'));
});

test('a stylesheet with no colours yields only the theme colour, and none yields nothing', () => {
  assert.deepEqual(paletteCandidates(['#7A3E1D'], ['body { margin: 0 }']).map((color) => color.hex), ['#7A3E1D']);
  assert.deepEqual(paletteCandidates([], []), []);
});
