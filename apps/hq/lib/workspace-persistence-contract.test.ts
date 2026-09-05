import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const APP = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(APP, path), 'utf8');

test('workspace actions return typed success and user-safe error states', () => {
  const source = read('app/actions/workspace.ts');
  assert.match(source, /export type WorkspaceActionState/);
  assert.match(source, /status: 'success'/);
  assert.match(source, /status: 'error'/);
  assert.match(source, /Promise<WorkspaceActionState>/);
  assert.match(source, /We could not switch workspaces\. Try again\./);
});

test('reselecting the active organization preserves its location', () => {
  const source = read('app/actions/workspace.ts');
  const noOp = source.indexOf('selectedOrganizationId(session) === authorized');
  const clearLocation = source.indexOf("store.set(LOCATION_COOKIE, '', expiredWorkspaceCookieOptions())");
  assert.ok(noOp >= 0, 'organization selection needs an explicit no-op');
  assert.ok(clearLocation > noOp, 'the no-op must return before location expiry');
  assert.match(source, /return success\(authorized, false\)/);
});

test('the switcher keeps its form mounted until its action succeeds', () => {
  const source = read('components/workspace-switcher.tsx');
  assert.match(source, /useActionState\(action, IDLE\)/);
  assert.match(source, /action=\{submit\}/);
  assert.match(source, /state\.status !== 'success'/);
  assert.doesNotMatch(source, /type="submit"[\s\S]{0,240}onClick=/);
  assert.match(source, /role="status">Switching workspace/);
  assert.match(source, /role="alert">\{state\.message\}/);
});

test('the switcher supports menu focus and keyboard navigation', () => {
  const source = read('components/workspace-switcher.tsx');
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
    assert.ok(source.includes(`'${key}'`), `${key} must be handled`);
  }
  assert.match(source, /aria-haspopup="menu"/);
  assert.match(source, /role="menuitemradio"/);
  assert.match(source, /triggerRef\.current\?\.focus\(\)/);
});

test('the organization switcher renders tenant-owned logos with a fallback', () => {
  const logo = read('components/organization-logo.tsx');
  assert.match(logo, /tenants\/coffee-story\/assets\/logo\.png/);
  assert.match(logo, /tenants\/stillpoint-builders\/app-store\/generated\/icon\.png/);
  assert.match(logo, /scope-organization-logo/);
  assert.match(read('components/workspace-switcher.tsx'), /<OrganizationLogo/);
});

test('the topbar pairs organization and location before the page context', () => {
  const source = read('components/console-topbar.tsx');
  const organization = source.indexOf('props.orgSwitcher');
  const location = source.indexOf('props.locationSwitcher');
  const section = source.indexOf('props.section.home');
  assert.ok(organization >= 0 && location > organization && section > location);
  assert.match(source, /<Icon name=\{props\.mobile \? 'menu' : 'panel'\}/);
  assert.doesNotMatch(source, /props\.initials/);
});

test('sign-out expires organization and location workspace cookies', () => {
  const source = read('app/(console)/login/actions.ts');
  assert.match(source, /expiredWorkspaceCookieOptions\(\)/);
  assert.match(source, /store\.set\(ORG_COOKIE, '', expired\)/);
  assert.match(source, /store\.set\(LOCATION_COOKIE, '', expired\)/);
});
