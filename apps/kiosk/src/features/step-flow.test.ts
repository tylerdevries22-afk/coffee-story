import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveKioskFlow, type KioskFlow } from '@platform/domain';

import {
  EMPTY_FACTS, STEP_ROUTES, backStep, canAdvance, factsForAdvance, idleMayReset, isLoadBearing,
  isStepReachable, nextStep, recoveryStep, routeMatchesStep, stepForRoute, stepSpine, stepsFor,
  type FlowFacts, type KioskStepId,
} from './step-flow';

const DRINKS: KioskFlow = resolveKioskFlow({ family: 'item' }, {});
const PACKS: KioskFlow = resolveKioskFlow({ family: 'pack' }, {});

function facts(overrides: Partial<FlowFacts> = {}): FlowFacts {
  return { ...EMPTY_FACTS, bagCount: 1, ...overrides };
}

describe('stepsFor', () => {
  it('gives a drink its options screen only when the item has options', () => {
    assert.equal(stepsFor(DRINKS, facts({ hasOptions: false })).includes('options'), false);
    assert.equal(stepsFor(DRINKS, facts({ hasOptions: true })).includes('options'), true);
  });

  it('gives a container its fill screen always, because a box is never pre-filled', () => {
    assert.equal(stepsFor(PACKS, facts()).includes('fill'), true);
    assert.equal(stepsFor(PACKS, facts()).includes('options'), false);
  });

  it('keeps identify out of a plain card payment', () => {
    assert.equal(stepsFor(DRINKS, facts()).includes('identify'), false);
    assert.equal(stepsFor(DRINKS, facts({ identifyOffered: true })).includes('identify'), true);
  });

  it('offers the tenant tip step only when usable presets are enabled', () => {
    const tipped = resolveKioskFlow({ family: 'item', tip: { enabled: true, presetsCents: [100, 200] } }, {});
    assert.equal(stepsFor(tipped, facts()).includes('tip'), true);
    assert.equal(stepsFor(DRINKS, facts()).includes('tip'), false);
  });

  it('collects an order name before processing can create the order', () => {
    const steps = stepsFor(DRINKS, facts({ wantsName: true }));
    assert.ok(steps.indexOf('name') < steps.indexOf('processing'));
  });

  it('offers a keypad only for a phone lookup, not for a scan', () => {
    const scan = stepsFor(DRINKS, facts({ identifyOffered: true, identifyMethod: 'scan' }));
    const phone = stepsFor(DRINKS, facts({ identifyOffered: true, identifyMethod: 'phone' }));
    assert.equal(scan.includes('keypad'), false);
    assert.equal(phone.includes('keypad'), true);
  });

  it('shows a balance only once someone is actually identified', () => {
    assert.equal(stepsFor(DRINKS, facts({ identifyOffered: true })).includes('balance'), false);
    assert.equal(
      stepsFor(DRINKS, facts({ identifyOffered: true, identified: true })).includes('balance'),
      true,
    );
  });

  it('shares one tail between the families, which is why that tail is load-bearing', () => {
    const tailOf = (spine: readonly KioskStepId[]) => spine.slice(spine.indexOf('review'));
    assert.deepEqual(tailOf(stepSpine('item')), tailOf(stepSpine('pack')));
    for (const step of tailOf(stepSpine('item'))) {
      if (step === 'tip' || step === 'identify' || step === 'keypad' || step === 'balance' || step === 'name') continue;
      assert.equal(isLoadBearing(step), true, `${step} must not be configurable away`);
    }
  });
});

describe('canAdvance', () => {
  /** Migration 0029's rule: an EXACT count, not a maximum. */
  it('holds a pack shut until every slot is filled', () => {
    assert.equal(canAdvance(PACKS, facts({ packSlotsRemaining: 1 }), 'fill'), false);
    assert.equal(canAdvance(PACKS, facts({ packSlotsRemaining: 0 }), 'fill'), true);
    assert.equal(nextStep(PACKS, facts({ packSlotsRemaining: 2 }), 'fill'), null);
  });

  it('will not check out an empty bag', () => {
    assert.equal(canAdvance(DRINKS, facts({ bagCount: 0 }), 'bag'), false);
    assert.equal(canAdvance(DRINKS, facts({ bagCount: 0 }), 'pay'), false);
  });

  it('will not leave processing until the order actually exists', () => {
    assert.equal(canAdvance(DRINKS, facts({ placed: false }), 'processing'), false);
    assert.equal(canAdvance(DRINKS, facts({ placed: true }), 'processing'), true);
  });
});

