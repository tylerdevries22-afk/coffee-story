import type { KioskStepFamily } from '@platform/domain';

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

/** The facts the flow driver is allowed to branch on. */
export type FlowFacts = {
  inGroup: boolean;
  hasOptions: boolean;
  packSlotsRemaining: number;
  bagCount: number;
  identifyOffered: boolean;
  identifyMethod: 'phone' | 'scan' | null;
  identified: boolean;
  wantsName: boolean;
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

const SPINES: Record<KioskStepFamily, readonly KioskStepId[]> = {
  item: ['entry', 'node', 'item', 'options', 'review', 'bag', 'tip', 'pay', 'identify', 'keypad', 'balance', 'name', 'processing', 'done'],
  pack: ['entry', 'node', 'pack', 'fill', 'review', 'bag', 'tip', 'pay', 'identify', 'keypad', 'balance', 'name', 'processing', 'done'],
};

export function stepSpine(family: KioskStepFamily): readonly KioskStepId[] {
  return SPINES[family];
}

/** Routes stay plain strings so this pure model does not depend on Expo Router. */
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

export function stepForRoute(pathname: string): KioskStepId | null {
  const normalized = normalizedPath(pathname);
  for (const [step, route] of Object.entries(STEP_ROUTES) as [KioskStepId, string][]) {
    if (route === normalized) return step;
  }
  return null;
}

export function routeMatchesStep(pathname: string, step: KioskStepId): boolean {
  return stepForRoute(pathname) === step;
}
