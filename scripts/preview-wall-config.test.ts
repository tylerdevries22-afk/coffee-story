import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  parseBuildContext,
  parseWallSource,
  readTenantContext,
  requestedTenant,
  resolveWall,
} from './preview-wall-config';

const root = join(import.meta.dirname, '..');
const source = parseWallSource(JSON.parse(
  readFileSync(join(root, 'tools', 'preview-wall', 'surfaces.json'), 'utf8'),
) as unknown);

function tenant(modules: unknown, slug = 'northstar-builders'): string {
  const directory = mkdtempSync(join(tmpdir(), 'preview-wall-'));
  const tenantDirectory = join(directory, 'tenants', slug);
  mkdirSync(tenantDirectory, { recursive: true });
  writeFileSync(join(tenantDirectory, 'brand.json'), JSON.stringify({
    identity: { slug, name: 'Northstar Builders' },
  }));
  writeFileSync(join(tenantDirectory, 'modules.json'), JSON.stringify(modules));
  return directory;
}

const manifest = (enabled: boolean) => ({
  schemaVersion: 1,
  modules: [{
    key: 'construction-projects',
    version: '1.0.0',
    surfaces: ['operator', 'hq'],
    enabled,
  }],
});

describe('preview wall publisher', () => {
  it('ships all three canonical choices on every app', () => {
    assert.deepEqual(source.devicePresets.map(({ id }) => id), ['desktop', 'tablet', 'mobile']);
    assert.equal(source.surfaces.length, 5);
    assert.equal(source.surfaces.every(({ devices }) => devices.length === 3), true);
  });

  it('defaults a general Operator to tablet', () => {
    const published = resolveWall(source, {
      tenantKey: 'general-demo', organizationName: 'General Demo', capabilities: [],
    });
    assert.equal(published.surfaces.find(({ launch }) => launch === 'operator-web')?.activeDevice, 'tablet');
    assert.equal('capabilities' in published.context, false);
  });

  it('derives construction presentation from enabled capabilities', () => {
    const context = readTenantContext(tenant(manifest(true)), 'northstar-builders');
    const published = resolveWall(source, context);
    assert.equal(published.surfaces.find(({ launch }) => launch === 'operator-web')?.activeDevice, 'mobile');
    assert.equal(published.surfaces.find(({ launch }) => launch === 'display')?.name, 'Activity board');
  });

  it('does not apply construction preferences when its module is disabled', () => {
    const context = readTenantContext(tenant(manifest(false)), 'northstar-builders');
    const published = resolveWall(source, context);
    assert.equal(published.surfaces.find(({ launch }) => launch === 'operator-web')?.activeDevice, 'tablet');
  });

  it('honors the manifest default when enabled is omitted', () => {
    const modules = manifest(true);
    delete (modules.modules[0] as { enabled?: boolean }).enabled;
    const published = resolveWall(source, readTenantContext(tenant(modules), 'northstar-builders'));
    assert.equal(published.surfaces.find(({ launch }) => launch === 'operator-web')?.activeDevice, 'mobile');
  });

  it('fails closed for identity mismatch and malformed modules', () => {
    const mismatch = tenant(manifest(true));
    const brandPath = join(mismatch, 'tenants', 'northstar-builders', 'brand.json');
    writeFileSync(brandPath, JSON.stringify({ identity: { slug: 'other', name: 'Other' } }));
    assert.throws(() => readTenantContext(mismatch, 'northstar-builders'), /requested tenant identity/);
    const malformed = tenant({ schemaVersion: 1, modules: [{ key: 'construction-projects', enabled: 'yes' }] });
    assert.throws(() => readTenantContext(malformed, 'northstar-builders'), /modules\.json is invalid/);
  });

  it('names malformed tenant files without exposing parser internals', () => {
    const directory = tenant(manifest(true));
    writeFileSync(join(directory, 'tenants', 'northstar-builders', 'modules.json'), '{');
    assert.throws(() => readTenantContext(directory, 'northstar-builders'), /modules\.json must contain valid JSON/);
  });

  it('validates persisted build identity', () => {
    assert.equal(parseBuildContext({ tenantKey: 'northstar-builders' }), 'northstar-builders');
    assert.throws(() => parseBuildContext({ tenantKey: '../northstar' }), /build context is invalid/);
  });

  it('accepts a CLI tenant and rejects conflicting build inputs', () => {
    assert.equal(requestedTenant(['--tenant', 'northstar-builders'], undefined), 'northstar-builders');
    assert.equal(requestedTenant([], 'northstar-builders'), 'northstar-builders');
    assert.throws(
      () => requestedTenant(['--tenant', 'northstar-builders'], 'other-tenant'),
      /conflicts/,
    );
  });
});
