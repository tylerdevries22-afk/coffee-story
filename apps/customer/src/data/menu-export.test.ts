import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseMenuCsv } from '@platform/schema';

import { CATALOG_ITEMS } from './catalog-data';
import { menuCsv, menuModifiersJson, sizeSuffix } from './menu-export';

const TENANT_DIR = join(__dirname, '../../../../tenants/coffee-story');

describe('menu export', () => {
  it('the generated app catalog preserves tenants/coffee-story/menu.csv', () => {
    const committed = readFileSync(join(TENANT_DIR, 'menu.csv'), 'utf8');
    assert.equal(committed, menuCsv());
  });

  it('the generated app catalog preserves tenants/coffee-story/modifiers.json', () => {
    const committed = readFileSync(join(TENANT_DIR, 'modifiers.json'), 'utf8');
    assert.equal(committed, menuModifiersJson());
  });

  it('emits CSV the schema parser accepts, one row per catalog item', () => {
    const parsed = parseMenuCsv(menuCsv());
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, CATALOG_ITEMS.length);
    const latte = parsed.rows.find((row) => row.slug === 'latte');
    assert.deepEqual(latte?.sizes.map((size) => size.slug), ['12', '16', '20']);
    const espresso = parsed.rows.find((row) => row.slug === 'espresso');
    assert.deepEqual(espresso?.sizes, [], 'single-serve items carry no size list');
  });

  it('translates catalog size slugs to database size slugs', () => {
    assert.equal(sizeSuffix('latte', 'latte-16'), '16');
    assert.equal(sizeSuffix('mochi-donut', 'mochi-donut-trio'), 'trio');
    assert.equal(sizeSuffix('espresso', 'espresso'), null);
  });
});
