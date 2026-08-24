import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hqTheme } from './theme';

test('HQ variables resolve through the shared tenant token contract', () => {
  const variables = hqTheme({ tokens: { primary: '#123456', accent: '#654321', radius: { md: 20 } } });
  assert.equal(variables['--bg'], '#123456');
  assert.equal(variables['--accent'], '#654321');
  assert.equal(variables['--radius'], '20px');
  assert.match(variables['--bg-hover'] ?? '', /#123456/);
});
