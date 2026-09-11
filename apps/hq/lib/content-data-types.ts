import type { ContentMenuItem, ContentWorkspaceData } from './content-model';

export type BrandRow = { id: string; name: string; brand_config: unknown };
export type MenuRow = { id: string; name: string; is_published: boolean; updated_at: string };
export type CategoryRow = {
  id: string; title: string; tagline: string; slug: string; parent_id: string | null;
  image_url: string | null; audience: 'public' | 'staff' | 'manager' | 'owner';
  archived_at: string | null; sort_order: number;
};
export type ItemRow = {
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
export type ReleaseRow = {
  id: string;
  version: number;
  status: 'draft' | 'published';
  manifest: unknown;
  updated_at: string;
};
export type RunRow = { id: string; status: string; stage: string; progress: number; created_at: string };
export type MediaVersionRow = { id: string; entity_type: string; entity_key: string; slot: string; public_url: string; created_at: string };
export type CatalogResourceRow = { id: string; kind: ContentWorkspaceData['catalogResources'][number]['kind']; slug: string; title: string; summary: string; audience: ContentWorkspaceData['catalogResources'][number]['audience']; external_ref: string | null; image_url: string | null };
export type CatalogRelationRow = { id: string; source_key: string; target_key: string; kind: ContentWorkspaceData['catalogRelations'][number]['kind'] };
export type CatalogPlacementRow = { id: string; node_id: string; parent_id: string | null; sort_order: number; is_primary: boolean };
