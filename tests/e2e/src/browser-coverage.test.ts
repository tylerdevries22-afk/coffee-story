import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isProjectSource, normalizeCoveragePath } from './browser-coverage.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('browser coverage source mapping', () => {
  it('maps Expo and Next virtual sources back to tracked workspace files', () => {
    assert.equal(
      normalizeCoveragePath('../../../src/screens/order.tsx', 'http://127.0.0.1:4381/_expo/app.js'),
      `${ROOT}/apps/customer/src/screens/order.tsx`,
    );
    assert.equal(
      normalizeCoveragePath('webpack://_N_E/./app/page.tsx', 'http://127.0.0.1:4383/_next/app.js'),
      `${ROOT}/apps/hq/app/page.tsx`,
    );
    assert.equal(
      normalizeCoveragePath('../../packages/domain/src/orders.ts', 'http://127.0.0.1:4382/app.js'),
      `${ROOT}/packages/domain/src/orders.ts`,
    );
    assert.equal(
      normalizeCoveragePath('../../node_modules/@platform/domain/src/orders.ts'),
      `${ROOT}/packages/domain/src/orders.ts`,
    );
  });

  it('keeps application source and rejects dependencies and generated output', () => {
    assert.equal(isProjectSource('../../../src/features/order.ts'), true);
    assert.equal(isProjectSource('../../packages/domain/src/orders.ts'), true);
    assert.equal(isProjectSource('../../node_modules/@platform/domain/src/orders.ts'), true);
    assert.equal(isProjectSource('webpack://_N_E/./app/page.tsx'), false);
    assert.equal(isProjectSource('../../node_modules/react/index.js'), false);
    assert.equal(isProjectSource('apps/customer/dist-e2e/app.js'), false);
  });
});
