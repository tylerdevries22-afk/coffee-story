import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseOrgDraft } from './org-input';
import {
  TenantPackRefusedError, tenantFolderTaken, tenantPackFromDraft, tryWriteTenantPack, writeTenantPack,
} from './tenant-pack-write';

const parsed = parseOrgDraft({
  name: 'Harbor Roast',
  ownerEmail: 'owner@harbor.example',
  organizationKind: 'independent',
  industryKey: 'coffee-shop',
  blueprintKey: 'coffee-shop',
  location: {
    name: 'Waterfront',
    street: '12 Pier',
    city: 'Tacoma',
    region: 'WA',
    postal: '98402',
    timezone: 'America/Los_Angeles',
    openTime: '07:00',
    closeTime: '15:00',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  },
});

describe('tenant pack from wizard draft', () => {
  it('builds a pack from a valid org draft', () => {
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const pack = tenantPackFromDraft(parsed.draft);
    assert.equal(pack.slug, 'harbor-roast');
    assert.equal((pack.files['brand.json'].identity as { slug: string }).slug, 'harbor-roast');
    assert.equal(JSON.stringify(pack).includes('coffee-story'), false);
  });

  it('writes the pack under tenants/<slug>', () => {
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const root = mkdtempSync(join(tmpdir(), 'tenants-'));
    try {
      const dest = writeTenantPack(root, tenantPackFromDraft(parsed.draft));
      assert.equal(dest, join(root, 'harbor-roast'));
      const brand = JSON.parse(readFileSync(join(dest, 'brand.json'), 'utf8')) as { identity: { name: string } };
      assert.equal(brand.identity.name, 'Harbor Roast');
      const parent = mkdtempSync(join(tmpdir(), 'repo-'));
      try {
        mkdirSync(join(parent, 'tenants'));
        const written = tryWriteTenantPack(tenantPackFromDraft(parsed.draft), parent);
        assert.deepEqual(written, { kind: 'written', path: join(parent, 'tenants', 'harbor-roast') });
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('hours in the pack', () => {
  it('writes an overnight span past 24:00, the way brand.json orders it', () => {
    const late = parseOrgDraft({
      name: 'Harbor Late', ownerEmail: 'owner@harbor.example', organizationKind: 'independent',
      industryKey: 'coffee-shop', blueprintKey: 'coffee-shop',
      location: {
        name: 'Waterfront', timezone: 'America/Los_Angeles',
        hours: JSON.stringify({
          thu: [{ open: '07:00', close: '15:00' }],
          fri: [{ open: '18:00', close: '02:00' }],
          sat: [{ open: '18:00', close: '00:00' }],
          sun: [{ open: '00:00', close: '23:59' }],
        }),
      },
    });
    assert.ok(late.ok);
    // The draft keeps what the database's scheduler reads: the close as typed.
    assert.deepEqual(late.draft.location?.hours.fri, [{ open: '18:00', close: '02:00' }]);
    const brand = tenantPackFromDraft(late.draft).files['brand.json'] as {
      locations: { hours: Record<string, { open: string; close: string }[]> }[];
    };
    assert.deepEqual(brand.locations[0]?.hours, {
      mon: [], tue: [], wed: [],
      thu: [{ open: '07:00', close: '15:00' }],
      fri: [{ open: '18:00', close: '26:00' }],
      sat: [{ open: '18:00', close: '24:00' }],
      sun: [{ open: '00:00', close: '23:59' }],
    });
  });
});

describe('an existing tenant folder', () => {
  function withTenants(run: (parent: string, root: string) => void): void {
    const parent = mkdtempSync(join(tmpdir(), 'repo-'));
    const root = join(parent, 'tenants');
    mkdirSync(join(root, 'harbor-roast'), { recursive: true });
    writeFileSync(join(root, 'harbor-roast', 'brand.json'), '{"live":true}\n');
    try {
      run(parent, root);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }

  it('is refused, and left exactly as it was', () => {
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const pack = tenantPackFromDraft(parsed.draft);
    withTenants((_parent, root) => {
      assert.throws(() => writeTenantPack(root, pack),
        (error) => error instanceof TenantPackRefusedError && error.reason === 'exists');
      assert.equal(readFileSync(join(root, 'harbor-roast', 'brand.json'), 'utf8'), '{"live":true}\n');
    });
  });

  it('is reported to the caller rather than swallowed', () => {
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const pack = tenantPackFromDraft(parsed.draft);
    withTenants((parent, root) => {
      assert.deepEqual(tryWriteTenantPack(pack, parent), { kind: 'refused', reason: 'exists' });
      assert.equal(readFileSync(join(root, 'harbor-roast', 'brand.json'), 'utf8'), '{"live":true}\n');
    });
  });

  it('is only replaced on an explicit overwrite', () => {
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const pack = tenantPackFromDraft(parsed.draft);
    withTenants((_parent, root) => {
      writeTenantPack(root, pack, { overwrite: true });
      const brand = JSON.parse(readFileSync(join(root, 'harbor-roast', 'brand.json'), 'utf8')) as { identity: { name: string } };
      assert.equal(brand.identity.name, 'Harbor Roast');
    });
  });

  it('is visible before provisioning, so the organization is never created', () => {
    withTenants((parent) => {
      assert.equal(tenantFolderTaken('harbor-roast', parent), true);
      assert.equal(tenantFolderTaken('harbor-roast-two', parent), false);
      assert.equal(tenantFolderTaken('_template', parent), true);
    });
  });
});

describe('a host with no tenants directory', () => {
  it('skips the write and never reports a folder as taken', () => {
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const empty = mkdtempSync(join(tmpdir(), 'no-tenants-'));
    // Nested two deep: the root lookup also probes ../tenants and ../../tenants,
    // which must land inside this temp directory rather than in a shared one.
    const cwd = join(empty, 'apps', 'hq');
    mkdirSync(cwd, { recursive: true });
    try {
      assert.deepEqual(tryWriteTenantPack(tenantPackFromDraft(parsed.draft), cwd), { kind: 'skipped' });
      assert.equal(tenantFolderTaken('coffee-story', cwd), false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
