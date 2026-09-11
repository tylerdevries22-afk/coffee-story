import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isCanonicalPostgresUuid, isCanonicalTenantPackageObjectPath,
  isSafeTenantPackageRelativePath, parseTenantPackageObjectPath,
} from './object-path';

const BRAND = '00000000-0000-0000-0000-000000000000';
const LETTERED_BRAND = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ARTIFACT = 'a'.repeat(64);
const ENVELOPE = 'b'.repeat(64);

describe('tenant package object paths', () => {
  it('accepts canonical modern and legacy archive, file, and preview paths', () => {
    const modern = `${BRAND}/${ARTIFACT}/${ENVELOPE}`;
    const legacy = `${BRAND}/${ARTIFACT}`;
    for (const path of [
      `${modern}/archive.zip`, `${modern}/files/menu/photo.webp`,
      `${modern}/previews/menu/photo.webp.png`, `${legacy}/archive.zip`,
      `${legacy}/files/brand.json`, `${legacy}/previews/brand.json.png`,
    ]) assert.equal(isCanonicalTenantPackageObjectPath(path), true, path);
    assert.deepEqual(parseTenantPackageObjectPath(`${modern}/archive.zip`), {
      format: 'modern', namespace: modern,
    });
    assert.deepEqual(parseTenantPackageObjectPath(`${legacy}/files/brand.json`), {
      format: 'legacy', namespace: legacy,
    });
  });

  it('uses PostgreSQL canonical UUID text without RFC version restrictions', () => {
    assert.equal(isCanonicalPostgresUuid(BRAND), true);
    assert.equal(isCanonicalPostgresUuid('ffffffff-ffff-ffff-ffff-ffffffffffff'), true);
    assert.equal(isCanonicalPostgresUuid(LETTERED_BRAND.toUpperCase()), false);
    assert.equal(isCanonicalPostgresUuid('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'), false);
  });

  it('rejects unsafe components, noncanonical identities, and oversized UTF-8 paths', () => {
    const prefix = `${BRAND}/${ARTIFACT}/${ENVELOPE}`;
    for (const suffix of [
      'files/', 'files//name', 'files/../archive.zip', 'previews/./name',
      'files/name\\evil', 'files/name\u0000evil', 'files/name\u0085evil',
      'other/name', 'archive.zip/extra',
    ]) assert.equal(isCanonicalTenantPackageObjectPath(`${prefix}/${suffix}`), false, suffix);
    assert.equal(isCanonicalTenantPackageObjectPath(
      `${LETTERED_BRAND.toUpperCase()}/${ARTIFACT}/${ENVELOPE}/archive.zip`,
    ), false);
    assert.equal(isCanonicalTenantPackageObjectPath(
      `${prefix}/files/${'é'.repeat(700)}`,
    ), false);
    assert.equal(isCanonicalTenantPackageObjectPath(`${prefix}/files/${'x'.repeat(1327)}`), true);
    assert.equal(isCanonicalTenantPackageObjectPath(`${prefix}/files/${'x'.repeat(1328)}`), false);
  });

  it('applies the same component and UTF-8 rules to manifest relative paths', () => {
    assert.equal(isSafeTenantPackageRelativePath('menu/photo.webp'), true);
    for (const path of ['', '/root', 'a//b', 'a/../b', 'a\\b', 'a/']) {
      assert.equal(isSafeTenantPackageRelativePath(path), false, path);
    }
    assert.equal(isSafeTenantPackageRelativePath('é'.repeat(513)), false);
  });
});
