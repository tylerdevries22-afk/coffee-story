import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseMenuCsv } from './menu-csv';
import { buildTenantMenu } from './tenant-menu';

const parsed = parseMenuCsv(`slug,name,category,description,base_price_cents,sizes
latte,Latte,Coffee,Steamed milk,500,12:450|16:500
cookie,Cookie,Bakery,Baked today,300,
`);

describe('buildTenantMenu', () => {
  it('preserves category order and converts database sizes to app sizes', () => {
    const result = buildTenantMenu(parsed.rows, [
      { id: 'coffee', title: 'Coffee', tagline: 'Pulled to order' },
      { id: 'bakery', title: 'Bakery', tagline: 'From the oven' },
    ], { latte: [{ id: 'milk' }] });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.menu.categories.map((category) => category.id), ['coffee', 'bakery']);
    assert.deepEqual(result.menu.items[0]?.sizes, [
      { slug: 'latte-12', ounces: 12, priceCents: 450 },
      { slug: 'latte-16', ounces: 16, priceCents: 500 },
    ]);
    assert.deepEqual(result.menu.items[1]?.sizes, [{ slug: 'cookie', priceCents: 300 }]);
    assert.deepEqual(result.menu.items[0]?.optionGroups, [{ id: 'milk' }]);
  });

  it('derives stable category ids when metadata is omitted', () => {
    const result = buildTenantMenu(parsed.rows, [], {});
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.menu.categories.map((category) => category.id), ['coffee', 'bakery']);
  });

  it('reports invalid metadata without discarding valid items', () => {
    const result = buildTenantMenu(parsed.rows, [
      { id: 'Bad ID', title: 'Coffee', tagline: '' },
    ], {});
    assert.ok(result.errors.some((error) => error.includes('invalid id')));
    assert.ok(result.errors.some((error) => error.includes('Bakery')));
    assert.equal(result.menu.items.length, 1);
  });

  it('compiles the tenant template without category drift', () => {
    const template = join(process.cwd(), '..', '..', 'tenants', '_template');
    const menu = parseMenuCsv(readFileSync(join(template, 'menu.csv'), 'utf8'));
    const categories = JSON.parse(readFileSync(join(template, 'menu-categories.json'), 'utf8')) as {
      id: string; title: string; tagline: string;
    }[];
    const result = buildTenantMenu(menu.rows, categories, {});
    assert.deepEqual([...menu.errors, ...result.errors], []);
    assert.equal(result.menu.items.length, menu.rows.length);
  });
});
