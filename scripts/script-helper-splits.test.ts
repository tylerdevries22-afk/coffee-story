import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import ts from 'typescript';

import { hashBytes, menuImagePaths } from './menu-image-runtime.js';
import { mutantsFor } from './mutate-analysis.js';
import {
  hashProductCutout,
  productCutoutPaths,
  productCutoutTenant,
  productStem,
} from './product-cutout-config.js';
import { bleedUnderAlpha, measureMatte } from './product-cutout-matte.js';

describe('script helper splits', () => {
  it('keeps mutation discovery behavior outside type-only syntax', () => {
    const source = ts.createSourceFile(
      'sample.ts',
      "type Flag = true;\nif (!items.includes('x') && count >= 2) return false;",
      ts.ScriptTarget.ESNext,
      true,
    );
    const mutants = mutantsFor(source);
    assert.equal(mutants.some(({ line }) => line === 1), false);
    assert.ok(mutants.some(({ operator, original }) => operator === 'predicate' && original.includes('includes')));
    assert.ok(mutants.some(({ operator, original }) => operator === 'negation' && original === '!'));
    assert.ok(mutants.some(({ operator, original }) => operator === 'binary' && original === '>='));
    assert.ok(mutants.some(({ operator, original }) => operator === 'boolean' && original === 'false'));
  });

  it('keeps normalizer paths, tenant precedence, stems, and hashes stable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'normalizer-split-'));
    try {
      const tenantDir = join(root, 'tenants', 'coffee-story');
      await mkdir(tenantDir, { recursive: true });
      await writeFile(join(tenantDir, 'brand.json'), '{"identity":{"name":"Coffee Story"}}');
      const menu = menuImagePaths(root, 'coffee-story');
      assert.equal(menu.brandName, 'Coffee Story');
      assert.equal(menu.menuDir, join(tenantDir, 'assets', 'menu'));
      assert.equal(productCutoutPaths(root, 'coffee-story').products, join(tenantDir, 'assets/products'));
      assert.equal(productCutoutTenant(['--tenant', 'flag-tenant'], 'env-tenant'), 'flag-tenant');
      assert.equal(productCutoutTenant([], 'env-tenant'), 'env-tenant');
      assert.equal(productStem('drink.png'), 'drink');
      assert.equal(hashBytes(Buffer.from('same')), hashProductCutout(Buffer.from('same')));
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('bleeds RGB outward without changing alpha and measures one connected subject', () => {
    const raw = {
      width: 3,
      height: 1,
      data: Buffer.from([9, 9, 9, 0, 10, 20, 30, 255, 8, 8, 8, 0]),
    };
    const bled = bleedUnderAlpha(raw, 1);
    assert.deepEqual([...bled], [10, 20, 30, 0, 10, 20, 30, 255, 10, 20, 30, 0]);
    assert.deepEqual(measureMatte(raw), {
      subjectMass: 1,
      softEdge: 0,
      rimLuminance: 0,
      innerLuminance: 0,
    });
  });
});
