/**
 * The Operations page and its CSV export must answer "is operations on?"
 * from the same place.
 *
 * 20260903220000 moved the grant onto an active `workforce-operations`
 * installation. The page loader (apps/hq/lib/operations-data.ts) followed;
 * the export route kept reading the retired `brands.operations` boolean. So a
 * brand that installed the module without anyone setting the legacy column
 * saw a working page and a 404 on the Export link it offers.
 *
 * Two surfaces gating one capability on two sources is how a tenant sees a
 * feature and cannot use it. This pins both to the installation.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const PAGE = join(ROOT, 'apps', 'hq', 'lib', 'operations-data.ts');
const EXPORT = join(ROOT, 'apps', 'hq', 'app', '(console)', 'operations', 'reporting', 'export', 'route.ts');

describe('operations gates agree', () => {
  it('both resolve the capability from the module installation', () => {
    for (const file of [PAGE, EXPORT]) {
      const source = readFileSync(file, 'utf8');
      assert.match(source, /activeModuleKeys\(/,
        `${file.slice(ROOT.length + 1)} does not resolve operations via activeModuleKeys`);
      assert.match(source, /'workforce-operations'/,
        `${file.slice(ROOT.length + 1)} does not gate on the workforce-operations module`);
    }
  });

  /** The retired column: reading it anywhere on this path reopens the drift. */
  it('neither reads brands.operations', () => {
    for (const file of [PAGE, EXPORT]) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /select\(\s*'operations'\s*\)/,
        `${file.slice(ROOT.length + 1)} still reads the retired brands.operations column`);
    }
  });
});
