import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { coverageLinePercent, filterBrowserCoverage, isCountedBrowserFile } from './merge-coverage.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('merged coverage gate', () => {
  it('reads a finite line percentage at the report boundary', () => {
    assert.equal(coverageLinePercent({ total: { lines: { pct: 70.01 } } }), 70.01);
  });

  it('rejects missing, nonnumeric, and nonfinite percentages', () => {
    assert.throws(() => coverageLinePercent({}), /no numeric/);
    assert.throws(() => coverageLinePercent({ total: { lines: { pct: '70' } } }), /no numeric/);
    assert.throws(() => coverageLinePercent({ total: { lines: { pct: Number.NaN } } }), /no numeric/);
  });

  it('keeps tracked TypeScript source and rejects generated browser entries', () => {
    const source = `${ROOT}/apps/customer/src/lib/runtime-config.ts`;
    const component = `${ROOT}/apps/customer/src/screens/order.tsx`;
    const chunk = `${ROOT}/127.0.0.1-4383/_next/static/chunks/app.js`;
    const dependencyAlias = `${ROOT}/apps/customer/src/ExpoFileSystem.web.ts`;
    assert.equal(isCountedBrowserFile(source), true);
    assert.equal(isCountedBrowserFile(component), true);
    assert.equal(isCountedBrowserFile(chunk), false);
    assert.equal(isCountedBrowserFile(dependencyAlias), false);
    assert.equal(isCountedBrowserFile(`${ROOT}/apps/customer/src/data.generated.ts`), false);
    assert.deepEqual(filterBrowserCoverage({ [source]: {}, [chunk]: {} }), { [source]: {} });
  });
});
