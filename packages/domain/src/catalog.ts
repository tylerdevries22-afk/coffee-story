import type { Json } from '@platform/schema';

export const CATALOG_MAX_DEPTH = 5;

export type CatalogAudience = 'public' | 'staff' | 'manager' | 'owner';
export type CatalogNodeKind = 'folder' | 'offering';
export type CatalogResourceKind =
  | 'material' | 'specification' | 'procedure' | 'recipe'
  | 'knowledge' | 'skill' | 'training_module' | 'training_lesson';
export type CatalogRelationKind =
  | 'requires' | 'follows' | 'teaches' | 'develops' | 'covers'
  | 'prerequisite' | 'related' | 'substitute';

export type CatalogVocabulary = {
  catalog: string;
  folder: string;
  offering: string;
  material: string;
  procedure: string;
};

export type CatalogFolder = {
  id: string;
  kind: 'folder';
  slug: string;
  title: string;
  description: string;
  imageUrl: string | null;
  audience: CatalogAudience;
  archived: boolean;
};

export type CatalogOffering = {
  id: string;
  kind: 'offering';
  slug: string;
  title: string;
  description: string;
  imageUrl: string | null;
  audience: CatalogAudience;
  archived: boolean;
  commerceItemId: string;
  commerce: {
    basePriceCents: number;
    sizes: Json;
    optionGroups: Json;
    availability: Json;
    isListed: boolean;
  };
};

export type CatalogNode = CatalogFolder | CatalogOffering;

export type CatalogPlacement = {
  id: string;
  parentId: string | null;
  nodeId: string;
  sortOrder: number;
  isPrimary: boolean;
};

export type CatalogResource = {
  id: string;
  kind: CatalogResourceKind;
  slug: string;
  title: string;
  summary: string;
  imageUrl?: string | null;
  audience: CatalogAudience;
  externalRef: string | null;
};

export type CatalogRelation = {
  id: string;
  sourceId: string;
  targetId: string;
  kind: CatalogRelationKind;
};

export type CatalogManifest = {
  schemaVersion: 1;
  catalogId: string;
  brandId: string;
  version: number;
  vocabulary: CatalogVocabulary;
  nodes: CatalogNode[];
  placements: CatalogPlacement[];
  resources: CatalogResource[];
  relations: CatalogRelation[];
  publishedAt: string | null;
};

export type CatalogRelease = {
  id: string;
  brandId: string;
  version: number;
  status: 'draft' | 'published' | 'retired';
  manifest: CatalogManifest;
  createdAt: string;
  publishedAt: string | null;
};

export type CatalogValidationIssue = {
  code: 'duplicate_slug' | 'invalid_parent' | 'cycle' | 'depth' | 'primary_placement' | 'invalid_relation';
  entityId: string;
  message: string;
};

export const DEFAULT_CATALOG_VOCABULARY: CatalogVocabulary = {
  catalog: 'Catalog', folder: 'Folder', offering: 'Offering',
  material: 'Material', procedure: 'Procedure',
};

export function resolveCatalogVocabulary(
  template: Partial<CatalogVocabulary> = {},
  tenant: Partial<CatalogVocabulary> = {},
): CatalogVocabulary {
  return { ...DEFAULT_CATALOG_VOCABULARY, ...template, ...tenant };
}

function primaryPlacements(manifest: CatalogManifest): Map<string, CatalogPlacement[]> {
  const grouped = new Map<string, CatalogPlacement[]>();
  for (const placement of manifest.placements.filter((candidate) => candidate.isPrimary)) {
    grouped.set(placement.nodeId, [...(grouped.get(placement.nodeId) ?? []), placement]);
  }
  return grouped;
}

function placementDepth(
  placement: CatalogPlacement,
  primaries: Map<string, CatalogPlacement[]>,
  seen = new Set<string>(),
): number {
  if (!placement.parentId) return 1;
  if (seen.has(placement.nodeId)) return Number.POSITIVE_INFINITY;
  const parent = primaries.get(placement.parentId)?.[0];
  return parent ? 1 + placementDepth(parent, primaries, new Set(seen).add(placement.nodeId)) : 1;
}

export function validateCatalogManifest(manifest: CatalogManifest): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const nodes = new Map(manifest.nodes.map((node) => [node.id, node]));
  const primaries = primaryPlacements(manifest);
  const siblingSlugs = new Set<string>();
  for (const placement of manifest.placements) {
    const node = nodes.get(placement.nodeId);
    const parent = placement.parentId ? nodes.get(placement.parentId) : null;
    if (!node || (placement.parentId && parent?.kind !== 'folder')) issues.push({ code: 'invalid_parent', entityId: placement.id, message: 'Placement parent must be an existing folder.' });
    const key = `${placement.parentId ?? 'root'}:${node?.slug ?? placement.nodeId}`;
    if (siblingSlugs.has(key)) issues.push({ code: 'duplicate_slug', entityId: placement.nodeId, message: 'Sibling slugs must be unique.' });
    siblingSlugs.add(key);
  }
  for (const node of manifest.nodes) {
    const count = primaries.get(node.id)?.length ?? 0;
    if (count !== 1) issues.push({ code: 'primary_placement', entityId: node.id, message: 'Every node needs exactly one primary placement.' });
  }
  for (const placement of manifest.placements.filter((candidate) => candidate.isPrimary)) {
    const depth = placementDepth(placement, primaries);
    if (depth > CATALOG_MAX_DEPTH) issues.push({ code: Number.isFinite(depth) ? 'depth' : 'cycle', entityId: placement.nodeId, message: 'Catalog paths cannot cycle or exceed five levels.' });
  }
  const resourceIds = new Set(manifest.resources.map((resource) => resource.id));
  const relationIds = new Set([...nodes.keys(), ...resourceIds]);
  for (const relation of manifest.relations) {
    if (!relationIds.has(relation.sourceId) || !relationIds.has(relation.targetId)) issues.push({ code: 'invalid_relation', entityId: relation.id, message: 'Relations must reference entities in the same manifest.' });
  }
  return issues;
}

export function catalogBreadcrumbs(manifest: CatalogManifest, nodeId: string): CatalogNode[] {
  const nodes = new Map(manifest.nodes.map((node) => [node.id, node]));
  const primaries = primaryPlacements(manifest);
  const path: CatalogNode[] = [];
  let current: string | null = nodeId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = nodes.get(current);
    if (node) path.unshift(node);
    current = primaries.get(current)?.[0]?.parentId ?? null;
  }
  return path;
}
