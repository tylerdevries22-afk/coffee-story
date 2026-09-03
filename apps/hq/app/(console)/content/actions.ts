'use server';

import { createHash, randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { start } from 'workflow/api';
import { revalidatePath } from 'next/cache';
import { liftTrainingManifest } from '@platform/domain';

import { currentSession, hasRole } from '@/lib/auth';
import {
  validateMenuItemDraft,
  validateTrainingDraft,
  isMenuItemDraft,
  parseTrainingDraftPayload,
  imageExtensionFor,
  slugFromLabel,
  type ContentCategory,
  type ContentCatalogPlacement,
  type ContentCatalogRelation,
  type ContentCatalogResource,
  type ContentMediaVersion,
  type ContentMenuItem,
  type MenuItemDraft,
} from '@/lib/content-model';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { recordStorageAsset, safeOriginalFilename, sourceForContentUpload } from '@/lib/storage-library';
import { serverClient } from '@/lib/supabase-server';
import {
  normalizeTrainingProfile,
  prepareTrainingRelease,
  TRAINING_PIPELINE_VERSION,
  validateTrainingManifest,
  validateTrainingProfile,
  type TenantTrainingProfile,
  type TrainingManifest,
} from '@/lib/training-bootstrap';
import { trainingProfileFingerprint } from '@/lib/training-fingerprint';
import { bootstrapTenantTraining } from '@/workflows/tenant-training-bootstrap';
import { ensurePlatformBrandMembership } from '@/lib/platform-membership';
import { authorizeWorkspaceMutation } from '@/lib/workspace-mutation';

type Failure = { ok: false; error: string };
type ManagerContext = {
  brandId: string;
  brandUserId: string;
  client: SupabaseClient;
  privileged: SupabaseClient;
};

type MenuItemRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category_id: string;
  base_price_cents: number | string;
  sizes: unknown;
  modifiers: unknown;
  image_url: string | null;
  catalog_audience: ContentMenuItem['audience'];
  is_listed: boolean;
  is_86d: boolean;
  sort_order: number;
  updated_at: string;
};

const RETRYABLE_CODES = /^(08|53|57P|PGRST000)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function managerContext(action: string): Promise<ManagerContext | Failure | null> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) {
    return { ok: false, error: 'Only a brand owner can manage tenant content.' };
  }
  const mutation = await authorizeWorkspaceMutation(session, { action });
  if (!mutation) return { ok: false, error: 'This tenant content change was not authorized.' };
  const client = await serverClient();
  if (!client) return null;
  const env = serverEnv();
  if (!env) return { ok: false, error: 'Server-side Supabase credentials are not configured.' };
  if (!session.userId) return { ok: false, error: 'Your session has expired. Sign in again.' };
  const privileged = serviceDb(env);
  let brandUserId: string | null = null;
  if (mutation.serviceRole) {
    brandUserId = await ensurePlatformBrandMembership(privileged, session.userId, mutation.brandId);
  } else {
    const membership = await client.from('brand_users').select('id, role')
      .eq('brand_id', mutation.brandId).eq('user_id', session.userId)
      .single<{ id: string; role: string }>();
    if (!membership.error && ['brand_owner', 'platform_admin'].includes(membership.data.role)) {
      brandUserId = membership.data.id;
    }
  }
  if (!brandUserId) return { ok: false, error: 'Your tenant owner access is no longer active.' };
  return {
    brandId: mutation.brandId,
    brandUserId,
    client,
    privileged,
  };
}

function isFailure(value: ManagerContext | Failure | null): value is Failure {
  return value !== null && 'ok' in value;
}

async function retryWrite<T extends { error: { code?: string } | null }>(operation: () => PromiseLike<T>): Promise<T> {
  const first = await operation();
  if (!first.error || !RETRYABLE_CODES.test(first.error.code ?? '')) return first;
  return operation();
}

async function uploadVersionedImage(
  context: ManagerContext,
  bucket: string,
  path: string,
  body: Buffer,
  contentType: string,
): Promise<boolean> {
  const separator = path.lastIndexOf('/');
  const directory = path.slice(0, separator);
  const filename = path.slice(separator + 1);
  const exists = async () => {
    const listed = await context.privileged.storage.from(bucket)
      .list(directory, { limit: 1, search: filename });
    return !listed.error && (listed.data ?? []).some((object) => object.name === filename);
  };
  const upload = () => context.privileged.storage.from(bucket).upload(path, body, {
    contentType, cacheControl: '31536000', upsert: false,
  });

  const first = await upload();
  if (!first.error || await exists()) return true;
  const second = await upload();
  return !second.error || await exists();
}

function menuItemOf(row: MenuItemRow, mediaVersions: ContentMediaVersion[] = []): ContentMenuItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    categoryId: row.category_id,
    basePriceCents: Number(row.base_price_cents),
    sizes: draftSizesOf(row.sizes),
    optionGroups: draftOptionGroupsOf(row.modifiers),
    imageUrl: row.image_url,
    audience: row.catalog_audience,
    isListed: row.is_listed,
    is86d: row.is_86d,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
    mediaVersions,
  };
}

