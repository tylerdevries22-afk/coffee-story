/**
 * Delivery may not be installed for a tenant until the platform can actually
 * perform it.
 *
 * The storefront prices delivery from DELIVERY_FEE_CENTS and shows the guest
 * that number during fulfillment selection. `packages/engine` has no delivery
 * fee concept at all, so nothing adds it to the Square payment -- the shop
 * absorbs every one. No address reaches the order either, so nobody downstream
 * knows where to take it. The flow ended in a refusal at the place-order tap,
 * after the guest had chosen delivery, typed an address and built a cart
 * against a quoted total.
 *
 * coffee-story was the only tenant with it installed and it is now off, which
 * makes the whole flow unreachable. That is a convention, and a convention is
 * one manifest edit from being undone by someone who cannot see why it was a
 * convention. This is the same rule as an assertion instead: installing the
 * module fails here, naming both things that must exist first.
 *
 * Delete this file when both preconditions are real. It is a tripwire for a
 * known-incomplete capability, not a permanent rule about delivery.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const TENANTS = join(ROOT, 'tenants');
const DELIVERY_MODULE = 'commerce-delivery';

type ModuleEntry = { key?: unknown; enabled?: unknown };

function tenantSlugs(): string[] {
  return readdirSync(TENANTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(TENANTS, entry.name, 'modules.json')))
    .map((entry) => entry.name)
    .sort();
}

/** Tenants whose manifest installs the delivery module and leaves it enabled. */
function tenantsInstallingDelivery(): string[] {
  return tenantSlugs().filter((slug) => {
    const raw = readFileSync(join(TENANTS, slug, 'modules.json'), 'utf8');
    const parsed = JSON.parse(raw) as { modules?: unknown };
    if (!Array.isArray(parsed.modules)) return false;
    return parsed.modules.some((entry) => {
      const module = entry as ModuleEntry;
      return module.key === DELIVERY_MODULE && module.enabled !== false;
    });
  });
}

/** Every .ts file under a directory, tests excluded. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
    }
  };
  walk(directory);
  return found;
}

/**
 * Whether the engine charges for delivery.
 *
 * A source search rather than a type check because the shape this will take is
 * not decided yet -- what matters is that the engine gained the concept at all,
 * and whoever adds it will be reading this test to find out why it failed.
 */
function engineChargesDeliveryFee(): boolean {
  return sourceFiles(join(ROOT, 'packages', 'engine', 'src'))
    .some((file) => /deliveryFee|DELIVERY_FEE|delivery_fee/.test(readFileSync(file, 'utf8')));
}

/** Whether an order can carry the address a courier would need. */
function orderInputCarriesAddress(): boolean {
  const types = readFileSync(join(ROOT, 'packages', 'engine', 'src', 'orders', 'types.ts'), 'utf8');
  return /address/i.test(types);
}

describe('delivery capability preconditions', () => {
  /** Mirrors the line-length gate: a guard that measures nothing always passes. */
  it('measures every tenant manifest, so the guard cannot pass by finding nothing', () => {
    const slugs = tenantSlugs();
    assert.ok(slugs.length >= 4, `only ${slugs.length} tenant manifests found under ${TENANTS}`);
    assert.ok(slugs.includes('_template'), 'the template is a tenant manifest and is checked like the rest');
  });

  it('refuses the delivery module until the engine charges the fee it quotes', () => {
    const installing = tenantsInstallingDelivery();
    if (installing.length === 0) return;
    assert.ok(engineChargesDeliveryFee(),
      `${installing.join(', ')} install ${DELIVERY_MODULE}, but packages/engine has no delivery fee concept. `
      + 'The guest is quoted DELIVERY_FEE_CENTS during the flow and nothing adds it to the Square payment, '
      + 'so the shop absorbs it on every order. Add the fee to the payment before installing this module.');
  });

  it('refuses the delivery module until an order can carry an address', () => {
    const installing = tenantsInstallingDelivery();
    if (installing.length === 0) return;
    assert.ok(orderInputCarriesAddress(),
      `${installing.join(', ')} install ${DELIVERY_MODULE}, but no address reaches the order. `
      + 'CreateOrderInput carries none, so a delivery order records no destination and nobody downstream '
      + 'knows where to take it. Carry the address onto the order before installing this module.');
  });

  /**
   * The preconditions themselves, asserted directly rather than only through a
   * tenant that installs the module. Without this the two tests above are
   * vacuous today and would stay green through a half-finished implementation.
   */
  it('records which preconditions are still missing, so the tripwire is not silent', () => {
    const missing = [
      engineChargesDeliveryFee() ? null : 'packages/engine charges no delivery fee',
      orderInputCarriesAddress() ? null : 'CreateOrderInput carries no address',
    ].filter((entry): entry is string => entry !== null);
    // Both are expected to be missing right now. When this fails because the
    // list is empty, delete this file: the capability is real and the tripwire
    // has done its job.
    assert.deepEqual(missing, [
      'packages/engine charges no delivery fee',
      'CreateOrderInput carries no address',
    ], 'delivery preconditions changed -- re-read this file and decide whether the tripwire should go');
  });
});
