import { TENANT } from '@/tenant';

export const IS_PROJECT_BUSINESS = Boolean(TENANT.copy.projectName);
export const ACTION_LABEL = TENANT.copy.orderCta || 'Start an order';
export const ACTION_DETAIL = IS_PROJECT_BUSINESS ? 'Consultation' : '~ 3 min';

export const HOME_PACKAGES = IS_PROJECT_BUSINESS
  ? [
      { name: 'Project Consultation', detail: 'Scope, feasibility, and next steps', price: '$250' },
      { name: 'Preconstruction Plan', detail: 'Selections, schedule, and budget alignment', price: '$1,500' },
      { name: 'Kitchen Renovation', detail: 'Design coordination and field delivery', price: 'From $5k' },
      { name: 'Bathroom Renovation', detail: 'Managed renovation with a dedicated team', price: 'From $3.5k' },
    ]
  : [
      { name: 'The Daily Ritual', detail: '10 × brewed coffee, any size', price: '$35' },
      { name: 'Latte Lover', detail: '5 × signature lattes', price: '$30' },
      { name: 'Boba Week', detail: '5 × boba milk teas', price: '$30' },
      { name: 'The Sweet Pair', detail: '6 × mochi donuts + 2 lattes', price: '$32' },
    ];

const city = TENANT.location.address.city || (IS_PROJECT_BUSINESS ? 'our region' : 'our neighborhood');

export const HOME_COPY = IS_PROJECT_BUSINESS
  ? {
      openingAlt: `${TENANT.identity.name} construction team at work`,
      mediaAlt: `${TENANT.identity.name} project planning and field service`,
      packageEyebrow: 'Planning & renovation', packageTitle: 'Build with clarity.',
      supportTitle: 'Support after handoff.',
      supportBody: 'Request a warranty inspection and stay connected to your project team.',
      supportA11y: 'Request warranty service', supportAction: 'Request Service',
      favoritesTitle: 'Popular Project Paths',
      favoritesBody: `The planning and renovation services ${city} trusts — managed by ${TENANT.identity.name}.`,
      favoriteTag: 'Most Requested', catalogPill: 'Project Services',
      catalogTitle: 'Explore by Project Stage',
      catalogBody: 'Planning, renovation, and warranty support — choose a service to begin.',
    }
  : {
      openingAlt: `Inside the ${TENANT.identity.name} café`,
      mediaAlt: `A ${TENANT.identity.name} gift card design`,
      packageEyebrow: 'Bundles & beans', packageTitle: 'Stock your story.',
      supportTitle: 'Gift their next favorite cup.',
      supportBody: 'Digital gift cards arrive beautifully and never expire.',
      supportA11y: `Send a ${TENANT.identity.name} gift card`, supportAction: 'Send a Gift',
      favoritesTitle: 'House Favorites',
      favoritesBody: `The drinks ${city} keeps coming back for — handcrafted by ${TENANT.identity.name}.`,
      favoriteTag: 'Most Loved', catalogPill: 'The Full Menu',
      catalogTitle: 'Explore by Category',
      catalogBody: 'Every drink and bite we serve — tap anything to start an order.',
    };
