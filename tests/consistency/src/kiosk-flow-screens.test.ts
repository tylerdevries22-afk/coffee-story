import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * The kiosk checkout the domain describes and the screens the kiosk ships are
 * the same flow.
 *
 * `packages/domain` decides what a guest is asked for: which tenders a tenant
 * offers, whether a balance has to be collected before a card, whether tipping
 * or identification is part of the run. `apps/kiosk` provides the screens. The
 * two are joined by nothing but matching names, so a tender the domain can
 * resolve to a step that has no screen is a guest stranded mid-payment on a
 * device with no keyboard and no back button — and it is invisible to
 * typecheck, because the join is a route string.
 *
 * Every assertion here is a name the domain produces checked against a file
 * the kiosk ships. Whether a screen behaves correctly is its own suite's job;
 * this one only refuses to let the two halves drift apart.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const CHECKOUT = join(ROOT, 'apps/kiosk/src/app/(flow)/checkout');
const FLOW = join(ROOT, 'apps/kiosk/src/app/(flow)');
const TENDERS = readFileSync(join(ROOT, 'packages/domain/src/kiosk-flow/tenders.ts'), 'utf8');

const screens = new Set(
  readdirSync(CHECKOUT).filter((name) => name.endsWith('.tsx')).map((name) => name.replace(/\.tsx$/, '')),
);
const flowScreens = new Set(
  readdirSync(FLOW).filter((name) => name.endsWith('.tsx')).map((name) => name.replace(/\.tsx$/, '')),
);

describe('the kiosk ships a screen for every step the domain can reach', () => {
  it('finds both halves, so the suite cannot pass by comparing nothing', () => {
    assert.ok(screens.size >= 6, `found only ${screens.size} checkout screens`);
    assert.ok(TENDERS.length > 500, 'the tenders module moved or shrank unexpectedly');
  });

  /**
   * The settlement kinds are the branch that decides where checkout goes next.
   * `wire` settles on the pay screen; `balance` has to collect the stored
   * amount first, which is a screen of its own.
   */
  it('has a screen for each tender settlement kind', () => {
    const kinds = [...TENDERS.matchAll(/kind: '([a-z_]+)'/g)].map((match) => match[1]);
    assert.ok(kinds.includes('wire') && kinds.includes('balance'),
      `expected wire and balance settlements, found ${[...new Set(kinds)].join(', ')}`);
    assert.ok(screens.has('balance'),
      'a stored-value or gift-card tender resolves to a balance step with no screen behind it');
    assert.ok(screens.has('pay'),
      'a wire tender settles on the pay screen, which is missing');
  });

  it('has a screen for every tender a tenant can offer', () => {
    // The KioskTender keys of TENDER_SETTLEMENT: the complete set a tenant
    // config may name, enforced total by the Record type in that module.
    const block = TENDERS.slice(TENDERS.indexOf('const TENDER_SETTLEMENT'));
    const tenders = [...block.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((match) => match[1]);
    assert.deepEqual(tenders, ['card', 'cash', 'stored_value', 'gift_card'],
      'the tender set changed; check that each new one has a checkout step');
    // card and cash settle through pay; the two balance tenders need `balance`.
    for (const tender of tenders) {
      const step = tender === 'card' || tender === 'cash' ? 'pay' : 'balance';
      assert.ok(screens.has(step), `${tender} routes to /checkout/${step}, which does not exist`);
    }
  });

  it('completes the run a guest actually walks', () => {
    // Ordered because each step hands off to the next, and a missing one is a
    // dead end rather than a skipped question.
    for (const step of ['identify', 'name', 'tip', 'pay', 'processing'] as const) {
      assert.ok(screens.has(step), `/checkout/${step} is missing from the run`);
    }
    assert.ok(flowScreens.has('done'), 'the flow has no terminal screen');
    assert.ok(flowScreens.has('bag'), 'the flow has no bag screen to check out from');
  });

  it('keeps a keypad screen, which is the only way to enter a code without a keyboard', () => {
    assert.ok(screens.has('keypad'),
      'a kiosk has no keyboard; identify and balance both depend on this screen');
  });

  it('ships no checkout screen the flow cannot reach', () => {
    // The reverse direction: a screen nothing routes to is dead weight on a
    // device, and more importantly it is a step someone meant to wire up.
    const REACHABLE = new Set(['identify', 'name', 'tip', 'pay', 'processing', 'balance', 'keypad']);
    const stranded = [...screens].filter((screen) => !REACHABLE.has(screen)).sort();
    assert.deepEqual(stranded, [],
      'these checkout screens are not part of any documented run; wire them up or remove them');
  });
});
