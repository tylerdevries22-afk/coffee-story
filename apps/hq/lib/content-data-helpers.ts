import { randomUUID } from 'node:crypto';

import { liftTrainingManifest, parseOptionGroups, parseSizes } from '@platform/domain';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { TrainingManifest } from './training-bootstrap';
import { starterTrainingManifest, type ContentMenuItem, type ContentWorkspaceData } from './content-model';
import type { ItemRow, MediaVersionRow, MenuRow } from './content-data-types';

export function asManifest(value: unknown, profile: ContentWorkspaceData['trainingProfile']): TrainingManifest {
  return liftTrainingManifest(value) ?? starterTrainingManifest(profile);
}

export function contentItems(rows: ItemRow[], versions: MediaVersionRow[]): ContentMenuItem[] {
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
    audience: row.catalog_audience,
    isListed: row.is_listed,
    is86d: row.is_86d,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
    mediaVersions: versionsByItem.get(row.id) ?? [],
    };
  });
}

export async function loadOrCreateTenantMenu(
  client: SupabaseClient,
  brandId: string,
  createIfMissing: boolean,
): Promise<MenuRow> {
  const read = () => client.from('menus').select('id, name, is_published, updated_at')
    .eq('brand_id', brandId).order('created_at').limit(1).maybeSingle<MenuRow>();
  const existing = await read();
  if (existing.error) throw new Error(`content menu: ${existing.error.message}`);
  if (existing.data) return existing.data;
  // A platform operator may inspect another organization, but opening its
  // catalog must remain a read. The home-tenant editor will initialize this
  // row when its owner first opens it; a foreign empty tenant gets a valid,
  // inert placeholder so all downstream reads simply return empty sets.
  if (!createIfMissing) {
    return { id: brandId, name: 'Menu', is_published: false, updated_at: '' };
  }

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
