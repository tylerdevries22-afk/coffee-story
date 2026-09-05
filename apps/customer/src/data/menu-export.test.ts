import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseMenuCsv } from '@platform/schema';

import { CATALOG_ITEMS } from './catalog-data';
import { menuCsv, menuModifiersJson, sizeSuffix } from './menu-export';
import { TENANT_SLUG } from '../tenant';

const TENANT_DIR = join(__dirname, '../../../../tenants', TENANT_SLUG);

describe('menu export', () => {
  it('the generated app catalog preserves the selected tenant menu', () => {
    const committed = readFileSync(join(TENANT_DIR, 'menu.csv'), 'utf8');
    assert.deepEqual(parseMenuCsv(menuCsv()), parseMenuCsv(committed));
  });

  it('the generated app catalog preserves the selected tenant modifiers', () => {
    const path = join(TENANT_DIR, 'modifiers.json');
    const committed = existsSync(path) ? readFileSync(path, 'utf8') : '{}\n';
    assert.equal(committed, menuModifiersJson());
  });

  it('emits CSV the schema parser accepts, one row per catalog item', () => {
    const parsed = parseMenuCsv(menuCsv());
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, CATALOG_ITEMS.length);
    assert.deepEqual(
      parsed.rows.map((row) => row.slug),
      CATALOG_ITEMS.map((item) => item.id),
    );
  });

  it('translates catalog size slugs to database size slugs', () => {
    assert.equal(sizeSuffix('latte', 'latte-16'), '16');
    assert.equal(sizeSuffix('mochi-donut', 'mochi-donut-trio'), 'trio');
    assert.equal(sizeSuffix('espresso', 'espresso'), null);
  });
});
