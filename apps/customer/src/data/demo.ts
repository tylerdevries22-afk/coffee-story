import { taxCentsFor } from '@platform/domain';
import type { PortalOrder, PortalBundle } from '@platform/domain';

import { TENANT, TENANT_TAX_JURISDICTIONS } from '@/tenant';
import { resolveDemoSeeds } from './demo-seeds';
import type { DemoOrderSeed } from './demo-seeds';

// Sanitized, production-scale demo dataset. All names/emails/phones are fictional
// (example.com, 555 numbers). Every date is relative to portal creation so
// "upcoming" stays upcoming no matter when the app launches.
const now = new Date();

function dayAt(daysFromNow: number, hour: number, minute = 0): Date {
  const value = new Date(now);
  value.setDate(value.getDate() + daysFromNow);
  value.setHours(hour, minute, 0, 0);
  return value;
}

function isoAt(daysFromNow: number, hour: number, minute = 0): string {
  return dayAt(daysFromNow, hour, minute).toISOString();
}

const SHOP_LABEL = `${TENANT.identity.name} · ${TENANT.location.address.street}`;
/**
 * Kept for the screens that still ask "is this a project business", derived
 * from the declared industry rather than from whether a copy key happens to
 * be set.
 */
const IS_PROJECT_BUSINESS = TENANT.business.industryKey === 'construction';
const DELIVERY_LABEL = IS_PROJECT_BUSINESS ? 'Project site' : 'Delivery';
const DELIVERY_DETAIL = `${IS_PROJECT_BUSINESS ? 'Demo site' : 'Demo delivery'} · ${TENANT.location.address.city}, ${TENANT.location.address.region}`;

/**
 * Which vertical's fixtures this tenant demos with, resolved the same way
 * `homeIndustryPack` resolves the home screen's marketing copy: three known
 * packs, and everything else -- `generic` included -- lands on neutral rather
 * than inheriting whichever tenant used to be the unlabeled default.
 */
const SEEDS = resolveDemoSeeds(TENANT.business.industryKey);

/**
 * Orders are pay-at-pickup, so the demo carries no deposit and no tip.
 *
 * Tax comes from the real jurisdiction table rather than a flat guess: the
 * demo bundle feeds the same history and receipt surfaces as the live plane,
 * and a total that does not equal subtotal + tax is the kind of thing that
 * only ever surfaces in a screenshot.
 */
function order(seed: DemoOrderSeed): PortalOrder {
  const placedAt = isoAt(seed.days, seed.hour, seed.minute);
  const taxCents = taxCentsFor(seed.priceCents, TENANT_TAX_JURISDICTIONS);
  return {
    id: seed.id,
    status: seed.status,
    summary: seed.item,
    lines: [{ name: seed.item, quantity: 1, unitPriceCents: seed.priceCents, options: [] }],
    fulfillmentType: seed.mobile ? 'delivery' : 'pickup',
    scheduledFor: placedAt,
    placedAt,
    subtotalCents: seed.priceCents,
    taxCents,
    tipCents: 0,
    totalCents: seed.priceCents + taxCents,
    note: '',
    guestLabel: seed.client,
    locationLabel: seed.mobile ? DELIVERY_LABEL : SHOP_LABEL,
    locationDetail: seed.mobile ? DELIVERY_DETAIL : undefined,
  };
}

const orders: PortalOrder[] = SEEDS.orderSeeds.map(order);

// Account totals are authoritative (the server returns them alongside a recent
// activity window); the ledger below is that recent window, not full history.
const rewardLedger = SEEDS.rewardLedger(isoAt);

const giftCards = SEEDS.giftCards(isoAt);

const messages = SEEDS.messages(isoAt);

export const DEMO_PORTAL: PortalBundle = {
  demoStateVersion: 5,
  autoPromptDismissed: false,
  profile: {
    id: 'demo-client',
    fullName: 'Alex Rivera',
    email: 'alex@example.com',
    phone: '(720) 555-0144',
    birthday: '1990-07-08',
    avatarUrl: null,
  },
  role: 'client',
  orders,
  rewardAccount: {
    availablePoints: 1376,
    annualPoints: 1876,
    cashCents: 2500,
    annualPeriodStart: `${now.getFullYear()}-01-01`,
  },
  rewardLedger,
  rewardActivities: [...SEEDS.rewardActivities],
  rewardCatalog: [...SEEDS.rewardCatalog],
  giftCards,
  paymentMethods: [
    { id: 'demo-payment-1', brand: 'Visa', last4: '4242', expirationMonth: 12, expirationYear: now.getFullYear() + 2, isDefault: true },
    { id: 'demo-payment-2', brand: 'Mastercard', last4: '5544', expirationMonth: 8, expirationYear: now.getFullYear() + 1, isDefault: false },
  ],
  messages,
  preferences: {
    completed: true,
    notes: SEEDS.preferenceNotes,
    strength: 'medium',
    updatedAt: isoAt(-20, 9),
  },
  membership: {
    id: 'demo-membership',
    name: SEEDS.membershipName,
    status: 'active',
    priceCents: 1900,
    renewsAt: new Date(now.getFullYear(), now.getMonth() + 1, 5).toISOString(),
    creditsAvailable: 4,
  },
};