function draftSizesOf(value: unknown): ContentMenuItem['sizes'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.slug !== 'string') return [];
    const price = typeof row.price_cents === 'number' ? row.price_cents : row.priceCents;
    if (typeof price !== 'number') return [];
    return [{ slug: row.slug, label: typeof row.label === 'string' ? row.label : row.slug, priceCents: price }];
  });
}

function draftOptionGroupsOf(value: unknown): ContentMenuItem['optionGroups'] {
  return Array.isArray(value) ? value as ContentMenuItem['optionGroups'] : [];
}

async function menuMediaVersions(
  context: ManagerContext,
  itemId: string,
): Promise<ContentMediaVersion[]> {
  const result = await context.client.from('content_media_versions')
    .select('id, public_url, created_at')
    .eq('brand_id', context.brandId)
    .eq('entity_type', 'menu_item')
    .eq('entity_key', itemId)
    .eq('slot', 'thumbnail')
    .order('created_at', { ascending: false })
    .limit(12)
    .returns<{ id: string; public_url: string; created_at: string }[]>();
  if (result.error) return [];
  return (result.data ?? []).map((version) => ({
    id: version.id, url: version.public_url, createdAt: version.created_at,
  }));
}

export async function saveMenuItem(
  input: unknown,
  expectedUpdatedAt: string | null,
): Promise<Failure | { ok: true; item: ContentMenuItem; persisted: boolean }> {
  if (!isMenuItemDraft(input)) return { ok: false, error: 'The menu item payload is invalid.' };
  const draft: MenuItemDraft = input;
  const context = await managerContext('content.menu_item.save');
  if (isFailure(context)) return context;
  if (!context) {
    const previewIssues = validateMenuItemDraft(
      { ...draft, imageUrl: null },
      new Set(draft.categoryId ? [draft.categoryId] : []),
    );
    if (previewIssues.length > 0) return { ok: false, error: previewIssues.join(' ') };
    return { ok: true, persisted: false, item: { ...draft, id: draft.id ?? `preview-${randomUUID()}`, updatedAt: new Date().toISOString(), mediaVersions: [] } };
  }
  if (draft.id && (!UUID.test(draft.id) || !expectedUpdatedAt)) {
    return { ok: false, error: 'Reload this menu item before saving it.' };
  }
  const menu = await context.client.from('menus').select('id').eq('brand_id', context.brandId)
    .order('created_at').limit(1).single<{ id: string }>();
  if (menu.error) return { ok: false, error: 'The tenant menu could not be loaded.' };
  const categories = await context.client.from('menu_categories').select('id').eq('menu_id', menu.data.id)
    .returns<{ id: string }[]>();
  if (categories.error) return { ok: false, error: 'The menu categories could not be loaded.' };
  const issues = validateMenuItemDraft(draft, new Set((categories.data ?? []).map((row) => row.id)));
  if (issues.length > 0) return { ok: false, error: issues.join(' ') };

  const values = {
    name: draft.name.trim(),
    slug: draft.slug,
    description: draft.description.trim(),
    category_id: draft.categoryId,
    base_price_cents: draft.basePriceCents,
    sizes: draft.sizes.map((size) => ({
      slug: size.slug, label: size.label.trim(), price_cents: size.priceCents,
    })),
    modifiers: draft.optionGroups,
    image_url: draft.imageUrl,
    catalog_audience: draft.audience,
    is_listed: draft.isListed,
    is_86d: draft.is86d,
    sort_order: draft.sortOrder,
  };
  const fields = 'id, name, slug, description, category_id, base_price_cents, sizes, modifiers, image_url, catalog_audience, is_listed, is_86d, sort_order, updated_at';
  let result;
  if (draft.id) {
    const itemId = draft.id;
    result = await retryWrite(() => {
      let query = context.client.from('menu_items').update(values)
        .eq('id', itemId).eq('brand_id', context.brandId);
      if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
      return query.select(fields).maybeSingle<MenuItemRow>();
    });
    if (!result.error && !result.data) {
      return { ok: false, error: 'This item changed in another session. Reload before saving.' };
    }
  } else {
    const id = randomUUID();
    result = await retryWrite(() => context.client.from('menu_items').insert({
      id, brand_id: context.brandId, menu_id: menu.data.id, ...values,
    }).select(fields).single<MenuItemRow>());
  }
  if (result.error || !result.data) {
    const duplicate = result.error?.code === '23505';
    return { ok: false, error: duplicate ? 'That item slug is already in use.' : 'The menu item could not be saved.' };
  }
  revalidatePath('/content');
  revalidatePath('/menu');
  const mediaVersions = await menuMediaVersions(context, result.data.id);
  return { ok: true, persisted: true, item: menuItemOf(result.data, mediaVersions) };
}

