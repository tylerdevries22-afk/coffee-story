import { randomUUID } from 'node:crypto';

import { coffeeStoryTrainingManifest, normalizeTrainingManifest, parseOptionGroups, parseSizes } from '@platform/domain';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { TrainingAnswerKey, TrainingManifest } from './training-bootstrap';

import { currentSession, hasRole } from './auth';
import {
  restoreTrainingAnswers,
  starterTrainingManifest,
  type ContentCategory,
  type ContentMenuItem,
  type ContentWorkspaceData,
} from './content-model';
import { serverEnv, serviceDb } from './api-auth';
import { serverClient } from './supabase-server';
import { resolveTenantTrainingProfile } from './training-bootstrap';

import demoMenuJson from '../../customer/src/tenant/menu.json';

type BrandRow = { id: string; name: string; brand_config: unknown };
type MenuRow = { id: string; name: string; is_published: boolean; updated_at: string };
type CategoryRow = { id: string; title: string; tagline: string; sort_order: number };
type ItemRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category_id: string;
  base_price_cents: number | string;
  sizes: unknown;
  modifiers: unknown;
  image_url: string | null;
  is_listed: boolean;
  is_86d: boolean;
  sort_order: number;
  updated_at: string;
};
type ReleaseRow = {
  id: string;
  version: number;
  status: 'draft' | 'published';
  manifest: unknown;
  updated_at: string;
};
type RunRow = { id: string; status: string; stage: string; progress: number; created_at: string };
type MediaVersionRow = { id: string; entity_type: string; entity_key: string; slot: string; public_url: string; created_at: string };

const DEMO_PROFILE = {
  businessName: 'Coffee Story', industry: 'Specialty coffee shop and café', locale: 'en-US',
  products: ['Espresso', 'Tea', 'Pastries'],
};

type DemoMenu = {
  categories: { id: string; title: string; tagline: string }[];
  items: {
    id: string;
    name: string;
    description: string;
    category: string;
    sizes: { priceCents: number }[];
    optionGroups: ContentMenuItem['optionGroups'];
    soldOutToday?: boolean;
  }[];
};

const DEMO_MENU = demoMenuJson as DemoMenu;

function demoManifest(): TrainingManifest {
  return coffeeStoryTrainingManifest(DEMO_PROFILE);
}

const DEMO_WORKSPACE: ContentWorkspaceData = {
  menu: { id: 'demo-menu', name: 'Coffee Story menu', isPublished: true, updatedAt: null },
  categories: DEMO_MENU.categories.map((category, index) => ({ ...category, sortOrder: index * 10 })),
  items: DEMO_MENU.items.map((item, index) => {
    const imageUrl = `/api/demo-media/menu/${item.id}`;
    const prices = item.sizes.map((size) => size.priceCents);
    return {
      id: item.id,
      name: item.name,
      slug: item.id,
      description: item.description,
      categoryId: item.category,
      basePriceCents: prices.length > 0 ? Math.min(...prices) : 0,
      sizes: item.sizes.map((size, sizeIndex) => ({
        slug: 'slug' in size && typeof size.slug === 'string' ? size.slug : `size-${sizeIndex + 1}`,
        label: 'ounces' in size && typeof size.ounces === 'number' ? `${size.ounces} oz` : 'Each',
        priceCents: size.priceCents,
      })),
      optionGroups: item.optionGroups,
      imageUrl,
      isListed: true,
      is86d: item.soldOutToday === true,
      sortOrder: index * 10,
      updatedAt: null,
      mediaVersions: [{ id: `${item.id}-bundled`, url: imageUrl, createdAt: '2026-08-26T00:00:00.000Z' }],
    };
  }),
  training: { id: 'demo-release', version: 3, status: 'published', manifest: demoManifest(), updatedAt: null },
  trainingMediaVersions: [],
  trainingProfile: DEMO_PROFILE,
  automationRun: { id: 'demo-run', status: 'published', stage: 'complete', progress: 100, createdAt: '2026-08-26T00:00:00.000Z' },
};

