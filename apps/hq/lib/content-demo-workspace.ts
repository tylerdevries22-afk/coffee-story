import { cafeTrainingManifest, type TenantTrainingProfile } from '@platform/domain';

import demoMenuJson from '../../customer/src/tenants/coffee-story/menu.json';
import { starterTrainingManifest, type ContentMenuItem, type ContentWorkspaceData } from './content-model';

const LAUNCH_PROFILE: TenantTrainingProfile = {
  businessName: 'Coffee Story', industry: 'Specialty coffee shop and café', locale: 'en-US',
  products: ['Espresso', 'Tea', 'Pastries'],
};

type DemoMenu = {
  categories: { id: string; title: string; tagline: string }[];
  items: {
    id: string; name: string; description: string; category: string;
    sizes: { slug?: string; ounces?: number; priceCents: number }[];
    optionGroups: ContentMenuItem['optionGroups']; soldOutToday?: boolean;
  }[];
};

const MENU = demoMenuJson as DemoMenu;

function launchWorkspace(): ContentWorkspaceData {
  return {
    menu: {
      id: 'demo-menu', name: 'Coffee Story catalog', isPublished: true,
      draftVersion: 1, publishedVersion: 1, updatedAt: null,
    },
    categories: MENU.categories.map((category, index) => ({
      ...category, slug: category.id, parentId: null, imageUrl: null,
      audience: 'public', archived: false, sortOrder: index * 10, mediaVersions: [],
    })),
    items: MENU.items.map((item, index) => {
      const imageUrl = `/api/demo-media/menu/${item.id}`;
      const prices = item.sizes.map((size) => size.priceCents);
      return {
        id: item.id, name: item.name, slug: item.id, description: item.description,
        categoryId: item.category, basePriceCents: prices.length > 0 ? Math.min(...prices) : 0,
        sizes: item.sizes.map((size, sizeIndex) => ({
          slug: size.slug ?? `size-${sizeIndex + 1}`,
          label: typeof size.ounces === 'number' ? `${size.ounces} oz` : 'Each',
          priceCents: size.priceCents,
        })),
        optionGroups: item.optionGroups, imageUrl, audience: 'public' as const,
        isListed: true, is86d: item.soldOutToday === true, sortOrder: index * 10,
        updatedAt: null,
        mediaVersions: [{
          id: `${item.id}-bundled`, url: imageUrl, createdAt: '2026-08-26T00:00:00.000Z',
        }],
      };
    }),
    catalogResources: [], catalogRelations: [], catalogPlacements: [],
    training: {
      id: 'demo-release', version: 3, status: 'published',
      manifest: cafeTrainingManifest(LAUNCH_PROFILE), updatedAt: null,
    },
    trainingMediaVersions: [], trainingProfile: LAUNCH_PROFILE,
    automationRun: {
      id: 'demo-run', status: 'published', stage: 'complete', progress: 100,
      createdAt: '2026-08-26T00:00:00.000Z',
    },
  };
}

export function demoContentWorkspace(profile?: TenantTrainingProfile): ContentWorkspaceData {
  if (!profile) return launchWorkspace();
  return {
    menu: {
      id: 'demo-empty-menu', name: `${profile.businessName} catalog`, isPublished: false,
      draftVersion: 1, publishedVersion: null, updatedAt: null,
    },
    categories: [], items: [], catalogResources: [], catalogRelations: [], catalogPlacements: [],
    training: {
      id: null, version: 0, status: 'empty',
      manifest: starterTrainingManifest(profile), updatedAt: null,
    },
    trainingMediaVersions: [], trainingProfile: profile, automationRun: null,
  };
}
