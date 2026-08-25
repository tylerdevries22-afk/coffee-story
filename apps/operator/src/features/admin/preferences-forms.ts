/**
 * Mirrors the `intake_forms` catalog that the web app seeds and both admin
 * portals read.
 *
 * The three clinical forms this list inherited from the massage business --
 * a health history, a massage consent and a cancellation policy for reserved
 * order time -- are gone. A coffee shop does not take a health history,
 * and an admin opening Settings should not be offered one. The wording below
 * still needs counsel's review before it is put in front of a guest; see
 * PRODUCTION_SETUP.md.
 *
 * Bundled rather than fetched: this panel has to be correct with no backend at
 * all -- the Expo Go demo runs entirely offline, and an admin opening Settings
 * on a bad connection should still see the real documents rather than an empty
 * list. The catalog only changes when a release changes it, so there is nothing
 * a live fetch would catch.
 *
 * Kept honest by `lib/preferences-forms-catalog.test.ts` in the web app, which fails
 * CI if this list stops matching the rows the migration seeds.
 */
export type IntakeFormCatalogEntry = {
  id: string;
  title: string;
  /** The kicker above the title on the public page, e.g. "Informed consent". */
  eyebrow: string;
  /** The one-paragraph description a client reads before opening it. */
  summary: string;
  /** When the client is asked to sign it, e.g. "Before first order". */
  stage: string;
  version: string;
  duration: string;
};

export const INTAKE_FORM_CATALOG: readonly IntakeFormCatalogEntry[] = [
  {
    id: 'allergens-and-preferences',
    eyebrow: 'How you take it',
    summary: 'Tell the bar about allergies, dairy and nut restrictions, caffeine limits, and how you like your drinks made, so every order is right the first time.',
    title: 'Allergens & Drink Preferences',
    stage: 'With your first order',
    version: 'ADP-2026.08',
    duration: '2-3 min',
  },
  {
    id: 'catering-agreement',
    eyebrow: 'Mobile coffee cart',
    summary: 'Confirm the date, headcount, menu, site access, power and water, setup window, and the deposit and cancellation terms for a coffee cart booking.',
    title: 'Catering & Coffee Cart Agreement',
    stage: 'When booking catering',
    version: 'CCA-2026.08',
    duration: '5-7 min',
  },
  {
    id: 'order-and-refund-policy',
    eyebrow: 'Ordering ahead',
    summary: 'Review how pickup windows, remakes, cancellations, uncollected orders, and refunds are handled on an order placed through the app.',
    title: 'Order & Refund Policy',
    stage: 'At checkout',
    version: 'ORP-2026.08',
    duration: '3-4 min',
  },
  {
    id: 'gift-card-terms',
    eyebrow: 'Purchase and redemption',
    summary: 'Record the purchaser, intended recipient, delivery details, and the terms for using or transferring a shop gift card.',
    title: 'Gift Card Terms',
    stage: 'With purchase',
    version: 'GCT-2026.08',
    duration: '3-5 min',
  },
];
