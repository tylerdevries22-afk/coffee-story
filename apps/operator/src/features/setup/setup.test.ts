import { currentBusiness } from '@/data/business';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialSetupState,
  portalSetup,
  setupProgressPercent,
  setupSummary,
  shouldScheduleSetupAutoPrompt,
  toggleListItem,
  withRoleSetup,
} from '@/features/setup/setup';
import type { PortalBundle, RoleSetup, ClientSetupAnswers } from '@/types/domain';

function bundleWith(setup?: unknown): PortalBundle {
  return {
    profile: { id: 'p1', fullName: 'Alex Rivera', email: 'alex@email.com', phone: null, birthday: null, avatarUrl: null },
    role: 'client',
    appointments: [],
    rewardAccount: { availablePoints: 0, annualPoints: 0, cashCents: 0, tier: 'Warm Heart' },
    rewardLedger: [],
    rewardActivities: [],
    rewardCatalog: [],
    giftCards: [],
    intake: {
      completed: true,
      concerns: '',
      pressurePreference: 'medium',
      consentAccepted: true,
      updatedAt: null,
    },
    setup: setup as PortalBundle['setup'],
  } as unknown as PortalBundle;
}

test('portalSetup fills defaults when the bundle has no setup', () => {
  const setup = portalSetup(bundleWith(undefined));
  assert.equal(setup.client.status, 'not_started');
  assert.equal(setup.admin.answers.onlineBooking, true);
  assert.deepEqual(setup.staff.answers.specialties, []);
});

test('portalSetup sanitizes hostile stored values', () => {
  const setup = portalSetup(bundleWith({
    client: { status: 'root', step: 99, answers: { goals: ['Late-night hours', 'evil'], pressure: 'crushing', preferredTimes: 'no' } },
    admin: { status: 'completed', step: 2, answers: { businessName: 42, openDays: ['Mon', 'Funday'], servicesConfirmed: 'yes' } },
  }));
  assert.equal(setup.client.status, 'not_started');
  assert.equal(setup.client.step, 2);
  assert.deepEqual(setup.client.answers.goals, ['Late-night hours']);
  assert.equal(setup.client.answers.pressure, 'medium');
  assert.deepEqual(setup.client.answers.preferredTimes, []);
  assert.equal(setup.admin.status, 'completed');
  assert.equal(setup.admin.answers.businessName, currentBusiness().name);
  assert.deepEqual(setup.admin.answers.openDays, ['Mon']);
  assert.equal(setup.admin.answers.servicesConfirmed, false);
});

test('withRoleSetup persists one role and leaves the others intact', () => {
  const portal = bundleWith(initialSetupState());
  const staffSetup = {
    status: 'in_progress' as const,
    step: 1,
    answers: { specialties: ['Espresso bar'], workingDays: ['Mon', 'Tue'] },
  };
  const next = withRoleSetup(portal, 'staff', staffSetup);
  assert.deepEqual(portalSetup(next).staff, staffSetup);
  assert.equal(portalSetup(next).client.status, 'not_started');
});

test('completing the client setup writes the intake pressure preference', () => {
  const completed: RoleSetup<ClientSetupAnswers> = {
    status: 'completed',
    step: 2,
    answers: { goals: ['Improve sleep'], pressure: 'firm', preferredTimes: ['Saturday'] },
  };
  const next = withRoleSetup(bundleWith(undefined), 'client', completed);
  assert.equal(next.intake?.pressurePreference, 'firm');
});

test('setupSummary reports role-appropriate facts', () => {
  const state = initialSetupState();
  state.admin.answers.openDays = ['Mon', 'Wed'];
  const rows = setupSummary('admin', state);
  assert.equal(rows[1].value, '2 of 7');
  assert.equal(rows[2].value, 'On');
});

test('toggleListItem adds then removes', () => {
  assert.deepEqual(toggleListItem([], 'Mon'), ['Mon']);
  assert.deepEqual(toggleListItem(['Mon'], 'Mon'), []);
});

test('setupProgressPercent reflects saved wizard progress', () => {
  assert.equal(setupProgressPercent({ status: 'not_started', step: 0, answers: {} }), 0);
  assert.equal(setupProgressPercent({ status: 'in_progress', step: 0, answers: {} }), 33);
  assert.equal(setupProgressPercent({ status: 'in_progress', step: 1, answers: {} }), 67);
  assert.equal(setupProgressPercent({ status: 'completed', step: 2, answers: {} }), 100);
});

test('automatic setup waits for a stable, eligible demo role', () => {
  assert.equal(shouldScheduleSetupAutoPrompt({ isDemo: true, isHydrating: false, dismissed: false, promptOpen: false }), true);
  assert.equal(shouldScheduleSetupAutoPrompt({ isDemo: true, isHydrating: true, dismissed: false, promptOpen: false }), false);
  assert.equal(shouldScheduleSetupAutoPrompt({ isDemo: true, isHydrating: false, dismissed: true, promptOpen: false }), false);
  assert.equal(shouldScheduleSetupAutoPrompt({ isDemo: false, isHydrating: false, dismissed: false, promptOpen: false }), false);
  assert.equal(shouldScheduleSetupAutoPrompt({ isDemo: true, isHydrating: false, dismissed: false, promptOpen: true }), false);
});
