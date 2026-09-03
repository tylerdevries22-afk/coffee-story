import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { easProjectIssues, RELEASE_CHECKS, releaseManifestIssues } from './release';

function approvedManifest() {
  return {
    schemaVersion: 1, tenantSlug: 'juniper-coffee',
    expoGo: {
      appStoreSdk: 54, checkedAt: '2026-08-31T00:00:00.000Z',
      sourceUrl: 'https://docs.expo.dev/versions/v54.0.0/',
    },
    checks: Object.fromEntries(RELEASE_CHECKS.map((key) => [key, {
      status: 'approved', approvedAt: '2026-08-30T00:00:00.000Z', approvedBy: 'Client owner',
      evidenceUrl: `https://evidence.example/${key}`,
    }])),
  };
}

describe('releaseManifestIssues', () => {
  it('accepts a recent, evidenced and fully approved release', () => {
    assert.deepEqual(releaseManifestIssues(
      approvedManifest(), 'juniper-coffee', new Date('2026-09-01T00:00:00.000Z'),
    ), []);
  });

  it('fails closed on pending approvals and a stale or mismatched SDK check', () => {
    const manifest = approvedManifest();
    manifest.expoGo.appStoreSdk = 55;
    manifest.checks.legalAndPrivacy = {
      status: 'pending', approvedAt: '', approvedBy: '', evidenceUrl: '',
    };
    const issues = releaseManifestIssues(
      manifest, 'juniper-coffee', new Date('2026-11-01T00:00:00.000Z'),
    );
    assert.ok(issues.some((issue) => issue.includes('SDK')));
    assert.ok(issues.some((issue) => issue.includes('45 days')));
    assert.ok(issues.some((issue) => issue.includes('legalAndPrivacy')));
  });
});

describe('easProjectIssues', () => {
  const both = {
    easProjectId: '11111111-1111-4111-8111-111111111111',
    kioskEasProjectId: '22222222-2222-4222-8222-222222222222',
  };

  it('asks for nothing from a tenant that ships neither guest surface', () => {
    assert.deepEqual(easProjectIssues({}, ['operator', 'hq']), []);
  });

  it('asks only for the customer id when only the customer surface ships', () => {
    const issues = easProjectIssues({}, ['customer', 'hq']);
    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? '', /identity\.easProjectId/);
  });

  it('asks only for the kiosk id when only the kiosk surface ships', () => {
    const issues = easProjectIssues({}, ['kiosk', 'display']);
    assert.equal(issues.length, 1);
    assert.match(issues[0] ?? '', /identity\.kioskEasProjectId/);
  });

  it('accepts a tenant that ships both surfaces and has both ids', () => {
    assert.deepEqual(easProjectIssues(both, ['customer', 'kiosk']), []);
  });

  it('rejects a blank id for a surface that ships, which is the demo tenant today', () => {
    const issues = easProjectIssues({ easProjectId: '', kioskEasProjectId: '' }, ['customer', 'kiosk']);
    assert.equal(issues.length, 2);
  });

  it('rejects a value that is not a UUID', () => {
    assert.equal(easProjectIssues({ easProjectId: 'not-a-uuid' }, ['customer']).length, 1);
  });

  it('says which surface forced the requirement, so the fix is obvious', () => {
    assert.match(easProjectIssues({}, ['kiosk'])[0] ?? '', /ships the kiosk surface/);
  });

  it('treats a missing identity block as missing ids rather than throwing', () => {
    assert.equal(easProjectIssues(undefined, ['customer', 'kiosk']).length, 2);
    assert.equal(easProjectIssues(null, ['customer']).length, 1);
    assert.equal(easProjectIssues('nonsense', ['customer']).length, 1);
  });

  it('ignores a duplicated surface rather than reporting twice', () => {
    assert.deepEqual(easProjectIssues({}, ['customer', 'customer', 'hq']).length, 1);
  });
});
