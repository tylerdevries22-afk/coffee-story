import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dopplerProjectRequest,
  factoryResourceName,
  githubTemplateRequest,
  supabaseProjectRequest,
  vercelProjectSpecifications,
} from './providers';

describe('factoryResourceName', () => {
  it('creates stable tenant-prefixed names', () => {
    assert.equal(factoryResourceName('juniper-coffee', 'operator'), 'juniper-coffee-operator');
  });

  it('rejects unsafe resource names', () => {
    assert.throws(() => factoryResourceName('../tenant'), /slug/);
  });
});

describe('provider request builders', () => {
  it('creates a private GitHub template request', () => {
    assert.deepEqual(githubTemplateRequest('juniper-coffee', 'platform-owner'), {
      owner: 'platform-owner',
      name: 'juniper-coffee',
      description: 'Generated application platform for juniper-coffee',
      include_all_branches: false,
      private: true,
    });
  });

  it('creates isolated Doppler and Supabase requests', () => {
    assert.equal(dopplerProjectRequest('juniper-coffee').name, 'juniper-coffee');
    const request = supabaseProjectRequest('juniper-coffee', 'platform-org', 'us-west-1', 'a-secure-generated-password-123');
    assert.equal(request.organization_slug, 'platform-org');
    assert.deepEqual(request.region_selection, { type: 'specific', code: 'us-west-1' });
  });

  it('defines one Vercel project per supported surface', () => {
    const projects = vercelProjectSpecifications('juniper-coffee', 'platform-owner/juniper-coffee');
    assert.equal(projects.length, 5);
    assert.deepEqual(projects.map((project) => project.name), [
      'juniper-coffee-hq',
      'juniper-coffee-display',
      'juniper-coffee-customer',
      'juniper-coffee-operator',
      'juniper-coffee-kiosk',
    ]);
    assert.equal(projects[0]?.framework, 'nextjs');
    assert.equal(projects[2]?.framework, null);
  });

  it('creates all declared projects for the Stillpoint construction tenant', () => {
    const projects = vercelProjectSpecifications(
      'stillpoint-builders',
      'platform-owner/stillpoint-builders',
      ['hq', 'display', 'customer', 'operator', 'kiosk'],
    );
    assert.deepEqual(projects.map((project) => project.name), [
      'stillpoint-builders-hq',
      'stillpoint-builders-display',
      'stillpoint-builders-customer',
      'stillpoint-builders-operator',
      'stillpoint-builders-kiosk',
    ]);
  });

  it('rejects unsupported, duplicate, or API-less surface declarations', () => {
    assert.throws(() => vercelProjectSpecifications('tenant', 'owner/tenant', ['operator']), /HQ API/);
    assert.throws(
      () => vercelProjectSpecifications('tenant', 'owner/tenant', ['hq', 'hq']),
      /unique supported/,
    );
  });
});