export async function addMenuCategory(
  title: string,
  tagline: string,
  parentId: string | null = null,
): Promise<Failure | { ok: true; category: ContentCategory; persisted: boolean }> {
  if (typeof title !== 'string' || typeof tagline !== 'string') {
    return { ok: false, error: 'The category payload is invalid.' };
  }
  const cleanTitle = title.trim();
  const cleanTagline = tagline.trim();
  if (cleanTitle.length < 2 || cleanTitle.length > 80 || cleanTagline.length > 160) {
    return { ok: false, error: 'Category names need 2–80 characters; taglines can use up to 160.' };
  }
  const context = await managerContext('content.category.add');
  if (isFailure(context)) return context;
  if (parentId !== null && !UUID.test(parentId) && !parentId.startsWith('preview-')) {
    return { ok: false, error: 'The parent folder is invalid.' };
  }
  const preview: ContentCategory = {
    id: `preview-${randomUUID()}`, title: cleanTitle, tagline: cleanTagline,
    slug: slugFromLabel(cleanTitle), parentId, imageUrl: null, audience: 'public',
    archived: false, sortOrder: 1000, mediaVersions: [],
  };
  if (!context) return { ok: true, category: preview, persisted: false };
  const menu = await context.client.from('menus').select('id').eq('brand_id', context.brandId)
    .order('created_at').limit(1).single<{ id: string }>();
  if (menu.error) return { ok: false, error: 'The tenant menu could not be loaded.' };
  const highest = await context.client.from('menu_categories').select('sort_order')
    .eq('menu_id', menu.data.id).order('sort_order', { ascending: false }).limit(1)
    .maybeSingle<{ sort_order: number }>();
  if (highest.error) return { ok: false, error: 'The category order could not be loaded.' };
  const category: ContentCategory = {
    id: randomUUID(), title: cleanTitle, tagline: cleanTagline,
    slug: slugFromLabel(cleanTitle), parentId, imageUrl: null, audience: 'public',
    archived: false, sortOrder: (highest.data?.sort_order ?? 0) + 10, mediaVersions: [],
  };
  const saved = await retryWrite(() => context.client.from('menu_categories').insert({
    id: category.id, brand_id: context.brandId, menu_id: menu.data.id,
    title: category.title, tagline: category.tagline, slug: category.slug,
    parent_id: category.parentId, audience: category.audience, sort_order: category.sortOrder,
  }));
  if (saved.error) return { ok: false, error: 'The category could not be created.' };
  revalidatePath('/content');
  return { ok: true, category, persisted: true };
}

export async function saveMenuCategory(
  categoryId: string,
  title: string,
  tagline: string,
  parentId: string | null,
  audience: ContentCategory['audience'],
  imageUrl: string | null,
): Promise<Failure | { ok: true; category: ContentCategory; persisted: boolean }> {
  if (typeof title !== 'string' || typeof tagline !== 'string' || typeof categoryId !== 'string'
      || categoryId.length < 1 || categoryId.length > 100) {
    return { ok: false, error: 'The category payload is invalid.' };
  }
  const cleanTitle = title.trim();
  const cleanTagline = tagline.trim();
  if (cleanTitle.length < 2 || cleanTitle.length > 80 || cleanTagline.length > 160) {
    return { ok: false, error: 'Category names need 2–80 characters; taglines can use up to 160.' };
  }
  const context = await managerContext('content.category.save');
  if (isFailure(context)) return context;
  if (!['public', 'staff', 'manager', 'owner'].includes(audience)) return { ok: false, error: 'The audience is invalid.' };
  const preview: ContentCategory = {
    id: categoryId, title: cleanTitle, tagline: cleanTagline, slug: slugFromLabel(cleanTitle),
    parentId, imageUrl, audience, archived: false, sortOrder: 0, mediaVersions: [],
  };
  if (!context) return { ok: true, category: preview, persisted: false };
  if (!UUID.test(categoryId)) return { ok: false, error: 'Reload this category before saving it.' };
  if (parentId) {
    const hierarchy = await context.client.from('menu_categories').select('id, parent_id')
      .eq('brand_id', context.brandId).returns<{ id: string; parent_id: string | null }[]>();
    if (hierarchy.error) return { ok: false, error: 'The folder hierarchy could not be checked.' };
    const parents = new Map((hierarchy.data ?? []).map((folder) => [folder.id, folder.parent_id]));
    let cursor: string | null = parentId;
    let depth = 1;
    while (cursor) {
      if (cursor === categoryId) return { ok: false, error: 'A folder cannot contain itself.' };
      cursor = parents.get(cursor) ?? null; depth += 1;
    }
    if (depth > 5) return { ok: false, error: 'Catalog folders support at most five levels.' };
  }
  const result = await retryWrite(() => context.client.from('menu_categories')
    .update({ title: cleanTitle, tagline: cleanTagline, slug: slugFromLabel(cleanTitle), parent_id: parentId, audience, image_url: imageUrl })
    .eq('id', categoryId).eq('brand_id', context.brandId)
    .select('id, title, tagline, slug, parent_id, image_url, audience, archived_at, sort_order')
    .maybeSingle<{ id: string; title: string; tagline: string; slug: string; parent_id: string | null; image_url: string | null; audience: ContentCategory['audience']; archived_at: string | null; sort_order: number }>());
  if (result.error || !result.data) return { ok: false, error: 'The category could not be saved.' };
  revalidatePath('/content');
  return {
    ok: true,
    persisted: true,
    category: {
      id: result.data.id, title: result.data.title,
      tagline: result.data.tagline, slug: result.data.slug, parentId: result.data.parent_id,
      imageUrl: result.data.image_url, audience: result.data.audience,
      archived: result.data.archived_at !== null, sortOrder: result.data.sort_order,
      mediaVersions: [],
    },
  };
}

