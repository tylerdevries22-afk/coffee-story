/**
 * The starting text of the agreements an admin can edit in Settings.
 *
 * Three earlier claims in this comment were false and are worth naming, since
 * they would each send someone looking for a file: there is no `intake_forms`
 * table and no migration seeding one, no catalog test keeping this list
 * honest, and no second copy in a web app. A byte-identical duplicate did
 * live in the customer binary -- admin copy shipped to guests, against the
 * rule that operator functionality stays out of that build -- and it was
 * imported by nothing; it is gone.
 *
 * Bundled rather than fetched, so the panel is correct with no backend at all:
 * the demo runs offline, and an admin on a bad connection should see the real
 * documents rather than an empty list.
 *
 * Nothing persists yet -- `mobileApi.updateIntakeForms` answers 501 on a live
 * account and says so to the admin. The wording still needs counsel's review
 * before it is put in front of a guest; see docs/PRODUCTION_SETUP.md.
 *
 * The copy is deliberately shop-neutral. This binary is one App Store listing
 * serving every tenant, so a brand name written in here would be the wrong
 * brand for all but one of them.
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