function asManifest(value: unknown, profile: ContentWorkspaceData['trainingProfile']): TrainingManifest {
  if (!value || typeof value !== 'object') return starterTrainingManifest(profile);
  const candidate = value as Partial<TrainingManifest>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.sources) && Array.isArray(candidate.modules)
    ? normalizeTrainingManifest(candidate as TrainingManifest)
    : candidate.schemaVersion === 2 && Array.isArray(candidate.sources) && Array.isArray(candidate.modules)
      ? normalizeTrainingManifest(candidate as TrainingManifest)
    : starterTrainingManifest(profile);
}

function contentItems(rows: ItemRow[], versions: MediaVersionRow[]): ContentMenuItem[] {
  const versionsByItem = new Map<string, ContentMenuItem['mediaVersions']>();
  for (const version of versions) {
    const itemVersions = versionsByItem.get(version.entity_key) ?? [];
    itemVersions.push({ id: version.id, url: version.public_url, createdAt: version.created_at, entityKey: version.entity_key, slot: version.slot });
    versionsByItem.set(version.entity_key, itemVersions);
  }
  return rows.map((row) => {
    const sizes = parseSizes(row.sizes, Number(row.base_price_cents));
    const optionGroups = parseOptionGroups(row.modifiers);
    if (optionGroups === null) throw new Error(`content item ${row.id}: invalid modifier groups`);
    return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    categoryId: row.category_id,
    basePriceCents: Number(row.base_price_cents),
    sizes: sizes.filter((size) => !size.synthetic).map((size) => ({
      slug: size.slug,
      label: size.label ?? (typeof size.ounces === 'number' ? `${size.ounces} oz` : size.slug),
      priceCents: size.priceCents,
    })),
    optionGroups: optionGroups.map((group) => ({
      id: group.id,
      name: group.name,
      select: group.select,
      required: group.required,
      maxChoices: group.maxChoices,
      choices: group.choices.map((choice) => ({ ...choice })),
      ...(group.dependsOn ? { dependsOn: { ...group.dependsOn, choiceIds: [...group.dependsOn.choiceIds] } } : {}),
    })),
    imageUrl: row.image_url,
    isListed: row.is_listed,
    is86d: row.is_86d,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
    mediaVersions: versionsByItem.get(row.id) ?? [],
    };
  });
}

async function loadOrCreateTenantMenu(
  client: SupabaseClient,
  brandId: string,
): Promise<MenuRow> {
  const read = () => client.from('menus').select('id, name, is_published, updated_at')
    .eq('brand_id', brandId).order('created_at').limit(1).maybeSingle<MenuRow>();
  const existing = await read();
  if (existing.error) throw new Error(`content menu: ${existing.error.message}`);
  if (existing.data) return existing.data;

  const menuId = randomUUID();
  let creationMessage = 'could not create the tenant menu';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const created = await client.from('menus').insert({
      id: menuId, brand_id: brandId, name: 'Menu', is_published: false,
    }).select('id, name, is_published, updated_at').single<MenuRow>();
    if (!created.error && created.data) return created.data;
    creationMessage = created.error?.message ?? creationMessage;
    const recovered = await read();
    if (!recovered.error && recovered.data) return recovered.data;
  }
  throw new Error(`content menu: ${creationMessage}`);
}