export async function moveCatalogNode(
  kind: 'folder' | 'offering',
  nodeId: string,
  parentId: string,
): Promise<Failure | { ok: true }> {
  if (!UUID.test(nodeId) || !UUID.test(parentId) || nodeId === parentId) {
    return { ok: false, error: 'Choose a valid destination folder.' };
  }
  const context = await managerContext('content.catalog.move');
  if (isFailure(context)) return context;
  if (!context) return { ok: true };
  if (kind === 'folder') {
    const folders = await context.client.from('menu_categories').select('id, parent_id')
      .eq('brand_id', context.brandId).returns<{ id: string; parent_id: string | null }[]>();
    if (folders.error) return { ok: false, error: 'The folder hierarchy could not be loaded.' };
    const parents = new Map((folders.data ?? []).map((folder) => [folder.id, folder.parent_id]));
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth <= 5; depth += 1) {
      if (cursor === nodeId) return { ok: false, error: 'A folder cannot be moved inside itself.' };
      cursor = parents.get(cursor) ?? null;
    }
    const result = await retryWrite(() => context.client.from('menu_categories')
      .update({ parent_id: parentId }).eq('id', nodeId).eq('brand_id', context.brandId));
    if (result.error) return { ok: false, error: 'The folder could not be moved.' };
  } else {
    const result = await retryWrite(() => context.client.from('menu_items')
      .update({ category_id: parentId }).eq('id', nodeId).eq('brand_id', context.brandId));
    if (result.error) return { ok: false, error: 'The offering could not be moved.' };
  }
  revalidatePath('/catalog');
  return { ok: true };
}

export async function addCatalogAlias(
  nodeId: string,
  parentId: string,
): Promise<Failure | { ok: true; placement: ContentCatalogPlacement; persisted: boolean }> {
  if (!UUID.test(nodeId) || !UUID.test(parentId) || nodeId === parentId) {
    return { ok: false, error: 'Choose a valid alias destination.' };
  }
  const context = await managerContext('content.catalog.alias.add');
  if (isFailure(context)) return context;
  const placement: ContentCatalogPlacement = {
    id: randomUUID(), nodeId, parentId, sortOrder: 1000, isPrimary: false,
  };
  if (!context) return { ok: true, placement, persisted: false };
  const catalog = await context.client.from('catalogs').select('id')
    .eq('brand_id', context.brandId).single<{ id: string }>();
  if (catalog.error) return { ok: false, error: 'The catalog could not be loaded.' };
  const saved = await retryWrite(() => context.client.from('catalog_placements').insert({
    id: placement.id, brand_id: context.brandId, catalog_id: catalog.data.id,
    parent_id: parentId, node_id: nodeId, sort_order: placement.sortOrder, is_primary: false,
  }));
  if (saved.error) return { ok: false, error: saved.error.code === '23505' ? 'That alias already exists.' : 'The alias could not be created.' };
  revalidatePath('/catalog');
  return { ok: true, placement, persisted: true };
}

export async function archiveCatalogNode(
  kind: 'folder' | 'offering',
  nodeId: string,
): Promise<Failure | { ok: true; persisted: boolean }> {
  if (!UUID.test(nodeId)) return { ok: false, error: 'Choose a valid catalog entry.' };
  const context = await managerContext('content.catalog.archive');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, persisted: false };
  if (kind === 'folder') {
    const children = await context.client.from('catalog_placements').select('id')
      .eq('brand_id', context.brandId).eq('parent_id', nodeId).limit(1);
    if (children.error) return { ok: false, error: 'The folder could not be checked.' };
    if ((children.data ?? []).length > 0) return { ok: false, error: 'Move or archive this folder’s contents first.' };
    const saved = await retryWrite(() => context.client.from('menu_categories')
      .update({ archived_at: new Date().toISOString() }).eq('brand_id', context.brandId).eq('id', nodeId));
    if (saved.error) return { ok: false, error: 'The folder could not be archived.' };
  } else {
    const now = new Date().toISOString();
    const [node, item] = await Promise.all([
      retryWrite(() => context.client.from('catalog_nodes').update({ archived_at: now })
        .eq('brand_id', context.brandId).eq('id', nodeId)),
      retryWrite(() => context.client.from('menu_items').update({ is_listed: false })
        .eq('brand_id', context.brandId).eq('id', nodeId)),
    ]);
    if (node.error || item.error) return { ok: false, error: 'The offering could not be archived.' };
  }
  revalidatePath('/catalog');
  return { ok: true, persisted: true };
}

