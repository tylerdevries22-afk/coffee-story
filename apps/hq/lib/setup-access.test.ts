import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { mayProvisionOrganizations } from './auth';
import type { SessionInfo } from './demo-data';

function session(role: SessionInfo['role']): SessionInfo {
  return { userId: 'user-1', email: 'someone@example.test', role, brandId: 'brand-1', brandName: 'Brand' };
}

const source = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), 'app', '(console)', ...parts), 'utf8');

describe('who may create an organization', () => {
  it('is a platform admin, and nobody else', () => {
    assert.equal(mayProvisionOrganizations(session('platform_admin')), true);
    for (const role of ['brand_owner', 'location_manager', 'staff'] as const) {
      assert.equal(mayProvisionOrganizations(session(role)), false, role);
    }
  });

  it('is not a signed-in user with no tenant, whom the wizard used to let in', () => {
    // currentSession() is null for someone with no tenant claims.
    assert.equal(mayProvisionOrganizations(null), false);
  });

  it('is decided by the page and the action themselves, not the hidden nav link', () => {
    assert.match(source('organizations', 'new', 'page.tsx'),
      /if \(!mayProvisionOrganizations\(session\)\) redirect\(/);
    assert.doesNotMatch(source('layout.tsx'), /isSetupConsolePath|organizations\/new'\)/,
      'the console layout must not exempt the wizard from the tenant gate');
  });

  it('is decided before the owner invitation is sent', () => {
    // The RPC refuses a non-admin too, but only after resolveOrInviteStaffUser
    // has already mailed an invitation to whatever address the form carried.
    const action = source('organizations', 'actions.ts');
    const gate = action.indexOf('if (!mayProvisionOrganizations(session))');
    const invite = action.indexOf('resolveOrInviteStaffUser(');
    assert.ok(gate > 0 && invite > 0, 'the action no longer has both the gate and the invitation');
    assert.ok(gate < invite, 'a non-admin must be refused before any invitation goes out');
  });
});
