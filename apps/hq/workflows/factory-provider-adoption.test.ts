import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SafeResource } from './factory-runtime';
import {
  verifiedGitHubResource,
  verifiedVercelResource,
  verifyAdoption,
} from './factory-provider-adoption';

const githubExpected = {
  repository: 'platform/stillpoint-builders',
  owner: 'platform',
  templateRepository: 'platform/tenant-template',
};
const githubPayload = {
  id: 42,
  full_name: 'platform/stillpoint-builders',
  html_url: 'https://github.com/platform/stillpoint-builders',
  owner: { login: 'platform' },
  template_repository: { full_name: 'platform/tenant-template' },
};
const vercelExpected = {
  kind: 'project-hq',
  name: 'stillpoint-builders-hq',
  repository: 'platform/stillpoint-builders',
  rootDirectory: 'apps/hq',
  scope: 'team_platform',
};
const vercelPayload = {
  id: 'prj_stillpoint_hq',
  name: 'stillpoint-builders-hq',
  rootDirectory: 'apps/hq',
  accountId: 'team_platform',
  link: { type: 'github', org: 'platform', repo: 'stillpoint-builders' },
};

describe('verified provider adoption', () => {
  it('re-queries and reuses a valid GitHub row without creating or persisting', async () => {
    const stored = verifiedGitHubResource(githubPayload, githubExpected, null);
    let creates = 0;
    const result = await verifyAdoption({
      stored,
      lookup: async () => githubPayload,
      create: async () => { creates += 1; return githubPayload; },
      verify: (value, prior) => verifiedGitHubResource(value, githubExpected, prior),
    });
    assert.equal(creates, 0);
    assert.equal(result.persist, false);
    assert.deepEqual(result.resource, stored);
  });

  it('rejects GitHub owner, link, template, and stored identity mismatches', async () => {
    const stored = verifiedGitHubResource(githubPayload, githubExpected, null);
    const mismatches = [
      { ...githubPayload, owner: { login: 'attacker' } },
      { ...githubPayload, html_url: 'https://github.com/attacker/stillpoint-builders' },
      { ...githubPayload, template_repository: { full_name: 'attacker/template' } },
      { ...githubPayload, id: 99 },
    ];
    for (const payload of mismatches) {
      await assert.rejects(verifyAdoption({
        stored,
        lookup: async () => payload,
        create: async () => { throw new Error('must not create'); },
        verify: (value, prior) => verifiedGitHubResource(value, githubExpected, prior),
      }), /provenance|identity/);
    }
  });

  it('adopts a valid existing Vercel project and marks the new row for persistence', async () => {
    let creates = 0;
    const result = await verifyAdoption({
      stored: null,
      lookup: async () => vercelPayload,
      create: async () => { creates += 1; return vercelPayload; },
      verify: (value, prior) => verifiedVercelResource(value, vercelExpected, prior),
    });
    assert.equal(creates, 0);
    assert.equal(result.persist, true);
    assert.equal(result.resource.externalId, 'prj_stillpoint_hq');
  });

  it('rejects Vercel root, repository, scope, environment, and identity mismatches', async () => {
    const valid = verifiedVercelResource(vercelPayload, vercelExpected, null);
    const cases: Array<{ stored: SafeResource; payload: typeof vercelPayload }> = [
      { stored: valid, payload: { ...vercelPayload, rootDirectory: 'apps/customer' } },
      { stored: valid, payload: {
        ...vercelPayload, link: { type: 'github', org: 'attacker', repo: 'stillpoint-builders' },
      } },
      { stored: valid, payload: { ...vercelPayload, accountId: 'team_attacker' } },
      { stored: { ...valid, environment: undefined }, payload: vercelPayload },
      { stored: { ...valid, externalId: 'prj_other' }, payload: vercelPayload },
    ];
    for (const testCase of cases) {
      await assert.rejects(verifyAdoption({
        stored: testCase.stored,
        lookup: async () => testCase.payload,
        create: async () => { throw new Error('must not create'); },
        verify: (value, prior) => verifiedVercelResource(value, vercelExpected, prior),
      }), /provenance|identity/);
    }
  });

  it('fails closed when a stored resource disappears', async () => {
    const stored = verifiedGitHubResource(githubPayload, githubExpected, null);
    await assert.rejects(verifyAdoption({
      stored,
      lookup: async () => null,
      create: async () => { throw new Error('must not create'); },
      verify: (value, prior) => verifiedGitHubResource(value, githubExpected, prior),
    }), /no longer exists/);
  });
});