export async function addCatalogResource(
  kind: ContentCatalogResource['kind'],
  title: string,
  summary: string,
  audience: ContentCatalogResource['audience'],
): Promise<Failure | { ok: true; resource: ContentCatalogResource; persisted: boolean }> {
  const kinds: ContentCatalogResource['kind'][] = ['material', 'specification', 'procedure', 'recipe', 'knowledge', 'skill', 'training_module', 'training_lesson'];
  const audiences: ContentCatalogResource['audience'][] = ['public', 'staff', 'manager', 'owner'];
  const cleanTitle = title.trim();
  if (!kinds.includes(kind) || !audiences.includes(audience) || cleanTitle.length < 2 || cleanTitle.length > 160 || summary.length > 1200) {
    return { ok: false, error: 'The resource details are invalid.' };
  }
  const context = await managerContext('content.resource.add');
  if (isFailure(context)) return context;
  const resource: ContentCatalogResource = {
    id: randomUUID(), kind, slug: slugFromLabel(cleanTitle), title: cleanTitle,
    summary: summary.trim(), audience, externalRef: null, imageUrl: null, mediaVersions: [],
  };
  if (!context) return { ok: true, resource, persisted: false };
  const catalog = await context.client.from('catalogs').select('id').eq('brand_id', context.brandId).single<{ id: string }>();
  if (catalog.error) return { ok: false, error: 'The catalog could not be loaded.' };
  const saved = await retryWrite(() => context.client.from('catalog_resources').insert({
    id: resource.id, brand_id: context.brandId, catalog_id: catalog.data.id,
    kind, slug: resource.slug, title: resource.title, summary: resource.summary, audience,
  }));
  if (saved.error) return { ok: false, error: saved.error.code === '23505' ? 'That resource already exists.' : 'The resource could not be saved.' };
  revalidatePath('/catalog');
  return { ok: true, resource, persisted: true };
}

export async function saveCatalogResourceImage(
  resourceId: string,
  imageUrl: string | null,
): Promise<Failure | { ok: true; imageUrl: string | null; persisted: boolean }> {
  const context = await managerContext('content.resource.image.save');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, imageUrl, persisted: false };
  if (!UUID.test(resourceId) || (imageUrl !== null && (imageUrl.length > 2048 || !imageUrl.startsWith('https://')))) {
    return { ok: false, error: 'The resource image is invalid.' };
  }
  const saved = await retryWrite(() => context.client.from('catalog_resources')
    .update({ image_url: imageUrl }).eq('id', resourceId).eq('brand_id', context.brandId));
  if (saved.error) return { ok: false, error: 'The resource image could not be saved.' };
  revalidatePath('/catalog');
  return { ok: true, imageUrl, persisted: true };
}

export async function linkCatalogResource(
  nodeId: string,
  resourceId: string,
  kind: ContentCatalogRelation['kind'],
): Promise<Failure | { ok: true; relation: ContentCatalogRelation; persisted: boolean }> {
  const relationKinds: ContentCatalogRelation['kind'][] = ['requires', 'follows', 'teaches', 'develops', 'covers', 'prerequisite', 'related', 'substitute'];
  if (!UUID.test(nodeId) || !UUID.test(resourceId) || !relationKinds.includes(kind)) return { ok: false, error: 'The relationship is invalid.' };
  const context = await managerContext('content.resource.link');
  if (isFailure(context)) return context;
  const relation: ContentCatalogRelation = { id: randomUUID(), sourceId: nodeId, targetId: resourceId, kind };
  if (!context) return { ok: true, relation, persisted: false };
  const [catalog, node, resource] = await Promise.all([
    context.client.from('catalogs').select('id').eq('brand_id', context.brandId).single<{ id: string }>(),
    context.client.from('catalog_nodes').select('id').eq('id', nodeId).eq('brand_id', context.brandId).maybeSingle(),
    context.client.from('catalog_resources').select('id').eq('id', resourceId).eq('brand_id', context.brandId).maybeSingle(),
  ]);
  if (catalog.error || node.error || resource.error || !node.data || !resource.data) return { ok: false, error: 'The linked records are not available in this tenant.' };
  const saved = await retryWrite(() => context.client.from('catalog_relations').insert({
    id: relation.id, brand_id: context.brandId, catalog_id: catalog.data.id,
    source_key: nodeId, target_key: resourceId, kind,
  }));
  if (saved.error) return { ok: false, error: saved.error.code === '23505' ? 'That relationship already exists.' : 'The relationship could not be saved.' };
  revalidatePath('/catalog');
  return { ok: true, relation, persisted: true };
}

