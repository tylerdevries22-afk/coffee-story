/**
 * Mirrors the `intake_forms` catalog that the web app seeds and both admin
 * portals read.
 *
 * Bundled rather than fetched: this panel has to be correct with no backend at
 * all -- the Expo Go demo runs entirely offline, and an admin opening Settings
 * on a bad connection should still see the real documents rather than an empty
 * list. The catalog only changes when a release changes it, so there is nothing
 * a live fetch would catch.
 *
 * Kept honest by `lib/intake-forms-catalog.test.ts` in the web app, which fails
 * CI if this list stops matching the rows the migration seeds.
 */
export type IntakeFormCatalogEntry = {
  id: string;
  title: string;
  /** The kicker above the title on the public page, e.g. "Informed consent". */
  eyebrow: string;
  /** The one-paragraph description a client reads before opening it. */
  summary: string;
  /** When the client is asked to sign it, e.g. "Before first visit". */
  stage: string;
  version: string;
  duration: string;
};

export const INTAKE_FORM_CATALOG: readonly IntakeFormCatalogEntry[] = [
  {
    id: 'health-history',
    eyebrow: 'Before your first session',
    summary: 'Share your health history, medications, sensitivities, goals, and areas that need special care so your session can be planned safely.',
    title: 'Health History & Intake',
    stage: 'Before first visit',
    version: 'HHI-2026.07',
    duration: '8-12 min',
  },
  {
    id: 'massage-consent',
    eyebrow: 'Informed consent',
    summary: 'Set clear expectations for pressure, draping, privacy, professional boundaries, and your right to change or stop the session.',
    title: 'Massage Consent',
    stage: 'Before first visit',
    version: 'MSC-2026.07',
    duration: '5-7 min',
  },
  {
    id: 'cancellation-policy',
    eyebrow: 'Reserved appointment time',
    summary: 'Review how deposits, rescheduling, late arrivals, missed visits, and emergency exceptions are handled.',
    title: 'Cancellation & Late Policy',
    stage: 'At booking',
    version: 'CLP-2026.07',
    duration: '3-4 min',
  },
  {
    id: 'gift-card-terms',
    eyebrow: 'Purchase and redemption',
    summary: 'Record the purchaser, intended recipient, delivery details, and the terms for using or transferring a studio gift card.',
    title: 'Gift Card Terms',
    stage: 'With purchase',
    version: 'GCT-2026.07',
    duration: '3-5 min',
  },
];
