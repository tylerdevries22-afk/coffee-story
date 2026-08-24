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

  it('compiles pack metadata with stable slugs for the bundled clients', () => {
    const result = buildTenantMenu(parsed.rows, [], {}, {
      cookie: {
        packSize: 4, choiceSource: 'static', singleItemSlug: 'latte', eligibleItemSlugs: ['latte'],
      },
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.menu.items[1], {
      id: 'cookie',
      name: 'Cookie',
      description: 'Baked today',
      category: 'bakery',
      sizes: [{ slug: 'cookie', priceCents: 300 }],
      optionGroups: [],
      packSize: 4,
      choiceSource: 'static',
      singleItemId: 'latte',
      eligibleItemIds: ['latte'],
    });
  });

  it('rejects pack definitions that cannot survive the kiosk pack flow', () => {
    const result = buildTenantMenu(parsed.rows, [], { cookie: [{ id: 'required' }] }, {
      missing: {
        packSize: 4, choiceSource: 'static', singleItemSlug: 'latte', eligibleItemSlugs: ['latte'],
      },
      latte: {
        packSize: 4, choiceSource: 'static', singleItemSlug: 'cookie', eligibleItemSlugs: ['cookie'],
      },
      cookie: {
        packSize: 4, choiceSource: 'static', singleItemSlug: 'latte', eligibleItemSlugs: ['latte'],
      },
    });
    assert.ok(result.errors.some((error) => error.includes('"missing" is not in menu.csv')));
    assert.ok(result.errors.some((error) => error.includes('"latte" must have at most one size')));
    assert.ok(result.errors.some((error) => error.includes('"cookie" cannot have modifiers')));
    assert.equal(result.menu.items.some((item) => item.packSize !== undefined), false);
  });

  it('rejects missing, self-referential, and nested single-item links', () => {
    const missing = buildTenantMenu(parsed.rows, [], {}, {
      cookie: {
        packSize: 4, choiceSource: 'lineup', singleItemSlug: 'gone', eligibleItemSlugs: ['gone'],
      },
    });
    assert.ok(missing.errors.some((error) => error.includes('references missing single')));

    const self = buildTenantMenu(parsed.rows, [], {}, {
      cookie: {
        packSize: 4, choiceSource: 'lineup', singleItemSlug: 'cookie', eligibleItemSlugs: ['cookie'],
      },
    });
    assert.ok(self.errors.some((error) => error.includes('cannot use itself')));

    const plain = parseMenuCsv(`slug,name,category,description,base_price_cents,sizes
single,Single,Coffee,One,200,
pack-four,Four Pack,Coffee,Four,700,
pack-eight,Eight Pack,Coffee,Eight,1300,
`);
    const nested = buildTenantMenu(plain.rows, [], {}, {
      'pack-four': {
        packSize: 4, choiceSource: 'static', singleItemSlug: 'single', eligibleItemSlugs: ['single'],
      },
      'pack-eight': {
        packSize: 8, choiceSource: 'static', singleItemSlug: 'pack-four', eligibleItemSlugs: ['pack-four'],
      },
    });
    assert.ok(nested.errors.some((error) => error.includes('cannot use pack')));
  });

  it('requires an explicit, unique, non-pack eligibility set', () => {
    const missing = buildTenantMenu(parsed.rows, [], {}, {
      cookie: { packSize: 4, choiceSource: 'static', singleItemSlug: 'latte' },
    });
    assert.ok(missing.errors.some((error) => error.includes('eligibleItemSlugs')));

    const duplicate = buildTenantMenu(parsed.rows, [], {}, {
      cookie: {
        packSize: 4,
        choiceSource: 'static',
        singleItemSlug: 'latte',
        eligibleItemSlugs: ['latte', 'latte'],
      },
    });
    assert.ok(duplicate.errors.some((error) => error.includes('must not contain duplicates')));
  });

  it('compiles the tenant template without category drift', () => {
    const template = join(process.cwd(), '..', '..', 'tenants', '_template');
    const menu = parseMenuCsv(readFileSync(join(template, 'menu.csv'), 'utf8'));
    const categories = JSON.parse(readFileSync(join(template, 'menu-categories.json'), 'utf8')) as {
      id: string; title: string; tagline: string;
    }[];
    const packs = JSON.parse(readFileSync(join(template, 'packs.json'), 'utf8')) as Record<string, unknown>;
    const result = buildTenantMenu(menu.rows, categories, {}, packs);
    assert.deepEqual([...menu.errors, ...result.errors], []);
    assert.equal(result.menu.items.length, menu.rows.length);
  });
});