export async function setMenuPublished(
  menuId: string,
  published: boolean,
  expectedUpdatedAt: string | null,
): Promise<Failure | { ok: true; updatedAt: string; publishedVersion: number | null; persisted: boolean }> {
  const context = await managerContext('content.menu.publish');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, updatedAt: new Date().toISOString(), publishedVersion: 1, persisted: false };
  if (!UUID.test(menuId) || !expectedUpdatedAt) return { ok: false, error: 'Reload the menu before publishing.' };
  if (!published) return { ok: false, error: 'Published catalog releases are replaced by a newer release instead of being removed.' };
  const catalog = await context.client.from('catalogs').select('draft_version')
    .eq('id', menuId).eq('brand_id', context.brandId).single<{ draft_version: number }>();
  if (catalog.error) return { ok: false, error: 'The catalog draft could not be loaded.' };
  const release = await retryWrite(() => context.client.rpc('publish_catalog_draft', {
    target_catalog: menuId, expected_draft_version: catalog.data.draft_version,
  }).single<{ version: number }>());
  if (release.error || !release.data) return { ok: false, error: 'The catalog could not be published. Resolve validation issues and try again.' };
  const result = await retryWrite(() => {
    let query = context.client.from('menus').update({ is_published: published })
      .eq('id', menuId).eq('brand_id', context.brandId);
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);
    return query.select('updated_at').maybeSingle<{ updated_at: string }>();
  });
  if (result.error || !result.data) {
    return { ok: false, error: result.error ? 'The menu could not be published.' : 'The menu changed in another session. Reload first.' };
  }
  revalidatePath('/catalog');
  revalidatePath('/content');
  return { ok: true, persisted: true, updatedAt: result.data.updated_at, publishedVersion: release.data.version };
}

export async function uploadContentImage(
  formData: FormData,
): Promise<Failure | { ok: true; url: string; persisted: boolean }> {
  const context = await managerContext('content.image.upload');
  if (isFailure(context)) return context;
  const file = formData.get('file');
  const family = formData.get('family') === 'training' ? 'training' : 'menu';
  const scope = typeof formData.get('scope') === 'string' ? String(formData.get('scope')) : family;
  const entityKey = typeof formData.get('entityKey') === 'string' ? String(formData.get('entityKey')) : 'unassigned';
  if (!(file instanceof File)) return { ok: false, error: 'Choose an image to upload.' };
  if (file.size <= 0 || file.size > 6_000_000) return { ok: false, error: 'Images must be smaller than 6 MB.' };
  const body = Buffer.from(await file.arrayBuffer());
  const extension = imageExtensionFor(file.type, body);
  if (!extension) return { ok: false, error: 'The file contents must be a valid JPEG, PNG, or WebP image.' };
  // The client already owns a blob URL for preview; do not serialize megabytes
  // of image data back through a server-action response in demo mode.
  if (!context) return { ok: true, persisted: false, url: '' };
  const bucket = family === 'training' ? 'training-media' : 'menu-images';
  const safeScope = scope.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || family;
  const safeEntity = entityKey.replace(/[^a-z0-9/-]+/gi, '-').replace(/^\/+|\/+$/g, '').slice(0, 180) || 'unassigned';
  const path = `${context.brandId}/${safeScope}/${safeEntity}/${randomUUID()}.${extension}`;
  if (!await uploadVersionedImage(context, bucket, path, body, file.type)) {
    return { ok: false, error: 'The image could not be uploaded. Try a smaller file.' };
  }
  const source = sourceForContentUpload(scope, entityKey);
  const recorded = await recordStorageAsset(context.privileged, {
    assetKind: family === 'training' ? 'training_media' : 'menu_image',
    brandId: context.brandId,
    byteSize: body.byteLength,
    checksumSha256: createHash('sha256').update(body).digest('hex'),
    createdBy: context.brandUserId,
    metadata: { source: 'content_upload' },
    mimeType: file.type,
    objectPath: path,
    originalFilename: safeOriginalFilename(file.name, extension),
    sourceKey: source.sourceKey,
    sourceType: source.sourceType,
  });
  if (!recorded) {
    const remove = () => context.privileged.storage.from(bucket).remove([path]);
    const firstRemoval = await remove();
    if (firstRemoval.error) await remove();
    console.error('storage asset registration failed after content upload', {
      severity: 'error', bucket, family, sourceType: source.sourceType,
    });
    return { ok: false, error: 'The image could not be recorded. Please try the upload again.' };
  }
  const publicUrl = context.privileged.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  return { ok: true, persisted: true, url: publicUrl };
}

