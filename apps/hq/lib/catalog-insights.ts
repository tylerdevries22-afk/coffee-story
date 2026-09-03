import type {
  ContentCatalogPlacement,
  ContentCatalogRelation,
  ContentCatalogResource,
  ContentCategory,
  ContentMenuItem,
  ContentWorkspaceData,
} from './content-model';

type TrainingManifest = ContentWorkspaceData['training']['manifest'];

export type CatalogResourceLink = {
  relation: ContentCatalogRelation;
  resource: ContentCatalogResource;
  direction: 'outgoing' | 'incoming';
};

export type CatalogTrainingLink = {
  trackSlug: string;
  trackTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  objective: string;
  estimatedMinutes: number;
};

export type CatalogItemAssociations = {
  aliases: string[];
  resources: CatalogResourceLink[];
  training: CatalogTrainingLink[];
};

export type CatalogAssociationIndex = ReadonlyMap<string, CatalogItemAssociations>;

export const EMPTY_CATALOG_ASSOCIATIONS: CatalogItemAssociations = {
  aliases: [], resources: [], training: [],
};

export function catalogPath(categories: ContentCategory[], folderId: string): string {
  const byId = new Map(categories.map((folder) => [folder.id, folder]));
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.join(' / ') || 'Catalog root';
}

export function displayPriceCents(item: Pick<ContentMenuItem, 'basePriceCents' | 'sizes'>): number {
  return item.sizes.length > 0
    ? Math.min(...item.sizes.map((size) => size.priceCents))
    : item.basePriceCents;
}

export function buildCatalogItemAssociations(
  item: ContentMenuItem,
  categories: ContentCategory[],
  resources: ContentCatalogResource[],
  relations: ContentCatalogRelation[],
  placements: ContentCatalogPlacement[],
  training: TrainingManifest,
): CatalogItemAssociations {
  return buildCatalogAssociationIndex(
    [item], categories, resources, relations, placements, training,
  ).get(item.id) ?? EMPTY_CATALOG_ASSOCIATIONS;
}

export function buildCatalogAssociationIndex(
  items: ContentMenuItem[],
  categories: ContentCategory[],
  resources: ContentCatalogResource[],
  relations: ContentCatalogRelation[],
  placements: ContentCatalogPlacement[],
  training: TrainingManifest,
): CatalogAssociationIndex {
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const itemIdBySlug = new Map(items.map((item) => [item.slug, item.id]));
  const index = new Map<string, CatalogItemAssociations>(items.map((item) => [item.id, {
    aliases: [], resources: [], training: [],
  }]));
  for (const relation of relations) {
    const outgoing = index.get(relation.sourceId);
    if (outgoing) {
      const resource = resourcesById.get(relation.targetId);
      if (resource) outgoing.resources.push({ relation, resource, direction: 'outgoing' });
    }
    const incoming = index.get(relation.targetId);
    if (incoming) {
      const resource = resourcesById.get(relation.sourceId);
      if (resource) incoming.resources.push({ relation, resource, direction: 'incoming' });
    }
  }
  for (const placement of placements) {
    const associations = index.get(placement.nodeId);
    if (!associations || placement.isPrimary || !placement.parentId) continue;
    const path = catalogPath(categories, placement.parentId);
    if (!associations.aliases.includes(path)) associations.aliases.push(path);
  }
  for (const track of training.tracks) {
    for (const lesson of track.lessons) {
      for (const itemSlug of lesson.menuItemSlugs ?? []) {
        const itemId = itemIdBySlug.get(itemSlug);
        const associations = itemId ? index.get(itemId) : undefined;
        if (!associations) continue;
        associations.training.push({
          trackSlug: track.slug, trackTitle: track.title,
          lessonSlug: lesson.slug, lessonTitle: lesson.title,
          objective: lesson.objective, estimatedMinutes: lesson.estimatedMinutes,
        });
      }
    }
  }
  return index;
}

export function catalogValidationSummary(
  categories: ContentCategory[],
  items: ContentMenuItem[],
  resources: ContentCatalogResource[],
  relations: ContentCatalogRelation[],
): { errors: string[]; warnings: string[] } {
  const folders = new Map(categories.map((folder) => [folder.id, folder]));
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const nodeIds = new Set([...categories.map((folder) => folder.id), ...items.map((item) => item.id)]);
  const errors: string[] = [];
  for (const folder of categories) {
    let current: ContentCategory | undefined = folder;
    const seen = new Set<string>();
    let depth = 0;
    while (current) {
      if (seen.has(current.id)) {
        errors.push(`${folder.title}: folder cycle detected.`);
        break;
      }
      seen.add(current.id);
      depth += 1;
      current = current.parentId ? folders.get(current.parentId) : undefined;
    }
    if (depth > 5) errors.push(`${folder.title}: path exceeds five folder levels.`);
    if (folder.parentId && !folders.has(folder.parentId)) errors.push(`${folder.title}: parent folder is missing.`);
  }
  for (const item of items) {
    if (!folders.has(item.categoryId)) errors.push(`${item.name}: primary folder is missing.`);
  }
  for (const relation of relations) {
    if (!nodeIds.has(relation.sourceId) && !resourceIds.has(relation.sourceId)) {
      errors.push(`Relationship ${relation.id}: source is missing.`);
    }
    if (!nodeIds.has(relation.targetId) && !resourceIds.has(relation.targetId)) {
      errors.push(`Relationship ${relation.id}: target is missing.`);
    }
  }
  const warnings = [
    ...categories.filter((folder) => !folder.imageUrl).map((folder) => `${folder.title}: add a folder thumbnail.`),
    ...items.filter((item) => !item.imageUrl).map((item) => `${item.name}: add an offering thumbnail.`),
    ...resources.filter((resource) => !resource.imageUrl).map((resource) => `${resource.title}: add a resource thumbnail.`),
  ];
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
