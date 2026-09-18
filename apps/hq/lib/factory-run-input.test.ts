import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { onboardingRunArgs } from './factory-run-input';
import { parseOrgDraft, type OrgInput } from './org-input';

const CONTEXT = {
  blueprintId: '00000000-0000-4000-8000-0000000000b1',
  idempotencyKey: '00000000-0000-4000-8000-0000000000c1',
  actorId: '00000000-0000-4000-8000-0000000000a1',
};

const BASE: OrgInput = {
  name: 'Harbor Roast', ownerEmail: 'owner@harbor.example', organizationKind: 'franchisor',
  industryKey: 'coffee-shop', blueprintKey: 'coffee-shop',
};

function argsFor(input: OrgInput) {
  const parsed = parseOrgDraft(input);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  return onboardingRunArgs(parsed.draft, CONTEXT);
}

describe('what the factory is told about a new organization', () => {
  it('hands research the business’s website', () => {
    assert.equal(argsFor({ ...BASE, website: 'https://harbor-roast.example.com/' }).input_website_url,
      'https://harbor-roast.example.com/');
  });

  it('sends an empty string for no website, which the RPC stores as null', () => {
    assert.equal(argsFor(BASE).input_website_url, '');
  });

  it('never lets through a website the run row would reject', () => {
    // platform_onboarding_runs.website_url is checked against ^https://, so an
    // http address would fail the whole run rather than just the research.
    assert.deepEqual(parseOrgDraft({ ...BASE, website: 'http://harbor-roast.example.com/' }), {
      ok: false, error: 'Enter the website as a public https:// address.',
    });
  });

  it('keeps the rest of the run as it was', () => {
    const args = argsFor(BASE);
    assert.equal(args.input_blueprint_id, CONTEXT.blueprintId);
    assert.equal(args.input_business_name, 'Harbor Roast');
    assert.equal(args.input_tenant_slug, 'harbor-roast');
    assert.equal(args.input_location_name, 'Harbor Roast HQ');
    assert.equal(args.input_timezone, 'UTC');
    assert.equal(args.input_idempotency_key, CONTEXT.idempotencyKey);
    assert.equal(args.input_created_by, CONTEXT.actorId);
    assert.ok(args.input_tasks.length > 0);
  });
});
