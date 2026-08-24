/**
 * The kiosk's step driver.
 *
 * A guided flow has one hard property: forward and backward must agree. The
 * cheap way to write this is two switch statements, and the cheap way is wrong
 * -- a skip condition added to `next` and forgotten in `back` strands a guest
 * on a screen whose chevron does not undo what brought them there.
 *
 * So there is exactly one source of truth, `stepsFor`, which answers "given
 * this tenant's flow and what the guest has done so far, which steps exist?".
 * Both directions are index arithmetic over that list, which makes them
 * inverses by construction rather than by discipline.
 *
 * Pure, so `node:test` covers the whole policy without a renderer.
 */
import type { KioskFlow, KioskStepFamily } from '@platform/domain';

export type KioskStepId =
  | 'entry'
  | 'node'
  | 'item'
  | 'options'
  | 'pack'
  | 'fill'
  | 'review'
  | 'bag'
  | 'tip'
  | 'pay'
  | 'identify'
  | 'keypad'
  | 'balance'
  | 'processing'
  | 'name'
  | 'done';

/**
 * What the guest has done, as far as the driver needs to care.
 *
 * Deliberately flat booleans and counts rather than the cart and the builder
 * themselves: the driver must stay testable without constructing a session,
 * and a fact it cannot see is a fact it cannot branch on by accident.
 */
export type FlowFacts = {
  /** A group tile was tapped, so a narrowing screen is warranted. */
  inGroup: boolean;
  /** The chosen item has visible option groups worth a screen. */
  hasOptions: boolean;
  /** Unfilled slots in the pack being built. Zero means complete. */
  packSlotsRemaining: number;
  bagCount: number;
  /** The guest chose a tender that needs an account behind it. */
  identifyOffered: boolean;
  identifyMethod: 'phone' | 'scan' | null;
  identified: boolean;
  wantsName: boolean;
  /** The order exists. Past this point nothing is cancellable. */
  placed: boolean;
};

export const EMPTY_FACTS: FlowFacts = {
  inGroup: false,
  hasOptions: false,
  packSlotsRemaining: 0,
  bagCount: 0,
  identifyOffered: false,
  identifyMethod: null,
  identified: false,
  wantsName: false,
  placed: false,
};

/**
 * The ordered spine per family, before facts prune it.
 *
 * The two families differ only in their middle: everything from `review`
 * onward is byte-identical, which is why those steps are the ones a tenant
 * cannot configure away.
 */
const SPINES: Record<KioskStepFamily, readonly KioskStepId[]> = {
  item: ['entry', 'node', 'item', 'options', 'review', 'bag', 'tip', 'pay', 'identify', 'keypad', 'balance', 'name', 'processing', 'done'],
  pack: ['entry', 'node', 'pack', 'fill', 'review', 'bag', 'tip', 'pay', 'identify', 'keypad', 'balance', 'name', 'processing', 'done'],
};

export function stepSpine(family: KioskStepFamily): readonly KioskStepId[] {
  return SPINES[family];
}

/** Steps that exist on every flow, whatever the tenant configured. */
const LOAD_BEARING: ReadonlySet<KioskStepId> = new Set([
  'entry', 'review', 'bag', 'pay', 'processing', 'done',
]);

export function isLoadBearing(step: KioskStepId): boolean {
  return LOAD_BEARING.has(step);
}

/** The steps actually reachable right now, in order. The one source of truth. */
export function stepsFor(flow: KioskFlow, facts: FlowFacts): readonly KioskStepId[] {
  return stepSpine(flow.family).filter((step) => {
    switch (step) {
      case 'node':
        return facts.inGroup;
      case 'options':
        return facts.hasOptions;
      case 'tip':
        return flow.tip.enabled && flow.tip.presetsCents.length > 0;
      // Identify is not part of paying by card. It appears only once the guest
      // has chosen a tender that needs an account behind it.
      case 'identify':
        return facts.identifyOffered;
      case 'keypad':
        return facts.identifyOffered && facts.identifyMethod === 'phone';
      case 'balance':
        return facts.identifyOffered && facts.identified;
      case 'name':
        return facts.wantsName;
      default:
        return true;
    }
  });
}

/**
 * Whether the guest may leave `current` yet.
 *
 * The pack rule is the interesting one and it is migration 0029's, restated:
 * a pack needs an EXACT count, not a maximum, so "Continue" stays inert at
 * five of six rather than quietly selling a short box.
 */
export function canAdvance(flow: KioskFlow, facts: FlowFacts, current: KioskStepId): boolean {
  switch (current) {
    case 'fill':
      return facts.packSlotsRemaining === 0;
    case 'bag':
    case 'pay':
      return facts.bagCount > 0;
    case 'processing':
      return facts.placed;
    case 'done':
      return false;
    default:
      return true;
  }
}

