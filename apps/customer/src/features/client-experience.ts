import type { ClientTab } from '@/state/navigation-state';

export type ClientExperienceKind = 'base' | 'commerce' | 'construction';

export type ClientTabLabels = Readonly<Record<ClientTab, string>>;

export type ClientExperience = {
  kind: ClientExperienceKind;
  tabs: readonly ClientTab[];
  tabLabels: ClientTabLabels;
};

const COMMERCE: ClientExperience = {
  kind: 'commerce',
  tabs: ['home', 'gift', 'book', 'rewards', 'more'],
  tabLabels: {
    home: 'Home',
    gift: 'Gift',
    book: 'Order',
    rewards: 'Rewards',
    more: 'Profile',
  },
};

const CONSTRUCTION: ClientExperience = {
  kind: 'construction',
  tabs: ['home', 'gift', 'book', 'rewards', 'more'],
  tabLabels: {
    home: 'Home',
    gift: 'Documents',
    book: 'Project',
    rewards: 'Payments',
    more: 'More',
  },
};

const BASE: ClientExperience = {
  kind: 'base',
  tabs: ['home', 'book', 'more'],
  tabLabels: {
    home: 'Home',
    gift: 'Resources',
    book: 'Catalog',
    rewards: 'Activity',
    more: 'Profile',
  },
};

export function clientExperienceForModules(moduleKeys: readonly string[]): ClientExperience {
  if (moduleKeys.includes('construction-projects')) return CONSTRUCTION;
  if (moduleKeys.includes('commerce-ordering')) return COMMERCE;
  return BASE;
}
