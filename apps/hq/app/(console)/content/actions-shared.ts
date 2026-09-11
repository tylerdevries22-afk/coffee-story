import type { SupabaseClient } from '@supabase/supabase-js';

import { currentSession, hasRole } from '@/lib/auth';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import type { ContentMediaVersion, ContentMenuItem } from '@/lib/content-model';
import { ensurePlatformBrandMembership } from '@/lib/platform-membership';
import { serverClient } from '@/lib/supabase-server';
import { authorizeWorkspaceMutation } from '@/lib/workspace-mutation';

export type Failure = { ok: false; error: string };
export type ManagerContext = {
  brandId: string;
  brandUserId: string;
  client: SupabaseClient;
  privileged: SupabaseClient;
};

export type MenuItemRow = {
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
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function managerContext(action: string): Promise<ManagerContext | Failure | null> {
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
export function isFailure(value: ManagerContext | Failure | null): value is Failure {
  return value !== null && 'ok' in value;
}
export async function retryWrite<T extends { error: { code?: string } | null }>(operation: () => PromiseLike<T>): Promise<T> {
  const first = await operation();
  if (!first.error || !RETRYABLE_CODES.test(first.error.code ?? '')) return first;
  return operation();
}

export async function uploadVersionedImage(
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

export function menuItemOf(row: MenuItemRow, mediaVersions: ContentMediaVersion[] = []): ContentMenuItem {
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

export async function menuMediaVersions(
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