export function nextStep(flow: KioskFlow, facts: FlowFacts, current: KioskStepId): KioskStepId | null {
  if (!canAdvance(flow, facts, current)) return null;
  const steps = stepsFor(flow, facts);
  const index = steps.indexOf(current);
  if (index < 0) return null;
  return steps[index + 1] ?? null;
}

/** Merge facts learned by the same tap before choosing that tap's route. */
export function factsForAdvance(facts: FlowFacts, learned?: Partial<FlowFacts>): FlowFacts {
  return learned ? { ...facts, ...learned } : facts;
}

/**
 * Where the back chevron goes, or null to hide it.
 *
 * Never `router.back()`. Browser and native history both record steps the
 * guest was bounced through, and once a step is skipped by facts the history
 * and the flow disagree -- the web export used for `docs/captures` makes that
 * visible immediately.
 */
export function backStep(flow: KioskFlow, facts: FlowFacts, current: KioskStepId): KioskStepId | null {
  // Nothing after the order exists may be re-entered. A half-authorised
  // payment with a back button beside it is how a shop refunds by hand.
  if (current === 'processing' || current === 'done') return null;
  // Review has already committed its line and reset the builder by the time the
  // guest reaches the bag. Returning there would be a blank configurator, so
  // Back from the bag means "keep ordering" and returns to the menu.
  if (current === 'bag') return 'entry';
  const steps = stepsFor(flow, facts);
  const index = steps.indexOf(current);
  if (index <= 0) return null;
  return steps[index - 1] ?? null;
}

/** Whether the guest could legitimately be standing on this step. */
export function isStepReachable(flow: KioskFlow, facts: FlowFacts, current: KioskStepId): boolean {
  if (!stepsFor(flow, facts).includes(current)) return false;
  // Checkout with nothing in the bag is either a dead control or, for
  // processing, a dangerous deep link into the money-moving page.
  const needsBag = current === 'bag' || current === 'tip' || current === 'pay'
    || current === 'identify' || current === 'keypad' || current === 'balance'
    || current === 'name' || current === 'processing';
  if (needsBag && facts.bagCount === 0) return false;
  if (current === 'done' && !facts.placed) return false;
  return true;
}

/**
 * Where to send a guest who is somewhere they cannot be.
 *
 * Back to the start of ordering, never to the bag: an empty bag under a dead
 * Checkout pill is the same dead end by another name.
 */
export function recoveryStep(flow: KioskFlow, facts: FlowFacts, current: KioskStepId): KioskStepId {
  if (isStepReachable(flow, facts, current)) return current;
  return 'entry';
}

/**
 * Whether the idle clock may clear the session from this step.
 *
 * The bug this replaces: `IdleNotice` was mounted only on the order screen, so
 * a session abandoned at tender had its cart emptied at 90s underneath a live
 * Pay button showing a real total. The notice now lives at the root and this
 * function -- tested, in one place -- decides where it is allowed to fire.
 */
export function idleMayReset(current: KioskStepId): boolean {
  return current !== 'processing' && current !== 'done';
}

/**
 * Routes, typed as plain strings on purpose.
 *
 * `typedRoutes` builds expo-router's `Href` union from `.expo/types`, which the
 * dev server regenerates -- so typing this as `Record<KioskStepId, Href>` makes
 * a CI typecheck against stale generated types fail for a reason that has
 * nothing to do with the change. Strings here keep this module importable by
 * `node:test` without pulling in expo-router at all; the cast happens at the
 * single router call site.
 */
export const STEP_ROUTES = {
  entry: '/order/entry',
  node: '/order/node',
  item: '/order/item',
  options: '/order/options',
  pack: '/order/pack',
  fill: '/order/fill',
  review: '/order/review',
  bag: '/bag',
  tip: '/checkout/tip',
  pay: '/checkout/pay',
  identify: '/checkout/identify',
  keypad: '/checkout/keypad',
  balance: '/checkout/balance',
  processing: '/checkout/processing',
  name: '/checkout/name',
  done: '/done',
} as const satisfies Record<KioskStepId, string>;

function normalizedPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/** Resolve navigation state from the URL so route and flow cannot drift. */
export function stepForRoute(pathname: string): KioskStepId | null {
  const normalized = normalizedPath(pathname);
  for (const [step, route] of Object.entries(STEP_ROUTES) as [KioskStepId, string][]) {
    if (route === normalized) return step;
  }
  return null;
}

/** True when Expo Router is rendering the page the state machine selected. */
export function routeMatchesStep(pathname: string, step: KioskStepId): boolean {
  return stepForRoute(pathname) === step;
}
