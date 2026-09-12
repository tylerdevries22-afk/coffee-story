import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseOrgDraft } from './org-input';
import { tenantPackFromDraft, tryWriteTenantPack, writeTenantPack } from './tenant-pack-write';

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
        assert.equal(written, join(parent, 'tenants', 'harbor-roast'));
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