export async function saveTrainingDraft(
  input: unknown,
  expectedUpdatedAt: string | null,
): Promise<Failure | { ok: true; releaseId: string; version: number; updatedAt: string; persisted: boolean }> {
  const manifest = parseTrainingDraftPayload(input);
  if (!manifest) return { ok: false, error: 'The training draft payload is invalid.' };
  const draft = { ...manifest, generatedAt: new Date().toISOString() };
  const issues = validateTrainingDraft(draft);
  if (issues.length > 0) return { ok: false, error: issues.join(' ') };
  const context = await managerContext('content.training.save');
  if (isFailure(context)) return context;
  if (!context) {
    return { ok: true, persisted: false, releaseId: `preview-${randomUUID()}`, version: 1, updatedAt: draft.generatedAt };
  }
  const menuSlugs = await context.privileged.from('menu_items').select('slug').eq('brand_id', context.brandId).returns<{ slug: string }[]>();
  if (menuSlugs.error) return { ok: false, error: 'The tenant menu could not be checked for training links.' };
  const knownMenuSlugs = new Set((menuSlugs.data ?? []).map((item) => item.slug));
  const missingMenuLinks = draft.tracks.flatMap((track) => track.lessons.flatMap((lesson) => (lesson.menuItemSlugs ?? []).filter((slug) => !knownMenuSlugs.has(slug)).map((slug) => `${track.slug}/${lesson.slug}: ${slug}`)));
  if (missingMenuLinks.length > 0) return { ok: false, error: `Training links reference missing menu items: ${missingMenuLinks.slice(0, 5).join(', ')}` };
  const prepared = prepareTrainingRelease(draft);
  const existing = await context.privileged.from('training_releases')
    .select('id, version, updated_at').eq('brand_id', context.brandId).eq('status', 'draft')
    .maybeSingle<{ id: string; version: number; updated_at: string }>();
  if (existing.error) return { ok: false, error: 'The training draft could not be loaded.' };

  let saved;
  if (existing.data) {
    const existingDraft = existing.data;
    if (!expectedUpdatedAt || existingDraft.updated_at !== expectedUpdatedAt) {
      return { ok: false, error: 'This training draft changed in another session. Reload before saving.' };
    }
    saved = await retryWrite(() => context.privileged.from('training_releases').update({
      manifest: prepared.publicManifest,
      answer_key: prepared.answerKey,
      template_key: prepared.publicManifest.tenant.templateKey ?? null,
      template_version: prepared.publicManifest.tenant.templateVersion ?? null,
      updated_by: context.brandUserId,
    }).eq('id', existingDraft.id).eq('brand_id', context.brandId).eq('updated_at', existingDraft.updated_at)
      .select('id, version, updated_at').maybeSingle<{ id: string; version: number; updated_at: string }>());
  } else {
    const latest = await context.privileged.from('training_releases').select('version')
      .eq('brand_id', context.brandId).order('version', { ascending: false }).limit(1)
      .maybeSingle<{ version: number }>();
    if (latest.error) return { ok: false, error: 'The training version could not be allocated.' };
    saved = await retryWrite(() => context.privileged.from('training_releases').insert({
      id: randomUUID(), brand_id: context.brandId, version: (latest.data?.version ?? 0) + 1,
      status: 'draft', manifest: prepared.publicManifest, answer_key: prepared.answerKey,
      template_key: prepared.publicManifest.tenant.templateKey ?? null,
      template_version: prepared.publicManifest.tenant.templateVersion ?? null,
      created_by: context.brandUserId, updated_by: context.brandUserId,
    }).select('id, version, updated_at').single<{ id: string; version: number; updated_at: string }>());
  }
  if (saved.error || !saved.data) {
    return { ok: false, error: saved.error?.code === '23505' ? 'Another draft was created. Reload to continue.' : 'The training draft could not be saved.' };
  }
  revalidatePath('/content');
  revalidatePath('/training');
  return { ok: true, persisted: true, releaseId: saved.data.id, version: saved.data.version, updatedAt: saved.data.updated_at };
}

