/**
 * Home-screen marketing copy, per industry.
 *
 * The industry packs in `@platform/ui` cover UI chrome -- the twenty-one keys a
 * button, a board or a bag needs. They do not cover the home screen's
 * marketing prose, which is why this lives here rather than there.
 *
 * There are three packs and not two. The screen used to branch on
 * `Boolean(TENANT.copy.projectName)`, so every tenant that was not a
 * construction business got the coffee branch -- including juniper-base-demo,
 * which declares `business.industryKey: "generic"` and ships a customer app
 * advertising "Latte Lover" and "Boba Week". A tenant that belongs to no
 * vertical must read as nobody's vertical, which needs copy of its own; a
 * two-way flag can only ever make it somebody else's.
 *
 * The neutral pack names no product, no venue and no fulfillment model. That
 * is the point: it has to be true for a consultancy, a studio and a shop at
 * once, so it describes the relationship rather than the goods.
 */

export type HomePackage = {
  readonly name: string;
  readonly detail: string;
  readonly price: string;
};

export type HomeCopy = {
  readonly openingAlt: string;
  readonly mediaAlt: string;
  readonly packageEyebrow: string;
  readonly packageTitle: string;
  readonly supportTitle: string;
  readonly supportBody: string;
  readonly supportA11y: string;
  readonly supportAction: string;
  readonly favoritesTitle: string;
  readonly favoritesBody: string;
  readonly favoriteTag: string;
  readonly catalogPill: string;
  readonly catalogTitle: string;
  readonly catalogBody: string;
};

export type HomeIndustryPack = {
  readonly actionDetail: string;
  readonly cityFallback: string;
  readonly packages: readonly HomePackage[];
  readonly copy: (name: string, city: string) => HomeCopy;
};

const CONSTRUCTION: HomeIndustryPack = {
  actionDetail: 'Consultation',
  cityFallback: 'our region',
  packages: [
    { name: 'Project Consultation', detail: 'Scope, feasibility, and next steps', price: '$250' },
    { name: 'Preconstruction Plan', detail: 'Selections, schedule, and budget alignment', price: '$1,500' },
    { name: 'Kitchen Renovation', detail: 'Design coordination and field delivery', price: 'From $5k' },
    { name: 'Bathroom Renovation', detail: 'Managed renovation with a dedicated team', price: 'From $3.5k' },
  ],
  copy: (name, city) => ({
    openingAlt: `${name} construction team at work`,
    mediaAlt: `${name} project planning and field service`,
    packageEyebrow: 'Planning & renovation',
    packageTitle: 'Build with clarity.',
    supportTitle: 'Support after handoff.',
    supportBody: 'Request a warranty inspection and stay connected to your project team.',
    supportA11y: 'Request warranty service',
    supportAction: 'Request Service',
    favoritesTitle: 'Popular Project Paths',
    favoritesBody: `The planning and renovation services ${city} trusts — managed by ${name}.`,
    favoriteTag: 'Most Requested',
    catalogPill: 'Project Services',
    catalogTitle: 'Explore by Project Stage',
    catalogBody: 'Planning, renovation, and warranty support — choose a service to begin.',
  }),
};

const COFFEE_SHOP: HomeIndustryPack = {
  actionDetail: '~ 3 min',
  cityFallback: 'our neighborhood',
  packages: [
    { name: 'The Daily Ritual', detail: '10 × brewed coffee, any size', price: '$35' },
    { name: 'Latte Lover', detail: '5 × signature lattes', price: '$30' },
    { name: 'Boba Week', detail: '5 × boba milk teas', price: '$30' },
    { name: 'The Sweet Pair', detail: '6 × mochi donuts + 2 lattes', price: '$32' },
  ],
  copy: (name, city) => ({
    openingAlt: `Inside the ${name} café`,
    mediaAlt: `A ${name} gift card design`,
    packageEyebrow: 'Bundles & beans',
    packageTitle: 'Stock your story.',
    supportTitle: 'Gift their next favorite cup.',
    supportBody: 'Digital gift cards arrive beautifully and never expire.',
    supportA11y: `Send a ${name} gift card`,
    supportAction: 'Send a Gift',
    favoritesTitle: 'House Favorites',
    favoritesBody: `The drinks ${city} keeps coming back for — handcrafted by ${name}.`,
    favoriteTag: 'Most Loved',
    catalogPill: 'The Full Menu',
    catalogTitle: 'Explore by Category',
    catalogBody: 'Every drink and bite we serve — tap anything to start an order.',
  }),
};

/**
 * No product, no venue, no fulfillment model. A tenant lands here by declaring
 * `generic`, or by naming an industry the platform has not written a pack for
 * yet -- and the second case is the one that matters, because it is silent.
 */
const GENERIC: HomeIndustryPack = {
  actionDetail: 'A few minutes',
  cityFallback: 'your area',
  packages: [],
  copy: (name, city) => ({
    openingAlt: `The ${name} team at work`,
    mediaAlt: `A ${name} gift card design`,
    packageEyebrow: 'Ways to start',
    packageTitle: 'Find what you need.',
    supportTitle: 'Give someone a head start.',
    supportBody: 'Digital gift cards arrive instantly and never expire.',
    supportA11y: `Send a ${name} gift card`,
    supportAction: 'Send a Gift',
    favoritesTitle: 'Popular Choices',
    favoritesBody: `What ${city} comes back to ${name} for.`,
    favoriteTag: 'Most Chosen',
    catalogPill: 'Everything We Offer',
    catalogTitle: 'Explore by Category',
    catalogBody: 'Browse what we offer — tap anything to begin.',
  }),
};

const PACKS: Readonly<Record<string, HomeIndustryPack>> = {
  construction: CONSTRUCTION,
  'coffee-shop': COFFEE_SHOP,
};

/**
 * The pack for an industry key.
 *
 * An unrecognised key resolves to neutral rather than to the launch tenant's,
 * matching `industryCopy` in @platform/ui. A vertical can be onboarded before
 * its home pack is written, and that tenant must read as nobody's industry in
 * the meantime.
 */
export function homeIndustryPack(industryKey: string): HomeIndustryPack {
  return PACKS[industryKey] ?? GENERIC;
}
