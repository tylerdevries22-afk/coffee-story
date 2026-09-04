/**
 * Which of the tenants a guest binary bundles this build is for.
 *
 * Rule 7 still holds: one customer binary and one kiosk binary per brand.
 * What changed is that the *repository* now holds every applied tenant at once
 * (`apps/<app>/src/tenants/<slug>/`, named by a generated barrel) instead of
 * one shared slot that the last `pnpm onboard --apply` overwrote. Metro's real
 * constraint is that it cannot `require` a path it computes at runtime; a
 * barrel whose every path is a literal is fully static, so N tenants can
 * coexist and each build picks one deliberately.
 *
 * "Deliberately" is the whole point of this module. Shipping one shop's menu
 * under another shop's name is correctly signed, correctly titled and wrong,
 * and nothing in a build log says so -- so an ambiguous choice throws here
 * rather than resolving to whichever slug sorted first.
 */

/**
 * The shape a tenant slug is allowed to have, matching what onboarding accepts.
 *
 * Checked at selection and not only at onboarding, because the value arrives
 * from the environment. A slug is a key into a plain object, so `constructor`
 * and `__proto__` resolve up the prototype chain to something truthy: without
 * this, `EXPO_PUBLIC_TENANT=constructor` passed the "is it applied" check and
 * yielded a slot whose slug was `undefined` -- a build that did not fail loudly,
 * which is the one outcome this module exists to make impossible.
 */
import { isPlatformSlug } from '@platform/schema';

/**
 * The slug contract lives in `@platform/schema`, which menu.csv already
 * enforced it with. Re-exported here so a guest app reads it from the module
 * that selects a tenant, without a second copy of the pattern existing.
 */
export { isPlatformSlug as isTenantSlug } from '@platform/schema';

/** The minimum a slot must carry to be selectable: the slug it was applied as. */
export type TenantSlotIdentity = { readonly slug: string };

export type TenantSlotSelection<Slot extends TenantSlotIdentity> = {
  /** The app doing the selecting, for the error message only ('customer', 'kiosk'). */
  readonly app: string;
  /** Every tenant applied to this app, keyed by slug. Generated. */
  readonly slots: Readonly<Record<string, Slot>>;
  /** `EXPO_PUBLIC_TENANT`, inlined into the bundle at build time. */
  readonly requested?: string | undefined;
};

/** The applied slugs, sorted, as the error messages and tests want them. */
export function appliedTenantSlugs(slots: Readonly<Record<string, unknown>>): readonly string[] {
  // Own enumerable keys only, so an inherited property can never read as applied.
  return Object.keys(slots).filter((slug) => Object.hasOwn(slots, slug)).sort();
}

/**
 * The one tenant this build ships, or a throw naming the ambiguity.
 *
 * Unset with exactly one tenant applied is unambiguous and resolves to it --
 * the single-tenant checkout and every existing test keep working with no env
 * at all. Unset with several applied is the dangerous case and is fatal at
 * module load, which is the earliest and loudest place it can be.
 */
export function selectTenantSlot<Slot extends TenantSlotIdentity>(
  selection: TenantSlotSelection<Slot>,
): Slot {
  const { app, slots } = selection;
  const applied = appliedTenantSlugs(slots);
  const requested = selection.requested?.trim() ?? '';

  if (applied.length === 0) {
    throw new Error(
      `apps/${app} has no tenant applied. Run \`pnpm onboard --tenant <slug> --apply\`.`,
    );
  }

  if (requested !== '') {
    // `Object.hasOwn` and not a truthiness test: see the module comment above.
    const slot = isPlatformSlug(requested) && Object.hasOwn(slots, requested)
      ? slots[requested]
      : undefined;
    if (!slot) {
      throw new Error(
        `EXPO_PUBLIC_TENANT="${requested}" is not applied to apps/${app}. ` +
          `Applied: ${applied.join(', ')}. ` +
          'Run `pnpm onboard --tenant ' + requested + ' --apply` before building it.',
      );
    }
    return slot;
  }

  const only = applied[0];
  if (applied.length === 1 && only !== undefined) {
    const slot = Object.hasOwn(slots, only) ? slots[only] : undefined;
    if (slot) return slot;
  }

  throw new Error(
    `apps/${app} bundles ${applied.length} tenants (${applied.join(', ')}) and ` +
      'EXPO_PUBLIC_TENANT is not set. Set EXPO_PUBLIC_TENANT=<slug> so the build ' +
      'picks one; guessing here would ship one shop under another shop\'s name.',
  );
}