describe('nextStep and backStep', () => {
  /**
   * The property the whole module exists for. A skip condition added to one
   * direction and forgotten in the other is the most likely regression here,
   * and it strands a guest on a screen whose chevron does not undo what
   * brought them there.
   */
  it('are exact inverses across every reachable step of both families', () => {
    const shapes: FlowFacts[] = [
      facts(),
      facts({ inGroup: true, hasOptions: true }),
      facts({ identifyOffered: true, identifyMethod: 'phone', identified: true }),
      facts({ identifyOffered: true, identifyMethod: 'scan', identified: true, wantsName: true }),
      facts({ inGroup: true, hasOptions: true, wantsName: true, packSlotsRemaining: 0 }),
    ];
    for (const flow of [DRINKS, PACKS]) {
      for (const shape of shapes) {
        const steps = stepsFor(flow, { ...shape, placed: true });
        for (const [index, step] of steps.entries()) {
          const forward = nextStep(flow, { ...shape, placed: true }, step);
          if (forward === null || index + 1 >= steps.length) continue;
          assert.equal(forward, steps[index + 1], `next from ${step}`);
          assert.equal(
            backStep(flow, { ...shape, placed: true }, forward),
            forward === 'done' || forward === 'processing'
              ? null
              : forward === 'bag' ? 'entry' : step,
            `back from ${forward}`,
          );
        }
      }
    }
  });

  it('hides the chevron where going back would be wrong', () => {
    assert.equal(backStep(DRINKS, facts(), 'entry'), null);
    assert.equal(backStep(DRINKS, facts({ placed: true }), 'processing'), null);
    assert.equal(backStep(DRINKS, facts({ placed: true }), 'done'), null);
  });

  it('returns from the bag to ordering after review has cleared the builder', () => {
    assert.equal(backStep(DRINKS, facts(), 'bag'), 'entry');
    assert.equal(backStep(PACKS, facts(), 'bag'), 'entry');
  });

  it('steps over a screen the facts removed instead of landing on it', () => {
    // No options on this item, so review is what follows the item screen.
    assert.equal(nextStep(DRINKS, facts({ hasOptions: false }), 'item'), 'review');
    assert.equal(backStep(DRINKS, facts({ hasOptions: false }), 'review'), 'item');
  });

  it('uses facts learned by the current tap before choosing its route', () => {
    const staleGroup = facts({ inGroup: true });
    const directCategory = factsForAdvance(staleGroup, { inGroup: false });
    assert.equal(nextStep(DRINKS, directCategory, 'entry'), 'item');
  });
});

describe('reachability', () => {
  it('refuses pay and bag with an empty bag, and recovers to ordering not to the bag', () => {
    const empty = facts({ bagCount: 0 });
    assert.equal(isStepReachable(DRINKS, empty, 'pay'), false);
    assert.equal(isStepReachable(DRINKS, empty, 'bag'), false);
    assert.equal(isStepReachable(DRINKS, empty, 'processing'), false);
    assert.equal(isStepReachable(DRINKS, empty, 'name'), false);
    assert.equal(isStepReachable(DRINKS, empty, 'done'), false);
    // Never 'bag': an empty bag under a dead Checkout pill is the same dead end.
    assert.equal(recoveryStep(DRINKS, empty, 'pay'), 'entry');
  });

  it('leaves a guest where they are when they are legitimately there', () => {
    assert.equal(recoveryStep(DRINKS, facts(), 'pay'), 'pay');
  });

  it('refuses a step this family does not have', () => {
    assert.equal(isStepReachable(DRINKS, facts(), 'fill'), false);
    assert.equal(isStepReachable(PACKS, facts(), 'options'), false);
  });
});

describe('idleMayReset', () => {
  /**
   * The regression test for the shipped bug: IdleNotice was mounted only on
   * the order screen, so a session abandoned at tender was cleared at 90s
   * under a live Pay button showing a real total.
   */
  it('still clears an abandoned session at the payment screen', () => {
    assert.equal(idleMayReset('pay'), true);
    assert.equal(idleMayReset('fill'), true);
    assert.equal(idleMayReset('bag'), true);
  });

  it('never clears a session that has already paid', () => {
    assert.equal(idleMayReset('processing'), false);
    assert.equal(idleMayReset('done'), false);
  });
});

describe('STEP_ROUTES', () => {
  it('covers every step in both spines, so no step can navigate nowhere', () => {
    const all = new Set([...stepSpine('item'), ...stepSpine('pack')]);
    for (const step of all) {
      assert.equal(typeof STEP_ROUTES[step], 'string', `${step} has no route`);
      assert.match(STEP_ROUTES[step], /^\//, `${step} route must be absolute`);
    }
    assert.equal(Object.keys(STEP_ROUTES).length, all.size);
  });

  it('rejects a deep-linked page that disagrees with recovered flow state', () => {
    assert.equal(routeMatchesStep('/order/entry', 'entry'), true);
    assert.equal(routeMatchesStep('/order/entry/', 'entry'), true);
    assert.equal(routeMatchesStep('/checkout/processing', 'entry'), false);
    assert.equal(routeMatchesStep('/checkout/pay', 'entry'), false);
    assert.equal(stepForRoute('/checkout/processing'), 'processing');
    assert.equal(stepForRoute('/checkout/pay/'), 'pay');
    assert.equal(stepForRoute('/pair'), null);
  });
});
