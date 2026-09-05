import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { easProjectIssues, RELEASE_CHECKS, releaseManifestIssues } from './release';

function approvedManifest() {
  const release = {
    releaseId: 'release-2026-09-01.1',
    commitSha: 'a'.repeat(40),
    artifactDigest: `sha256:${'b'.repeat(64)}`,
    createdAt: '2026-08-29T00:00:00.000Z',
  };
  return {
    schemaVersion: 2, tenantSlug: 'juniper-coffee', release,
    expoGo: {
      appStoreSdk: 54, checkedAt: '2026-08-31T00:00:00.000Z',
      sourceUrl: 'https://docs.expo.dev/versions/v54.0.0/',
    },
    checks: Object.fromEntries(RELEASE_CHECKS.map((key) => [key, {
      status: 'approved', approvedAt: '2026-08-30T00:00:00.000Z', approvedBy: 'Client owner',
      evidenceUrl: `https://evidence.example/${key}`,
      releaseId: release.releaseId,
      commitSha: release.commitSha,
      artifactDigest: release.artifactDigest,
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
    manifest.checks.legalAndPrivacy!.status = 'pending';
    manifest.checks.legalAndPrivacy!.approvedAt = '';
    manifest.checks.legalAndPrivacy!.approvedBy = '';
    manifest.checks.legalAndPrivacy!.evidenceUrl = '';
    const issues = releaseManifestIssues(
      manifest, 'juniper-coffee', new Date('2026-11-01T00:00:00.000Z'),
    );
    assert.ok(issues.some((issue) => issue.includes('SDK')));
    assert.ok(issues.some((issue) => issue.includes('45 days')));
    assert.ok(issues.some((issue) => issue.includes('legalAndPrivacy')));
  });

  it('rejects evidence copied from another commit or tenant artifact', () => {
    const manifest = approvedManifest();
    manifest.release.commitSha = 'c'.repeat(40);
    const issues = releaseManifestIssues(manifest, 'juniper-coffee', {
      now: new Date('2026-09-01T00:00:00.000Z'),
      expectedArtifactDigest: `sha256:${'d'.repeat(64)}`,
    });
    assert.ok(issues.some((issue) => issue.includes('artifactDigest')));
    assert.ok(issues.some((issue) => issue.includes('not bound')));
  });

  it('rejects an approval that predates or is not bound to the release', () => {
    const manifest = approvedManifest();
    manifest.checks.providerAccounts!.approvedAt = '2026-08-28T00:00:00.000Z';
    manifest.checks.providerAccounts!.commitSha = 'c'.repeat(40);
    const issues = releaseManifestIssues(
      manifest, 'juniper-coffee', new Date('2026-09-01T00:00:00.000Z'),
    );
    assert.ok(issues.some((issue) => issue.includes('predates')));
    assert.ok(issues.some((issue) => issue.includes('not bound')));
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