/** Loads the tenant workspace for exactly the tenant in the verified JWT. */
export async function loadContentWorkspace(options: { includeDraft?: boolean; includeAnswers?: boolean } = {}): Promise<ContentWorkspaceData> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'location_manager')) throw new Error('Content management requires manager access.');
  const client = await serverClient();
  if (!client) return DEMO_WORKSPACE;
  const user = await client.auth.getUser();
  if (!user.data.user) throw new Error('Content management requires an active session.');
  const membership = await client.from('brand_users').select('role')
    .eq('brand_id', session.brandId).eq('user_id', user.data.user.id)
    .single<{ role: string }>();
  if (membership.error || !['brand_owner', 'platform_admin', 'location_manager'].includes(membership.data.role)) {
    throw new Error('Content management requires current tenant access.');
  }
  const env = serverEnv();
  if (!env) throw new Error('HQ content management requires server-side Supabase credentials.');
  const privileged = serviceDb(env);

  const brandResult = await client.from('brands')
    .select('id, name, brand_config')
    .eq('id', session.brandId)
    .single<BrandRow>();
  if (brandResult.error) throw new Error(`content brand: ${brandResult.error.message}`);
  const profile = resolveTenantTrainingProfile(brandResult.data.name, brandResult.data.brand_config);

  const menu = await loadOrCreateTenantMenu(client, session.brandId);

  const [categories, items, releases, runs, mediaVersions] = await Promise.all([
    client.from('menu_categories').select('id, title, tagline, sort_order')
      .eq('menu_id', menu.id).order('sort_order').returns<CategoryRow[]>(),
    client.from('menu_items')
      .select('id, name, slug, description, category_id, base_price_cents, sizes, modifiers, image_url, is_listed, is_86d, sort_order, updated_at')
      .eq('menu_id', menu.id).order('sort_order').returns<ItemRow[]>(),
    client.from('training_releases').select('id, version, status, manifest, updated_at')
      .eq('brand_id', session.brandId).in('status', ['draft', 'published'])
      .order('created_at', { ascending: false }).returns<ReleaseRow[]>(),
    client.from('training_bootstrap_runs').select('id, status, stage, progress, created_at')
      .eq('brand_id', session.brandId).order('created_at', { ascending: false }).limit(1).returns<RunRow[]>(),
    client.from('content_media_versions').select('id, entity_type, entity_key, slot, public_url, created_at')
      .eq('brand_id', session.brandId)
      .order('created_at', { ascending: false }).limit(500).returns<MediaVersionRow[]>(),
  ]);
  if (categories.error) throw new Error(`content categories: ${categories.error.message}`);
  if (items.error) throw new Error(`content items: ${items.error.message}`);
  if (releases.error) throw new Error(`content training: ${releases.error.message}`);
  if (runs.error) throw new Error(`content automation: ${runs.error.message}`);
  if (mediaVersions.error) throw new Error(`content media history: ${mediaVersions.error.message}`);

  const selected = (options.includeDraft !== false ? releases.data?.find((release) => release.status === 'draft') : undefined)
    ?? releases.data?.find((release) => release.status === 'published');
  let manifest = asManifest(selected?.manifest, profile);
  if (selected && options.includeAnswers !== false) {
    const privateRelease = await privileged.from('training_releases')
      .select('answer_key').eq('id', selected.id).eq('brand_id', session.brandId)
      .single<{ answer_key: unknown }>();
    if (privateRelease.error) throw new Error(`content answer key: ${privateRelease.error.message}`);
    manifest = restoreTrainingAnswers(manifest, privateRelease.data.answer_key as TrainingAnswerKey);
  }

  const categoryRows: ContentCategory[] = (categories.data ?? []).map((category) => ({
    id: category.id, title: category.title, tagline: category.tagline, sortOrder: category.sort_order,
  }));
  const latestRun = runs.data?.[0];
  return {
    menu: {
      id: menu.id,
      name: menu.name,
      isPublished: menu.is_published,
      updatedAt: menu.updated_at,
    },
    categories: categoryRows,
    items: contentItems(
      items.data ?? [],
      (mediaVersions.data ?? []).filter((version) => version.entity_type === 'menu_item' && version.slot === 'thumbnail'),
    ),
    trainingMediaVersions: (mediaVersions.data ?? [])
      .filter((version) => version.entity_type !== 'menu_item')
      .map((version) => ({ id: version.id, url: version.public_url, createdAt: version.created_at, entityKey: version.entity_key, slot: version.slot })),
    training: selected
      ? { id: selected.id, version: selected.version, status: selected.status, manifest, updatedAt: selected.updated_at }
      : { id: null, version: 0, status: 'empty', manifest, updatedAt: null },
    trainingProfile: profile,
    automationRun: latestRun
      ? { id: latestRun.id, status: latestRun.status, stage: latestRun.stage, progress: latestRun.progress, createdAt: latestRun.created_at }
      : null,
  };
}