export async function publishTrainingDraft(
  releaseId: string,
  expectedUpdatedAt: string | null,
): Promise<Failure | { ok: true; version: number; persisted: boolean }> {
  const context = await managerContext('content.training.publish');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, version: 1, persisted: false };
  if (!UUID.test(releaseId) || !expectedUpdatedAt) return { ok: false, error: 'Reload the training draft before publishing.' };
  const release = await context.privileged.from('training_releases')
    .select('version, manifest, answer_key, updated_at').eq('id', releaseId)
    .eq('brand_id', context.brandId).eq('status', 'draft')
    .maybeSingle<{ version: number; manifest: TrainingManifest; answer_key: ReturnType<typeof prepareTrainingRelease>['answerKey']; updated_at: string }>();
  if (release.error || !release.data) return { ok: false, error: 'Save a training draft before publishing.' };
  if (expectedUpdatedAt && expectedUpdatedAt !== release.data.updated_at) {
    return { ok: false, error: 'This training draft changed in another session. Reload before publishing.' };
  }
  const stored = liftTrainingManifest(release.data.manifest);
  if (!stored) return { ok: false, error: 'The saved training draft is unreadable. Reload and save it again.' };
  const authoring = restoreAnswersForPublish(stored, release.data.answer_key);
  const issues = validateTrainingManifest(authoring);
  if (issues.length > 0) return { ok: false, error: `Publishing is blocked: ${issues.join('; ')}` };
  const menuSlugs = await context.privileged.from('menu_items').select('slug').eq('brand_id', context.brandId).returns<{ slug: string }[]>();
  if (menuSlugs.error) return { ok: false, error: 'The tenant menu could not be checked for training links.' };
  const knownMenuSlugs = new Set((menuSlugs.data ?? []).map((item) => item.slug));
  const missingMenuLinks = authoring.tracks.flatMap((track) => track.lessons.flatMap((lesson) => (lesson.menuItemSlugs ?? []).filter((slug) => !knownMenuSlugs.has(slug)).map((slug) => `${track.slug}/${lesson.slug}: ${slug}`)));
  if (missingMenuLinks.length > 0) return { ok: false, error: `Publishing is blocked by missing menu links: ${missingMenuLinks.slice(0, 5).join(', ')}` };
  const published = await context.privileged.rpc('publish_manual_training_release', {
    target_brand: context.brandId,
    target_release: releaseId,
    target_editor: context.brandUserId,
    expected_updated_at: release.data.updated_at,
  });
  if (published.error) return { ok: false, error: 'The training release could not be published atomically.' };
  revalidatePath('/content');
  revalidatePath('/training');
  return { ok: true, persisted: true, version: release.data.version };
}

function restoreAnswersForPublish(
  manifest: TrainingManifest,
  answerKey: ReturnType<typeof prepareTrainingRelease>['answerKey'],
): TrainingManifest {
  return {
    ...manifest,
    tracks: manifest.tracks.map((track) => ({
      ...track,
      lessons: track.lessons.map((lesson) => ({
        ...lesson,
        quiz: lesson.quiz.map((question, index) => ({
          ...question, correctChoice: answerKey[track.slug]?.[lesson.slug]?.[index],
        })),
      })),
    })),
  };
}

export async function startTrainingAutomation(
  input: unknown,
): Promise<Failure | { ok: true; runId: string; persisted: boolean }> {
  if (!isTrainingProfilePayload(input)) return { ok: false, error: 'The tenant training profile is invalid.' };
  const requestedProfile: TenantTrainingProfile = input;
  const profile = normalizeTrainingProfile(requestedProfile);
  const issues = validateTrainingProfile(profile);
  if (issues.length > 0) return { ok: false, error: issues.join('; ') };
  const context = await managerContext('content.training.automation.start');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, persisted: false, runId: `preview-${randomUUID()}` };
  const stored = await context.privileged.rpc('store_training_profile', {
    target_brand: context.brandId, tenant_profile: profile,
  });
  if (stored.error) return { ok: false, error: 'The tenant training profile could not be saved.' };
  const runId = randomUUID();
  const fingerprint = `${trainingProfileFingerprint(profile).slice(0, 32)}${runId.replaceAll('-', '')}`;
  const queued = await retryWrite(() => context.privileged.from('training_bootstrap_runs').insert({
    id: runId,
    brand_id: context.brandId,
    profile_fingerprint: fingerprint,
    pipeline_version: TRAINING_PIPELINE_VERSION,
    trigger_kind: 'manual',
    status: 'queued',
    stage: 'queued',
    progress: 0,
    requested_by: context.brandUserId,
  }));
  if (queued.error) return { ok: false, error: 'The training research run could not be queued.' };
  try {
    await start(bootstrapTenantTraining, [{ brandId: context.brandId, runId, profile }]);
  } catch {
    await context.privileged.from('training_bootstrap_runs').update({
      status: 'failed', stage: 'queue', error_code: 'workflow_start_failed', finished_at: new Date().toISOString(),
    }).eq('id', runId).eq('brand_id', context.brandId);
    return { ok: false, error: 'Training research could not start. Try again shortly.' };
  }
  revalidatePath('/content');
  return { ok: true, persisted: true, runId };
}

function isTrainingProfilePayload(value: unknown): value is TenantTrainingProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  if (typeof profile.businessName !== 'string' || typeof profile.industry !== 'string'
      || typeof profile.locale !== 'string') return false;
  for (const key of ['products', 'services', 'complianceTopics'] as const) {
    const list = profile[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every((item) => typeof item === 'string'))) return false;
  }
  if (profile.templateKey !== undefined && typeof profile.templateKey !== 'string') return false;
  if (profile.templateVersion !== undefined && typeof profile.templateVersion !== 'number') return false;
  return (profile.website === undefined || typeof profile.website === 'string')
    && (profile.brandVoice === undefined || typeof profile.brandVoice === 'string');
}
