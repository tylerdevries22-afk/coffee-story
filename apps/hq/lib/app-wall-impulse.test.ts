import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WALL_PHYSICS } from './app-wall-coast';
import { activeAfterContact, applyContacts, contactImpulse, kineticsAtRest, REST_KINETICS, stepKinetics } from './app-wall-impulse';
import type { Contact } from './app-wall-reflow';

const contact: Contact = { key: 'kiosk', pushedBy: 'customer', axis: 'x', direction: 1, depth: 1 };

test('a faster contact shoves further', () => {
  assert.ok(contactImpulse({ x: 40, y: 0 }, 10, 10, contact).x > contactImpulse({ x: 10, y: 0 }, 10, 10, contact).x);
});

test('a heavier target receives a smaller nudge', () => {
  assert.ok(contactImpulse({ x: 20, y: 0 }, 10, 100, contact).x < contactImpulse({ x: 20, y: 0 }, 10, 10, contact).x);
});

test('the active tile loses normal velocity proportional to the target\'s mass', () => {
  const light = activeAfterContact({ x: 20, y: 3 }, 10, 5, contact);
  const heavy = activeAfterContact({ x: 20, y: 3 }, 10, 200, contact);
  assert.ok(light.x < 20 && heavy.x < light.x);
  assert.equal(heavy.y, 3);
  assert.deepEqual(activeAfterContact({ x: 20, y: 0 }, 10, 5, { ...contact, depth: 2 }), { x: 20, y: 0 });
});

test('chain contacts decay by depth', () => {
  const direct = contactImpulse({ x: 20, y: 0 }, 10, 10, contact).x;
  const second = contactImpulse({ x: 20, y: 0 }, 10, 10, { ...contact, depth: 2 }).x;
  assert.ok(Math.abs(second - direct * WALL_PHYSICS.CHAIN_TRANSFER) < 1e-9);
});

test('a zero-velocity contact adds no nudge', () => {
  assert.deepEqual(contactImpulse({ x: 0, y: 0 }, 10, 10, contact), { x: 0, y: 0 });
  assert.deepEqual(contactImpulse({ x: -20, y: 0 }, 10, 10, contact), { x: 0, y: 0 });
  const { kinetics } = applyContacts({}, [contact], { x: 0, y: 0 }, () => 10, 'customer');
  assert.deepEqual(kinetics.kiosk, REST_KINETICS);
});

test('nudge offset is capped', () => {
  let kinetics = { offset: { x: 0, y: 0 }, velocity: { x: 900, y: 0 } };
  let peak = 0;
  for (let index = 0; index < 120; index += 1) { kinetics = stepKinetics(kinetics, 1 / 120); peak = Math.max(peak, kinetics.offset.x); }
  assert.ok(peak <= WALL_PHYSICS.MAX_NUDGE_CELLS + 1e-9);
  assert.ok(peak > .1);
});

test('kinetics return to rest and report it', () => {
  let kinetics = { offset: { x: .4, y: -.2 }, velocity: { x: 0, y: 0 } };
  for (let index = 0; index < 600; index += 1) kinetics = stepKinetics(kinetics, 1 / 120);
  assert.equal(kineticsAtRest(kinetics), true);
});
