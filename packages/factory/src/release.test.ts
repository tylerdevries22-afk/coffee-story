import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RELEASE_CHECKS, releaseManifestIssues } from './release';

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
